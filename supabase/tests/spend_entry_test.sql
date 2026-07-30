-- pgTAP: spend-entry money logic — the highest-stakes server-side behavior.
--
-- Covers remove_spend_entry (20260728120000) and its interaction with the
-- signup-bonus completion flip and the wallet-credit trigger
-- (apply_bonus_wallet_credit, 20260716120000), plus a complementary
-- add_spend_entry completion check.
--
-- Run: supabase start && supabase test db
-- These call the functions as the (superuser) test role, so they exercise the
-- LOGIC, not RLS. RLS isolation is covered separately in rls_test.sql.

begin;
select plan(12);

-- ── Fixtures (fixed UUIDs so rows can be referenced by id) ──────────────────
-- profiles.id -> auth.users.id, so create the auth user first; the
-- handle_new_user trigger (or the explicit insert below) yields the profile.
insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'owner@test.dev');
insert into public.profiles (id) values ('11111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

insert into public.portfolios (id, name, created_by)
values ('22222222-2222-2222-2222-222222222222', 'Test Portfolio',
        '11111111-1111-1111-1111-111111111111');
insert into public.portfolio_members (portfolio_id, profile_id)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111');

insert into public.card_issuers (id, name)
values ('33333333-3333-3333-3333-333333333333', 'Test Bank');
insert into public.rewards_programs (id, name)
values ('44444444-4444-4444-4444-444444444444', 'Test Points');
insert into public.card_products (id, issuer_id, rewards_program_id, name)
values ('55555555-5555-5555-5555-555555555555',
        '33333333-3333-3333-3333-333333333333',
        '44444444-4444-4444-4444-444444444444', 'Test Card');
insert into public.user_cards (id, portfolio_id, card_product_id)
values ('66666666-6666-6666-6666-666666666666',
        '22222222-2222-2222-2222-222222222222',
        '55555555-5555-5555-5555-555555555555');

-- Bonus: $1,000 required, $500 value, starts incomplete.
insert into public.user_signup_bonuses
  (id, user_card_id, required_spend, bonus_value, is_completed)
values ('77777777-7777-7777-7777-777777777777',
        '66666666-6666-6666-6666-666666666666', 1000, 500, false);

-- Two $600 entries (total $1,200 >= $1,000).
insert into public.spend_entries (id, user_card_id, signup_bonus_id, amount)
values ('88888888-8888-8888-8888-888888888888',
        '66666666-6666-6666-6666-666666666666',
        '77777777-7777-7777-7777-777777777777', 600),
       ('99999999-9999-9999-9999-999999999999',
        '66666666-6666-6666-6666-666666666666',
        '77777777-7777-7777-7777-777777777777', 600);

-- Complete the bonus, which fires apply_bonus_wallet_credit.
update public.user_signup_bonuses set is_completed = true
where id = '77777777-7777-7777-7777-777777777777';

-- ── Setup assertions: completed + credited ──────────────────────────────────
select is(
  (select is_completed from public.user_signup_bonuses
   where id = '77777777-7777-7777-7777-777777777777'),
  true, 'bonus is completed after crossing required spend');

select is(
  (select credited_amount from public.user_signup_bonuses
   where id = '77777777-7777-7777-7777-777777777777'),
  500::numeric, 'credited_amount ledger records the credited value');

select is(
  (select balance from public.wallet_accounts
   where portfolio_id = '22222222-2222-2222-2222-222222222222'
     and rewards_program_id = '44444444-4444-4444-4444-444444444444'),
  500::numeric, 'wallet credited by the bonus value');

-- ── Act: remove one $600 entry -> total $600 < $1,000 ───────────────────────
select public.remove_spend_entry('88888888-8888-8888-8888-888888888888');

select is(
  (select count(*)::int from public.spend_entries
   where signup_bonus_id = '77777777-7777-7777-7777-777777777777'),
  1, 'the removed entry is gone');

select is(
  (select is_completed from public.user_signup_bonuses
   where id = '77777777-7777-7777-7777-777777777777'),
  false, 'bonus un-completes when spend drops below required');

select is(
  (select credited_amount from public.user_signup_bonuses
   where id = '77777777-7777-7777-7777-777777777777'),
  null, 'credited_amount ledger clears on reversal');

select is(
  (select balance from public.wallet_accounts
   where portfolio_id = '22222222-2222-2222-2222-222222222222'
     and rewards_program_id = '44444444-4444-4444-4444-444444444444'),
  0::numeric, 'wallet credit is reversed exactly');

-- ── Remove the remaining linked entry -> no error, stays incomplete ─────────
select public.remove_spend_entry('99999999-9999-9999-9999-999999999999');

select is(
  (select count(*)::int from public.spend_entries
   where signup_bonus_id = '77777777-7777-7777-7777-777777777777'),
  0, 'all linked entries removed');

select is(
  (select is_completed from public.user_signup_bonuses
   where id = '77777777-7777-7777-7777-777777777777'),
  false, 'bonus stays incomplete at zero spend');

-- ── Edge: unlinked entry (no bonus) removes cleanly ─────────────────────────
insert into public.spend_entries (id, user_card_id, signup_bonus_id, amount)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        '66666666-6666-6666-6666-666666666666', null, 42.50);
select public.remove_spend_entry('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is(
  (select count(*)::int from public.spend_entries
   where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  0, 'unlinked entry removes with no bonus recompute');

-- ── Edge: removing a nonexistent entry is a safe no-op ──────────────────────
select lives_ok(
  $$ select public.remove_spend_entry('cccccccc-cccc-cccc-cccc-cccccccccccc') $$,
  'removing a nonexistent entry does not error');

-- ── Complement: add_spend_entry completes a fresh bonus ─────────────────────
insert into public.user_signup_bonuses
  (id, user_card_id, required_spend, bonus_value, is_completed)
values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        '66666666-6666-6666-6666-666666666666', 100, 250, false);
select public.add_spend_entry(
  '66666666-6666-6666-6666-666666666666', 150, current_date,
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select is(
  (select is_completed from public.user_signup_bonuses
   where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  true, 'add_spend_entry completes a bonus when spend crosses required');

select * from finish();
rollback;
