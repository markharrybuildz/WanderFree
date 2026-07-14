-- analytics_reporting_role.sql
--
-- One-time per environment. Creates a READ-ONLY Postgres login role for the BI
-- tool (Metabase). It can read ONLY the curated analytics.* views — never the
-- public base tables — so it sees aggregates with no raw per-user rows and no
-- PII, and it cannot write anything.
--
-- Usage:
--   1. Replace 'REPLACE_WITH_A_STRONG_PASSWORD' below with a strong password.
--      Store it in your password manager — do NOT commit it.
--   2. Run in Supabase Studio's SQL Editor (after the analytics views migration
--      20260711120000_analytics_views.sql has been applied).
--   3. Connect Metabase using this role — see README.md ("Analytics / Metabase").
--
-- Re-runnable: creating the role is guarded; the grants are idempotent. To
-- rotate the password later: alter role metabase_ro password '<new>';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'metabase_ro') then
    create role metabase_ro with login password 'REPLACE_WITH_A_STRONG_PASSWORD';
  end if;
end $$;

grant connect on database postgres to metabase_ro;
grant usage  on schema analytics to metabase_ro;
grant select on all tables in schema analytics to metabase_ro;

-- Future analytics views are readable without re-granting.
alter default privileges in schema analytics grant select on tables to metabase_ro;

-- Land the role straight in the analytics schema.
alter role metabase_ro set search_path = analytics;

-- Note on isolation: metabase_ro is never granted SELECT on any public base
-- table, and every domain table has RLS enabled, so even if it reached the
-- public schema it would see zero rows. Its only data access is the analytics
-- views above (which run with the view owner's rights by design).
