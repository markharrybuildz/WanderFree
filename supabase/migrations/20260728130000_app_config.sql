-- app_config: a single-row store of public feature flags read by the mobile
-- client. Non-sensitive UI config only (kill-switches, WIP gating) — anyone
-- can READ it (anon + authenticated); there is no client WRITE policy, so it
-- is edited exclusively via Supabase Studio / service_role, matching the
-- admin-tooling posture (Studio + SQL, no admin app yet).

create table if not exists public.app_config (
  id boolean primary key default true,
  flags jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  -- Singleton guard: only one row (id = true) can ever exist.
  constraint app_config_singleton check (id)
);

alter table public.app_config enable row level security;

-- Public read: these flags are non-sensitive presentation config.
drop policy if exists "app_config read" on public.app_config;
create policy "app_config read" on public.app_config
  for select to anon, authenticated using (true);

grant select on public.app_config to anon, authenticated;

-- Keep updated_at fresh on edits (reuses the shared trigger function).
drop trigger if exists trg_app_config_updated on public.app_config;
create trigger trg_app_config_updated
  before update on public.app_config
  for each row execute function public.set_updated_at();

-- Seed the single row so the client always reads exactly one.
insert into public.app_config (id, flags)
values (true, '{}'::jsonb)
on conflict (id) do nothing;
