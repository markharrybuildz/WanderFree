-- Auto-credit signup bonuses to the program wallet on completion.
--
-- When user_signup_bonuses.is_completed flips false→true, the bonus_value
-- (denominated in the card's rewards-program unit: points/miles/$) is added
-- to the portfolio's wallet_accounts balance for that program, creating the
-- wallet row if needed. A true→false flip reverses the credit (floored at
-- zero, since balances are also user-editable and may have been lowered).
--
-- Trigger over client code so EVERY completion path credits exactly once:
-- the add_spend_entry() function AND manual bonus edits from the app.
--
-- Runs with invoker rights: the "wallet access" RLS policy already allows
-- portfolio members to write wallet_accounts, and the unique
-- (portfolio_id, rewards_program_id) constraint makes the upsert safe.
--
-- Known simplification: reversal uses the CURRENT bonus_value, so editing
-- the value after completion then un-completing reverses the edited amount,
-- not the originally-credited one. Fine for a beta; a credited_amount
-- column can make it exact later.

create or replace function public.apply_bonus_wallet_credit() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_portfolio uuid;
  v_program uuid;
begin
  if new.bonus_value is null or new.bonus_value <= 0 then
    return new;
  end if;

  select uc.portfolio_id, cp.rewards_program_id
  into v_portfolio, v_program
  from public.user_cards uc
  join public.card_products cp on cp.id = uc.card_product_id
  where uc.id = new.user_card_id;

  -- No rewards program on the card product: nothing to credit.
  if v_program is null then
    return new;
  end if;

  if new.is_completed then
    insert into public.wallet_accounts (portfolio_id, rewards_program_id, balance)
    values (v_portfolio, v_program, new.bonus_value)
    on conflict (portfolio_id, rewards_program_id)
    do update set balance = public.wallet_accounts.balance + excluded.balance;
  else
    update public.wallet_accounts
    set balance = greatest(0, balance - new.bonus_value)
    where portfolio_id = v_portfolio
      and rewards_program_id = v_program;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bonus_wallet_credit on public.user_signup_bonuses;
create trigger trg_bonus_wallet_credit
  after update of is_completed on public.user_signup_bonuses
  for each row
  when (old.is_completed is distinct from new.is_completed)
  execute function public.apply_bonus_wallet_credit();
