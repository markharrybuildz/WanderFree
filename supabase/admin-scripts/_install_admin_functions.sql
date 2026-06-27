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
-- Hard-deletes a Supabase Auth user and every WanderFree row keyed off
-- them. See delete_user.sql for the cascade chain and caveats — this
-- function is the same operation, just packaged for repeated calls.
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
  portfolio_count int := 0;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then
    return format('No auth user found with email %L — nothing deleted.', target_email);
  end if;

  -- Guard: refuse if the target still owns portfolios shared with other
  -- members — deleting them would cascade-delete those members' data.
  if exists (
    select 1
      from public.portfolios p
      join public.portfolio_members pm on pm.portfolio_id = p.id
     where p.created_by = target_user_id
       and pm.profile_id <> target_user_id
  ) then
    return format(
      'Refusing to delete %s: they still own portfolios shared with other members. Reassign ownership or remove those members first.',
      target_email
    );
  end if;

  with deleted as (
    delete from public.portfolios where created_by = target_user_id returning 1
  )
  select count(*)::int into portfolio_count from deleted;

  delete from auth.users where id = target_user_id;

  return format(
    'Deleted user %s (id=%s) and %s portfolios they created (cascade removed all hanging data).',
    target_email, target_user_id, portfolio_count
  );
end;
$$;

-- Lock it down: Studio's SQL editor runs as postgres (always allowed);
-- everyone else must not be able to call this via PostgREST.
revoke all on function public.admin_delete_user(text) from public;
revoke all on function public.admin_delete_user(text) from anon;
revoke all on function public.admin_delete_user(text) from authenticated;
revoke all on function public.admin_delete_user(text) from service_role;
