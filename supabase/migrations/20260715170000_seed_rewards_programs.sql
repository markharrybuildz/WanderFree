-- Seed rewards_programs and backfill card_products.rewards_program_id.
--
-- The catalog was populated before rewards programs were modeled, so
-- rewards_programs was empty and every card_product had a null program —
-- which left the Points screen with nothing to group by.
--
-- Mapping principles:
--   * Co-branded cards map to the PARTNER program (Delta cards are
--     Amex-issued but earn SkyMiles; United cards are Chase-issued but earn
--     MileagePlus), so partner patterns run before issuer patterns.
--   * All cash-back cards pool into one generic "Cash back" program —
--     dollars are dollars, and one wallet row keeps the Points screen sane.
--   * True non-rewards cards (Citi Simplicity, balance-transfer cards,
--     secured cards with no earn) stay NULL on purpose; the app shows them
--     under "No rewards program".
--
-- Idempotent: inserts are guarded by name, updates only touch NULL links.

insert into public.rewards_programs (name, unit_type)
select v.name, v.unit_type::public.program_unit_type
from (values
  ('Chase Ultimate Rewards',              'points'),
  ('American Express Membership Rewards', 'points'),
  ('Citi ThankYou Points',                'points'),
  ('Capital One Miles',                   'miles'),
  ('Bilt Points',                         'points'),
  ('Wells Fargo Rewards',                 'points'),
  ('U.S. Bank Altitude Points',           'points'),
  ('Bank of America Rewards',             'points'),
  ('Navy Federal Rewards',                'points'),
  ('USAA Rewards',                        'points'),
  ('TD Rewards',                          'points'),
  ('Discover Miles',                      'miles'),
  ('Cash back',                           'cash_back'),
  ('Delta SkyMiles',                      'miles'),
  ('Hilton Honors',                       'points'),
  ('Marriott Bonvoy',                     'points'),
  ('Atmos Rewards',                       'points'),
  ('JetBlue TrueBlue',                    'points'),
  ('Wyndham Rewards',                     'points'),
  ('United MileagePlus',                  'miles'),
  ('Southwest Rapid Rewards',             'points'),
  ('World of Hyatt',                      'points'),
  ('IHG One Rewards',                     'points'),
  ('American Airlines AAdvantage',        'miles'),
  ('Norwegian WorldPoints',               'points'),
  ('MyCruise Rewards',                    'points')
) as v(name, unit_type)
where not exists (
  select 1 from public.rewards_programs rp where rp.name = v.name
);

-- Helper expression used below: link by program name, only when unlinked.
-- (Plain UPDATEs; first match wins because every statement guards on NULL.)

-- ── Co-brand partners first ────────────────────────────────────────────────
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Delta SkyMiles')
  where rewards_program_id is null and name ilike '%delta skymiles%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Hilton Honors')
  where rewards_program_id is null and name ilike '%hilton%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Marriott Bonvoy')
  where rewards_program_id is null and name ilike '%marriott%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Atmos Rewards')
  where rewards_program_id is null and name ilike '%atmos%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'JetBlue TrueBlue')
  where rewards_program_id is null and name ilike '%jetblue%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Wyndham Rewards')
  where rewards_program_id is null and name ilike '%wyndham%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'United MileagePlus')
  where rewards_program_id is null and name ilike 'united %';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Southwest Rapid Rewards')
  where rewards_program_id is null and name ilike '%southwest%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'World of Hyatt')
  where rewards_program_id is null and name ilike '%hyatt%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'IHG One Rewards')
  where rewards_program_id is null and name ilike '%ihg%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'American Airlines AAdvantage')
  where rewards_program_id is null and name ilike '%aadvantage%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Norwegian WorldPoints')
  where rewards_program_id is null and name ilike '%norwegian%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'MyCruise Rewards')
  where rewards_program_id is null and name ilike 'royal one%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Bilt Points')
  where rewards_program_id is null and name ilike 'bilt %';

-- ── Bank transferable currencies ───────────────────────────────────────────
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Chase Ultimate Rewards')
  where rewards_program_id is null
    and (name ilike '%sapphire%' or name ilike '%freedom%' or name ilike '%ink business%');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Capital One Miles')
  where rewards_program_id is null
    and (name ilike '%venture%' or name ilike '%spark miles%');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'American Express Membership Rewards')
  where rewards_program_id is null and name in (
    'American Express Business Gold Card',
    'American Express Gold Card',
    'American Express Green Card',
    'American Express Platinum Card',
    'Amex EveryDay Credit Card',
    'The Blue Business Plus Card from American Express',
    'The Business Platinum Card from American Express'
  );
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Citi ThankYou Points')
  where rewards_program_id is null
    and (name ilike 'citi strata%'
      or name = 'Citi Double Cash Card'
      or name = 'Citi Custom Cash Card');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Wells Fargo Rewards')
  where rewards_program_id is null and name ilike '%autograph%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'U.S. Bank Altitude Points')
  where rewards_program_id is null
    and (name ilike '%altitude%' or name ilike '%business leverage%');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Bank of America Rewards')
  where rewards_program_id is null
    and (name ilike 'bank of america premium rewards%'
      or name ilike '%advantage travel rewards%'
      or name = 'Bank of America Travel Rewards Credit Card');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Navy Federal Rewards')
  where rewards_program_id is null
    and (name ilike 'navy federal flagship%' or name ilike 'navy federal more rewards%');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'USAA Rewards')
  where rewards_program_id is null
    and (name = 'USAA Eagle Navigator Visa Signature Credit Card'
      or name = 'USAA Rewards Visa Signature Card');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'TD Rewards')
  where rewards_program_id is null and name ilike 'td first class%';
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Discover Miles')
  where rewards_program_id is null and name = 'Discover it Miles';

-- ── Cash back: pattern catch-all, then explicit stragglers ────────────────
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Cash back')
  where rewards_program_id is null
    and (name ilike '%cash%' or name ilike '%cashback%');
update public.card_products set rewards_program_id =
  (select id from public.rewards_programs where name = 'Cash back')
  where rewards_program_id is null and name in (
    'Apple Card',
    'Amazon Prime Rewards Visa Signature',
    'Costco Anywhere Visa Card by Citi',
    'Sam''s Club Mastercard',
    'Disney Premier Visa Card',
    'Disney Visa Card',
    'Synchrony Premier World Mastercard',
    'U.S. Bank Smartly Visa Signature Card',
    'Discover it Secured Credit Card',
    'TD Double Up Credit Card'
  );

-- Intentionally left NULL (no rewards earn): Citi Diamond Preferred, Citi
-- Simplicity, Wells Fargo Reflect, Capital One Platinum (+ Secured),
-- BankAmericard, Navy Federal Platinum, USAA Rate Advantage, U.S. Bank
-- Secured Visa, TD FlexPay.
