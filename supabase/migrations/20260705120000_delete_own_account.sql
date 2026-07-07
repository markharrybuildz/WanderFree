-- delete_own_account()
--
-- Self-serve account deletion. Callable by any signed-in user for THEIR OWN
-- account only: it acts solely on auth.uid() and takes no target argument, so
-- a caller can never delete anyone else. Runs `security definer` so it can
-- remove the auth.users row; execute is granted to `authenticated`.
--
-- Deleting the auth user cascades profiles -> portfolio_members, and the
-- portfolios this user created cascade all their portfolio-scoped data
-- (wallet_accounts, user_cards, user_benefit_cycles, benefit_redemptions,
-- user_signup_bonuses, spend_entries).
--
-- Guard: refuses if the caller still owns a portfolio shared with OTHER
-- members, because deleting it would wipe those members' data (and the
-- RESTRICT FK on portfolios.created_by would block the delete anyway). They
-- must remove the other members (or hand off ownership) first.

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

  if exists (
    select 1
      from public.portfolios p
      join public.portfolio_members pm on pm.portfolio_id = p.id
     where p.created_by = uid
       and pm.profile_id <> uid
  ) then
    raise exception
      'You still own a portfolio shared with other members. Remove the other members first, then delete your account.'
      using errcode = 'P0001';
  end if;

  -- Portfolios this user created (cascades all their scoped data). Portfolios
  -- they merely belong to are left intact; their membership rows cascade when
  -- the auth user is removed below.
  delete from public.portfolios where created_by = uid;

  -- Removes the auth user; profiles + portfolio_members cascade from here.
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
revoke all on function public.delete_own_account() from anon;
grant execute on function public.delete_own_account() to authenticated;
