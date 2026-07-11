-- _install_admin_functions.sql
--
-- Run ONCE per environment, in Supabase Studio's SQL Editor.
-- Installs admin helper functions that you call repeatedly afterwards.
--
-- Heads up: these functions live in the `public` schema. If you later
-- run `supabase db pull`, they will be captured in a migration. That's
-- fine if you want them in source control; if not, drop them before
-- pulling.

-- admin_delete_user(target_email)
--
-- Deletes a Supabase Auth user and every WanderFree row keyed off them, by
-- delegating to public.purge_user() — the one canonical implementation (see
-- migration 20260710130000_purge_user_helper.sql). Any portfolio the target
-- created that is shared with other members is TRANSFERRED to a surviving
-- member rather than deleted, so no one else's data is destroyed. Solo
-- portfolios are deleted and cascade all their hanging data.
--
-- Requires purge_user() to exist in the DB (it ships in the migration above).
--
-- Usage:
--   select admin_delete_user('user@example.com');
create or replace function public.admin_delete_user(target_email text)
returns text
language plpgsql
security invoker
set search_path = public, auth, pg_temp
as $$
declare
  target_user_id uuid;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then
    return format('No auth user found with email %L — nothing deleted.', target_email);
  end if;

  perform public.purge_user(target_user_id);

  return format(
    'Deleted user %s (id=%s). Solo portfolios cascade-deleted; any shared ones were transferred to a surviving member.',
    target_email, target_user_id
  );
end;
$$;

-- Lock it down: Studio's SQL editor runs as postgres (always allowed);
-- everyone else must not be able to call this via PostgREST.
revoke all on function public.admin_delete_user(text) from public;
revoke all on function public.admin_delete_user(text) from anon;
revoke all on function public.admin_delete_user(text) from authenticated;
revoke all on function public.admin_delete_user(text) from service_role;
