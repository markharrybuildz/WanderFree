-- add_spend_entry(): serialize concurrent calls per bonus (CodeRabbit, PR #7).
--
-- Under READ COMMITTED, two simultaneous add_spend_entry calls could each
-- SUM spend_entries before the other's insert commits, and both skip the
-- completion flip even though the combined total crossed the threshold.
-- Locking the parent bonus row (FOR UPDATE) BEFORE aggregating forces the
-- second call to wait for the first to commit, so its SUM sees the full
-- total.
--
-- This is a new migration rather than an edit to 20260715120500 because
-- that one is already applied to the remote database (applied migrations
-- are tracked by version, so content edits would silently never run).

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
    -- Lock the parent row first to serialize concurrent entries for this
    -- bonus; the SUM below then reflects every committed insert.
    select required_spend into v_required
    from public.user_signup_bonuses
    where id = p_signup_bonus_id
    for update;

    select coalesce(sum(amount), 0) into v_total
    from public.spend_entries
    where signup_bonus_id = p_signup_bonus_id;

    if v_required is not null and v_total >= v_required then
      update public.user_signup_bonuses
      set is_completed = true
      where id = p_signup_bonus_id and not is_completed;
    end if;
  end if;
end;
$$;
