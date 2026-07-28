-- remove_spend_entry(): delete one spend entry and re-derive the linked
-- signup bonus's completion, mirroring add_spend_entry (20260715140000).
--
-- Deleting spend can drop the running total BELOW the bonus target, so unlike
-- the add path (which only ever flips completion ON) this recomputes both
-- directions: it un-completes a bonus that no longer meets its threshold. The
-- BEFORE trigger trg_bonus_wallet_credit (20260716120000) then reverses the
-- wallet credit by the exact delta.
--
-- SECURITY INVOKER: the DELETE and the completion UPDATE are both gated by the
-- "spend_entries access" / signup-bonus RLS policies as the calling user, so
-- this can only touch entries the caller could already delete directly.

create or replace function public.remove_spend_entry(
  p_entry_id uuid
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_bonus_id uuid;
  v_total numeric;
  v_required numeric;
  v_complete boolean;
begin
  delete from public.spend_entries
  where id = p_entry_id
  returning signup_bonus_id into v_bonus_id;

  -- Nothing deleted (unknown id or RLS-hidden), or the entry wasn't linked to
  -- a bonus: no completion state to recompute.
  if not found or v_bonus_id is null then
    return;
  end if;

  -- Lock the parent bonus first (matches add_spend_entry) so a concurrent
  -- add/remove for this bonus re-sums against a stable, serialized row.
  select required_spend into v_required
  from public.user_signup_bonuses
  where id = v_bonus_id
  for update;

  select coalesce(sum(amount), 0) into v_total
  from public.spend_entries
  where signup_bonus_id = v_bonus_id;

  v_complete := v_required is not null and v_total >= v_required;

  -- Only write when the flag actually changes, so the wallet-credit trigger
  -- fires solely on a genuine transition.
  update public.user_signup_bonuses
  set is_completed = v_complete
  where id = v_bonus_id
    and is_completed is distinct from v_complete;
end;
$$;

revoke all on function public.remove_spend_entry(uuid) from public;
revoke all on function public.remove_spend_entry(uuid) from anon;
grant execute on function public.remove_spend_entry(uuid) to authenticated;
