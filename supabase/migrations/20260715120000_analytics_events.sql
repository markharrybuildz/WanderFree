-- Analytics layer B: behavioral event stream (screens, funnels, feature
-- usage). Companion to the layer-A reporting views in
-- 20260711120000_analytics_views.sql, which derive business metrics from
-- domain tables and never touch this stream.
--
-- Design constraints (privacy-first):
--   * Append-only. Clients can INSERT and nothing else — no select, update,
--     or delete for anon/authenticated. Reads happen via the analytics
--     views + BI role only.
--   * No PII columns. profile_id links to auth.uid() for funnel joins; no
--     emails or names. `properties` is for small, non-identifying context.
--   * Anonymous events allowed (pre-signin screens): profile_id is null.
--     RLS forbids writing anyone ELSE's profile_id.
--   * Two clocks: occurred_at is the client's (may drift, used for
--     ordering within a session); received_at is the server's (trustworthy,
--     used for time-series bucketing and the BRIN index).

create table if not exists public.analytics_events (
  -- Client-generated so a retried batch upserts idempotently.
  id uuid primary key default gen_random_uuid(),
  event_name text not null
    check (char_length(event_name) between 1 and 64),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  profile_id uuid default auth.uid(),
  portfolio_id uuid,   -- intentionally no FK: events outlive their portfolio
  session_id uuid,
  platform text
    check (platform is null or platform in ('ios', 'android', 'web')),
  app_version text
    check (app_version is null or char_length(app_version) <= 32),
  properties jsonb not null default '{}'::jsonb
    check (pg_column_size(properties) <= 8192)
);

comment on table public.analytics_events is
  'Append-only behavioral event stream. Insert-only for clients; read via analytics views + BI role.';

-- BRIN suits an insert-ordered stream: tiny index, fast range scans.
create index if not exists idx_analytics_events_received_brin
  on public.analytics_events using brin (received_at);
create index if not exists idx_analytics_events_name
  on public.analytics_events (event_name);

alter table public.analytics_events enable row level security;

-- INSERT-only, and never on someone else's behalf. No select/update/delete
-- policies exist, so those are denied outright under RLS.
drop policy if exists "analytics_events insert" on public.analytics_events;
create policy "analytics_events insert" on public.analytics_events
  for insert to anon, authenticated
  with check (profile_id is null or profile_id = auth.uid());

-- Supabase's default privileges grant broadly; claw back everything except
-- insert. service_role keeps full access for operator maintenance.
revoke all on table public.analytics_events from anon, authenticated;
grant insert on table public.analytics_events to anon, authenticated;

-- Layer-A style rollup so Metabase can chart events as soon as they flow.
create or replace view analytics.events_daily as
select (received_at at time zone 'UTC')::date as day,
       event_name,
       count(*)                               as event_count,
       count(distinct session_id)             as sessions,
       count(distinct profile_id)             as unique_profiles
from public.analytics_events
group by 1, 2
order by 1 desc, 3 desc;

-- The BI role is created out-of-band (admin-scripts). Grant only if present
-- so this migration works on a fresh database too.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'metabase_ro') then
    grant select on analytics.events_daily to metabase_ro;
  end if;
end $$;
