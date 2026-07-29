-- pgTAP: Row Level Security isolation between portfolios.
--
-- The whole product's data protection rests on RLS: per-portfolio data is
-- gated by is_portfolio_member() / can_access_user_card(), keyed off
-- auth.uid(). This asserts a member can read their portfolio's rows and a
-- non-member cannot — the security property that must never regress.
--
-- We simulate an authenticated user by switching to the `authenticated` role
-- and setting the JWT claims GUC that auth.uid() reads.
--
-- Run: supabase start && supabase test db

begin;
select plan(4);

-- ── Seed as the (superuser) test role, so RLS is bypassed while setting up ──
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'a@test.dev'),
  ('b1111111-1111-1111-1111-111111111111', 'b@test.dev');
insert into public.profiles (id) values
  ('a1111111-1111-1111-1111-111111111111'),
  ('b1111111-1111-1111-1111-111111111111')
  on conflict (id) do nothing;

-- User A owns/belongs to portfolio A; user B to portfolio B (disjoint).
insert into public.portfolios (id, name, created_by) values
  ('a2222222-2222-2222-2222-222222222222', 'A', 'a1111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'B', 'b1111111-1111-1111-1111-111111111111');
insert into public.portfolio_members (portfolio_id, profile_id) values
  ('a2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111'),
  ('b2222222-2222-2222-2222-222222222222', 'b1111111-1111-1111-1111-111111111111');

insert into public.card_issuers (id, name)
values ('c3333333-3333-3333-3333-333333333333', 'Bank');
insert into public.rewards_programs (id, name)
values ('c4444444-4444-4444-4444-444444444444', 'Points');
insert into public.card_products (id, issuer_id, rewards_program_id, name)
values ('c5555555-5555-5555-5555-555555555555',
        'c3333333-3333-3333-3333-333333333333',
        'c4444444-4444-4444-4444-444444444444', 'Card');

-- One card + one spend entry, both under portfolio A.
insert into public.user_cards (id, portfolio_id, card_product_id)
values ('a6666666-6666-6666-6666-666666666666',
        'a2222222-2222-2222-2222-222222222222',
        'c5555555-5555-5555-5555-555555555555');
insert into public.user_signup_bonuses (id, user_card_id, required_spend)
values ('a7777777-7777-7777-7777-777777777777',
        'a6666666-6666-6666-6666-666666666666', 1000);
insert into public.spend_entries (id, user_card_id, signup_bonus_id, amount)
values ('a8888888-8888-8888-8888-888888888888',
        'a6666666-6666-6666-6666-666666666666',
        'a7777777-7777-7777-7777-777777777777', 50);

-- ── As user A (member of the portfolio holding the card): can read ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.spend_entries
   where id = 'a8888888-8888-8888-8888-888888888888'),
  1, 'member CAN read their own portfolio''s spend_entries');

select is(
  (select count(*)::int from public.user_cards
   where id = 'a6666666-6666-6666-6666-666666666666'),
  1, 'member CAN read their own portfolio''s user_cards');

-- ── As user B (NOT a member of portfolio A): must see nothing ───────────────
set local request.jwt.claims = '{"sub":"b1111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.spend_entries
   where id = 'a8888888-8888-8888-8888-888888888888'),
  0, 'non-member CANNOT read another portfolio''s spend_entries (RLS)');

select is(
  (select count(*)::int from public.user_cards
   where id = 'a6666666-6666-6666-6666-666666666666'),
  0, 'non-member CANNOT read another portfolio''s user_cards (RLS)');

reset role;
select * from finish();
rollback;
