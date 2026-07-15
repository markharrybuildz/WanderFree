-- add_spend_entry(): transactional spend insert + signup-bonus completion.
--
-- Replaces the mobile client's two-step write (insert spend_entries, then
-- maybe flip user_signup_bonuses.is_completed), which could leave a
-- committed spend row behind a failed completion update, and derived
-- completion from client-side state (CodeRabbit finding on PR #6).
-- Here both happen in one transaction and completion is computed from a
-- fresh SUM over spend_entries.
--
-- SECURITY INVOKER on purpose: RLS still evaluates as the caller, so
-- can_access_user_card() gates both tables exactly as direct writes would.

create or replace function public.add_spend_entry(
  p_user_card_id uuid,
  p_amount numeric,
  p_spent_on date,
  p_signup_bonus_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total numeric;
  v_required numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be positive' using errcode = '22003';
  end if;

  insert into public.spend_entries (user_card_id, amount, spent_on, signup_bonus_id)
  values (p_user_card_id, p_amount, coalesce(p_spent_on, current_date), p_signup_bonus_id);

  if p_signup_bonus_id is not null then
    select coalesce(sum(amount), 0) into v_total
    from public.spend_entries
    where signup_bonus_id = p_signup_bonus_id;

    select required_spend into v_required
    from public.user_signup_bonuses
    where id = p_signup_bonus_id;

    if v_required is not null and v_total >= v_required then
      update public.user_signup_bonuses
      set is_completed = true
      where id = p_signup_bonus_id and not is_completed;
    end if;
  end if;
end;
$$;

revoke all on function public.add_spend_entry(uuid, numeric, date, uuid) from public;
revoke all on function public.add_spend_entry(uuid, numeric, date, uuid) from anon;
grant execute on function public.add_spend_entry(uuid, numeric, date, uuid) to authenticated;
