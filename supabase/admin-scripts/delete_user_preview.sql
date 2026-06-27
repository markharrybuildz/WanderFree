-- delete_user_preview.sql
--
-- Show every row that delete_user.sql (or admin_delete_user()) would
-- touch for a given email. Read-only — safe to run anytime.
--
-- Usage:
--   1. Replace 'PASTE_EMAIL_HERE' below.
--   2. Run in Supabase Studio's SQL Editor.
--   3. Review the listings; if they look right, run the destructive
--      script.

with params as (
  select 'PASTE_EMAIL_HERE'::text as email
),
target as (
  select u.id, u.email
    from auth.users u
    join params p on u.email = p.email
),
their_portfolios as (
  select p.id from public.portfolios p join target t on t.id = p.created_by
),
their_cards as (
  select uc.id from public.user_cards uc
   where uc.portfolio_id in (select id from their_portfolios)
)
select 'auth user' as kind,
       u.id::text   as id,
       u.email      as detail
  from auth.users u
  join target t on t.id = u.id
union all
select 'profile',
       p.id::text,
       coalesce(p.display_name, '(no display name)')
  from public.profiles p
  join target t on t.id = p.id
union all
select 'portfolio (creator — will be deleted, taking all its data)',
       p.id::text,
       p.name
         || ' — total members: '
         || (select count(*)::text from public.portfolio_members pm where pm.portfolio_id = p.id)
         || ' (other members lose access)'
  from public.portfolios p
  join target t on t.id = p.created_by
union all
select 'portfolio membership (will be removed; portfolio kept)',
       pm.portfolio_id::text,
       'role=' || pm.role::text
  from public.portfolio_members pm
  join target t on t.id = pm.profile_id
  join public.portfolios p on p.id = pm.portfolio_id
 where p.created_by <> t.id
union all
-- cascade row counts under their_portfolios -> their_cards
select 'cascade count',
       'wallet_accounts',
       (select count(*)::text from public.wallet_accounts where portfolio_id in (select id from their_portfolios))
union all
select 'cascade count',
       'user_cards',
       (select count(*)::text from public.user_cards where portfolio_id in (select id from their_portfolios))
union all
select 'cascade count',
       'user_benefit_cycles',
       (select count(*)::text from public.user_benefit_cycles where user_card_id in (select id from their_cards))
union all
select 'cascade count',
       'benefit_redemptions',
       (select count(*)::text from public.benefit_redemptions where user_card_id in (select id from their_cards))
union all
select 'cascade count',
       'user_signup_bonuses',
       (select count(*)::text from public.user_signup_bonuses where user_card_id in (select id from their_cards))
union all
select 'cascade count',
       'spend_entries',
       (select count(*)::text from public.spend_entries where user_card_id in (select id from their_cards))
union all
-- Other members who lose access when the creator's portfolios are deleted.
select 'shared-portfolio member (LOSES ACCESS)',
       pm.profile_id::text,
       coalesce(pr.display_name, '(no display name)') || ' — portfolio: ' || p.name
  from public.portfolio_members pm
  join their_portfolios tp on tp.id = pm.portfolio_id
  join public.portfolios p on p.id = pm.portfolio_id
  left join public.profiles pr on pr.id = pm.profile_id
  join target t on true
 where pm.profile_id <> t.id
order by kind, id;
