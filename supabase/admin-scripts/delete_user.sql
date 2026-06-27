-- delete_user.sql
--
-- Hard-delete a Supabase Auth user and every WanderFree row keyed off
-- them.
--
-- For repeated deletions (e.g. testing onboarding), prefer the function:
--   1. Run _install_admin_functions.sql once.
--   2. Then `select admin_delete_user('user@example.com');` from then on.
-- This file is the standalone path — no function install required.
--
-- Cascade chain (current schema):
--   auth.users -> profiles                (CASCADE)
--   profiles -> portfolio_members         (CASCADE)
--   profiles <- portfolios.created_by     (RESTRICT)   ← blocks the cascade
--   portfolios -> wallet_accounts         (CASCADE)
--   portfolios -> user_cards              (CASCADE)
--   user_cards -> user_benefit_cycles     (CASCADE)
--   user_cards -> benefit_redemptions     (CASCADE)
--   user_cards -> user_signup_bonuses     (CASCADE)
--   user_cards -> spend_entries           (CASCADE)
--
-- Because portfolios.created_by is RESTRICT, deleting auth.users alone
-- fails for anyone who has ever created a portfolio. We delete their
-- created portfolios first, which cascades through the portfolio-scoped
-- tree. Portfolios they're only a MEMBER of are kept; the membership
-- row is removed via the profiles cascade.
--
-- CAVEAT: if a portfolio this user created has other members, those
-- members lose access to all data hanging off it. Run
-- delete_user_preview.sql first if you need to check.
--
-- Usage:
--   1. Replace 'PASTE_EMAIL_HERE' below.
--   2. Run in Supabase Studio's SQL Editor.

do $$
declare
  target_email   text := 'PASTE_EMAIL_HERE';
  target_user_id uuid;
begin
  select id into target_user_id from auth.users where email = target_email;
  if target_user_id is null then
    raise notice 'No auth user found with email %  — nothing deleted.', target_email;
    return;
  end if;

  delete from public.portfolios where created_by = target_user_id;
  delete from auth.users where id = target_user_id;

  raise notice 'Deleted user % (id=%).', target_email, target_user_id;
end
$$;
