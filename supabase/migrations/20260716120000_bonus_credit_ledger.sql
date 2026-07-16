-- Bonus wallet credit v2: track the amount actually credited (CodeRabbit,
-- PR #8), and backfill bonuses completed before the trigger/program links
-- existed.
--
-- Problems with v1 (20260715150000, already applied):
--   * Reversal used the CURRENT bonus_value — editing the value after
--     completion made un-completion reverse the wrong amount, and clearing
--     the value skipped reversal entirely.
--   * Editing bonus_value while completed adjusted nothing.
--   * Update-only trigger never credited bonuses that were ALREADY
--     completed when it (or the rewards-program links) arrived.
--
-- Fix: persist `credited_amount` on the bonus row as the ledger of what
-- was applied to the wallet. The trigger (now BEFORE, on is_completed OR
-- bonus_value changes) computes desired credit, applies the delta to the
-- wallet, and records it. Reversals and edits are exact by construction.

alter table public.user_signup_bonuses
  add column if not exists credited_amount numeric(12,2);

comment on column public.user_signup_bonuses.credited_amount is
  'Amount actually credited to the program wallet for this bonus (null = never credited). Maintained by trg_bonus_wallet_credit.';

create or replace function public.apply_bonus_wallet_credit() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_portfolio uuid;
  v_program uuid;
  v_desired numeric;
  v_delta numeric;
begin
  v_desired := case
    when new.is_completed and new.bonus_value is not null and new.bonus_value > 0
      then new.bonus_value
    else 0
  end;
  v_delta := v_desired - coalesce(old.credited_amount, 0);

  if v_delta = 0 then
    return new;
  end if;

  select uc.portfolio_id, cp.rewards_program_id
  into v_portfolio, v_program
  from public.user_cards uc
  join public.card_products cp on cp.id = uc.card_product_id
  where uc.id = new.user_card_id;

  -- No rewards program on the card product: nothing to credit against.
  if v_program is null then
    return new;
  end if;

  insert into public.wallet_accounts (portfolio_id, rewards_program_id, balance)
  values (v_portfolio, v_program, greatest(0, v_delta))
  on conflict (portfolio_id, rewards_program_id)
  do update set balance = greatest(0, public.wallet_accounts.balance + v_delta);

  new.credited_amount := nullif(v_desired, 0);
  return new;
end;
$$;

-- BEFORE (not AFTER) so the function can record credited_amount on the row;
-- also fires on bonus_value edits so post-completion corrections adjust the
-- wallet by the exact delta.
drop trigger if exists trg_bonus_wallet_credit on public.user_signup_bonuses;
create trigger trg_bonus_wallet_credit
  before update of is_completed, bonus_value on public.user_signup_bonuses
  for each row
  when (old.is_completed is distinct from new.is_completed
     or old.bonus_value is distinct from new.bonus_value)
  execute function public.apply_bonus_wallet_credit();

-- ── Backfill ───────────────────────────────────────────────────────────────
-- Two populations of completed bonuses with credited_amount null:
--   (a) credited by the v1 trigger (completed after it deployed
--       2026-07-15 ~23:00 UTC): the wallet already holds their value, so
--       just RECORD credited_amount without re-crediting.
--   (b) completed before any trigger existed (or before program links were
--       seeded): never credited — credit now and record.
-- updated_at (maintained by trg_signup_bonuses_updated) distinguishes them.
-- Idempotent: both paths require credited_amount is null.

-- (a) record-only for rows the v1 trigger already handled
update public.user_signup_bonuses b
set credited_amount = b.bonus_value
from public.user_cards uc
join public.card_products cp on cp.id = uc.card_product_id
where uc.id = b.user_card_id
  and cp.rewards_program_id is not null
  and b.is_completed
  and b.bonus_value > 0
  and b.credited_amount is null
  and b.updated_at >= timestamptz '2026-07-15 23:00:00+00';

-- (b) credit + record for pre-trigger completions
with pending as (
  select b.id as bonus_id, b.bonus_value, uc.portfolio_id, cp.rewards_program_id
  from public.user_signup_bonuses b
  join public.user_cards uc on uc.id = b.user_card_id
  join public.card_products cp on cp.id = uc.card_product_id
  where cp.rewards_program_id is not null
    and b.is_completed
    and b.bonus_value > 0
    and b.credited_amount is null
),
credited as (
  insert into public.wallet_accounts (portfolio_id, rewards_program_id, balance)
  select portfolio_id, rewards_program_id, sum(bonus_value)
  from pending
  group by portfolio_id, rewards_program_id
  on conflict (portfolio_id, rewards_program_id)
  do update set balance = public.wallet_accounts.balance + excluded.balance
  returning 1
)
update public.user_signup_bonuses b
set credited_amount = b.bonus_value
from pending p
where b.id = p.bonus_id;
