-- delete_user_preview.sql
--
-- Show every row that admin_delete_user() would touch for a given email.
-- Read-only — safe to run anytime.
--
-- Note: a portfolio the target created that is SHARED with other members is
-- transferred to a surviving member (not deleted). Solo portfolios they
-- created are deleted and cascade all their data. Portfolios they are only a
-- member of are kept; only their membership row is removed.
--
-- Usage:
--   1. Replace 'PASTE_EMAIL_HERE' below.
--   2. Run in Supabase Studio's SQL Editor.
--   3. Review the listings; if they look right, run
--      `select admin_delete_user('<email>');`.

with params as (
  select 'PASTE_EMAIL_HERE'::text as email
),
target as (
  select u.id, u.email
    from auth.users u
    join params p on u.email = p.email
),
created as (
  -- Portfolios the target created, flagged solo vs shared. Solo ones are
  -- deleted (cascading their data); shared ones are transferred and kept.
  select p.id,
         p.name,
         exists (
           select 1 from public.portfolio_members pm
            where pm.portfolio_id = p.id
              and pm.profile_id <> (select id from target)
         ) as shared
    from public.portfolios p
   where p.created_by = (select id from target)
),
solo_portfolios as (
  select id from created where not shared
),
their_cards as (
  select uc.id from public.user_cards uc
   where uc.portfolio_id in (select id from solo_portfolios)
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
select 'portfolio (solo — will be DELETED with all its data)',
       c.id::text,
       c.name || ' — members: 1 (just this user)'
  from created c
 where not c.shared
union all
select 'portfolio (shared — will be TRANSFERRED to a surviving member; kept)',
       c.id::text,
       c.name
         || ' — total members: '
         || (select count(*)::text from public.portfolio_members pm where pm.portfolio_id = c.id)
  from created c
 where c.shared
union all
-- On each transferred portfolio, the target's own membership row is removed too
-- (ownership moves to the successor; the target no longer belongs).
select 'own membership on transferred portfolio (will be removed)',
       c.id::text,
       'role=' || pm.role::text || ' on ' || c.name
  from created c
  join public.portfolio_members pm
    on pm.portfolio_id = c.id and pm.profile_id = (select id from target)
 where c.shared
union all
select 'portfolio membership (will be removed; portfolio kept)',
       pm.portfolio_id::text,
       'role=' || pm.role::text
  from public.portfolio_members pm
  join target t on t.id = pm.profile_id
  join public.portfolios p on p.id = pm.portfolio_id
 where p.created_by <> t.id
union all
-- cascade row counts under SOLO portfolios -> their_cards (only these delete)
select 'cascade count',
       'wallet_accounts',
       (select count(*)::text from public.wallet_accounts where portfolio_id in (select id from solo_portfolios))
union all
select 'cascade count',
       'user_cards',
       (select count(*)::text from public.user_cards where portfolio_id in (select id from solo_portfolios))
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
-- Other members of the target's SHARED portfolios. They keep access; the
-- portfolio is transferred to a surviving member (see purge_user()).
select 'shared-portfolio member (KEEPS ACCESS — portfolio transferred)',
       pm.profile_id::text,
       coalesce(pr.display_name, '(no display name)') || ' — portfolio: ' || c.name
  from public.portfolio_members pm
  join created c on c.id = pm.portfolio_id and c.shared
  left join public.profiles pr on pr.id = pm.profile_id
 where pm.profile_id <> (select id from target)
order by kind, id;
