-- purge_user() — one canonical implementation of "remove this user and their
-- created portfolios, transferring any shared ones to a surviving member."
--
-- Both self-serve deletion (delete_own_account) and the admin helper
-- (admin_delete_user) delegate here, so the transfer/cascade logic lives in
-- exactly one place instead of being copy-pasted across three scripts (which
-- had already drifted: the RPC transferred while the admin scripts refused).
--
-- SECURITY: this takes an arbitrary target uuid, so it must never be reachable
-- by app roles. Execute is revoked from anon/authenticated/service_role; only
-- the SECURITY DEFINER callers (which run as the owner) and Studio/postgres can
-- invoke it. delete_own_account passes auth.uid() and nothing else, so an
-- authenticated caller can still only ever remove themselves.

create or replace function public.purge_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  p_id uuid;
  successor uuid;
begin
  if target is null then
    raise exception 'purge_user: target is null' using errcode = '22004';
  end if;

  for p_id in
    select id from public.portfolios where created_by = target
  loop
    -- Most-privileged surviving member; ties broken by id for a deterministic
    -- pick (portfolio_members has no join timestamp, so there's no true
    -- "oldest" — id is a random uuid, used only for stable ordering).
    select pm.profile_id
      into successor
      from public.portfolio_members pm
     where pm.portfolio_id = p_id
       and pm.profile_id <> target
     order by
       case pm.role
         when 'owner'  then 0
         when 'editor' then 1
         when 'viewer' then 2
       end,
       pm.id
     limit 1;

    if successor is null then
      -- Solo portfolio: delete it (cascades all its scoped data).
      delete from public.portfolios where id = p_id;
    else
      -- Shared: transfer ownership so the group keeps their data.
      update public.portfolios
         set created_by = successor
       where id = p_id;

      update public.portfolio_members
         set role = 'owner'
       where portfolio_id = p_id
         and profile_id = successor;

      delete from public.portfolio_members
       where portfolio_id = p_id
         and profile_id = target;
    end if;
  end loop;

  -- Removes the auth user; profiles + remaining memberships cascade from here.
  delete from auth.users where id = target;
end;
$$;

revoke all on function public.purge_user(uuid) from public;
revoke all on function public.purge_user(uuid) from anon;
revoke all on function public.purge_user(uuid) from authenticated;
revoke all on function public.purge_user(uuid) from service_role;

-- delete_own_account() is now a thin, self-only wrapper over purge_user().
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  perform public.purge_user(uid);
end;
$$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
