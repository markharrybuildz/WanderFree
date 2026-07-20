-- Client error / crash log: an append-only sink for runtime errors caught in
-- the mobile app (uncaught JS exceptions, React error-boundary crashes, failed
-- queries/mutations, and explicit logError() calls). Operator-facing — read in
-- Metabase via the analytics.errors_* views, never from the app.
--
-- Mirrors the analytics_events privacy/access model
-- (20260715120000_analytics_events.sql) with two deliberate differences:
--   * NOT gated by the analytics opt-out. Error diagnostics are operational,
--     not behavioral analytics, so the client logs them regardless of the
--     "Share anonymous usage data" toggle. The privacy notice discloses this.
--   * The Metabase views expose the raw message + stack (unlike the strictly
--     no-PII analytics views). Error strings can incidentally contain user
--     input (a typed card name, an email in a validation message), so treat
--     these views as an operator-only, potentially-PII sink — never join them
--     into a shared/exported dashboard.
--
-- Same two-clock design as analytics_events: occurred_at is the client's clock
-- (may drift), received_at is the trustworthy server clock used for bucketing.

create table if not exists public.client_errors (
  -- Client-generated so a retried batch upserts idempotently (PK conflict =
  -- already delivered).
  id uuid primary key default gen_random_uuid(),
  -- Where the error was caught, for coarse filtering in Metabase.
  source text not null default 'manual'
    check (source in ('global', 'boundary', 'query', 'mutation', 'manual')),
  -- The error's constructor name / class (e.g. 'TypeError', 'PostgrestError').
  error_type text
    check (error_type is null or char_length(error_type) <= 128),
  message text not null
    check (char_length(message) between 1 and 4096),
  -- Truncated client-side; capped here as a backstop.
  stack text
    check (stack is null or char_length(stack) <= 8192),
  -- Was this a fatal/uncaught crash (global handler or error boundary) vs a
  -- handled error the app recovered from?
  fatal boolean not null default false,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  profile_id uuid default auth.uid(),
  session_id uuid,
  platform text
    check (platform is null or platform in ('ios', 'android', 'web')),
  app_version text
    check (app_version is null or char_length(app_version) <= 32),
  -- Small non-identifying context bag (route, query key, etc.).
  context jsonb not null default '{}'::jsonb
    check (pg_column_size(context) <= 8192)
);

comment on table public.client_errors is
  'Append-only client error/crash log. Insert-only for clients; read via analytics.errors_* views + BI role. May contain incidental PII in message/stack.';

-- BRIN suits an insert-ordered stream: tiny index, fast range scans.
create index if not exists idx_client_errors_received_brin
  on public.client_errors using brin (received_at);
create index if not exists idx_client_errors_source
  on public.client_errors (source);

alter table public.client_errors enable row level security;

-- INSERT-only, and never on someone else's behalf. No select/update/delete
-- policies exist, so those are denied outright under RLS.
drop policy if exists "client_errors insert" on public.client_errors;
create policy "client_errors insert" on public.client_errors
  for insert to anon, authenticated
  with check (profile_id is null or profile_id = auth.uid());

-- Supabase's default privileges grant broadly; claw back everything except
-- insert. service_role keeps full access for operator maintenance.
revoke all on table public.client_errors from anon, authenticated;
grant insert on table public.client_errors to anon, authenticated;

-- Recent errors, newest first — the working list an operator scans in
-- Metabase. Exposes raw message + stack by design (see header note).
create or replace view analytics.errors_recent as
select received_at,
       occurred_at,
       source,
       fatal,
       error_type,
       message,
       stack,
       platform,
       app_version,
       profile_id,
       session_id,
       context
from public.client_errors
order by received_at desc;

-- Daily rollup: error volume by day/source, plus distinct sessions/profiles
-- affected — for a trend chart and to spot a spike after a release.
create or replace view analytics.errors_daily as
select (received_at at time zone 'UTC')::date as day,
       source,
       count(*)                               as error_count,
       count(*) filter (where fatal)          as fatal_count,
       count(distinct session_id)             as sessions_affected,
       count(distinct profile_id)             as profiles_affected
from public.client_errors
group by 1, 2
order by 1 desc, 3 desc;

-- The BI role is created out-of-band (admin-scripts). Grant only if present so
-- this migration works on a fresh database too. (Default privileges on the
-- analytics schema already cover future views, but grant explicitly in case
-- they were not configured.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'metabase_ro') then
    grant select on analytics.errors_recent to metabase_ro;
    grant select on analytics.errors_daily  to metabase_ro;
  end if;
end $$;
