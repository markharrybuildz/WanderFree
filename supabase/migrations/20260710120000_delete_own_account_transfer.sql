-- delete_own_account() — v2: never dead-ends.
--
-- v1 REFUSED when the caller still owned a portfolio shared with other
-- members, which left those users with no in-app way to delete their
-- account (App Store Guideline 5.1.1(v) requires account deletion to always
-- be possible). This version instead TRANSFERS ownership of any shared
-- portfolio to a surviving member, so deletion always succeeds and no other
-- member's data is ever destroyed.
--
-- Per created portfolio:
--   * has other members  -> hand created_by to a successor (most-privileged,
--                           then lowest id for determinism), promote them to
--                           'owner', and drop the departing user's membership.
--   * solo (no others)   -> delete it; cascades all portfolio-scoped data
--                           (wallet_accounts, user_cards, user_benefit_cycles,
--                           benefit_redemptions, user_signup_bonuses,
--                           spend_entries).
-- Then the auth user is removed; profiles + any remaining membership rows
-- cascade. Because no portfolio still has created_by = uid at that point, the
-- RESTRICT FK on portfolios.created_by no longer blocks the delete.
--
-- Still self-only: acts solely on auth.uid(), takes no argument.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  uid uuid := auth.uid();
  p_id uuid;
  successor uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  for p_id in
    select id from public.portfolios where created_by = uid
  loop
    -- Most-privileged surviving member, oldest by id to break ties.
    select pm.profile_id
      into successor
      from public.portfolio_members pm
     where pm.portfolio_id = p_id
       and pm.profile_id <> uid
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
         and profile_id = uid;
    end if;
  end loop;

  -- Removes the auth user; profiles + remaining memberships cascade from here.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
