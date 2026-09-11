-- Chase Sapphire Preferred hotel credit $50 -> $100.  [APPLIED 2026-09-11]
-- Run csp_hotel_credit_100_preview.sql first and eyeball the rows.
--
-- Chase doubled the credit effective 2026-06-15 for new AND existing
-- cardmembers, so current open cycles get the new allotment too, and
-- their status is recomputed from actual redemptions (a cycle that was
-- fully_used at $50 becomes partially_used at $100).
--
-- Every statement RETURNING its touched rows is deliberate: Studio's
-- results pane then proves the update landed. A first pass of this patch
-- silently didn't apply; the returning clause is what caught it.

-- 1. Catalog: bump the definition and scrub any "$50" baked into the name.
--    Expect exactly one row back: "$100 Annual Hotel Credit", 100.00, 100.00.
update benefit_definitions bd
set
  value_per_period = 100,
  annual_value     = 100,
  name             = replace(bd.name, '$50', '$100')
from card_products cp
where cp.id = bd.card_product_id
  and cp.name ilike '%sapphire preferred%'
  and bd.name ilike '%hotel%'
returning bd.name, bd.value_per_period, bd.annual_value;

-- 2. Current/future cycles: raise the allotment and recompute status
--    from redemption totals. Zero rows back is fine (no open cycles).
with target_cycles as (
  select ubc.id, coalesce(sum(br.amount), 0) as redeemed_total
  from user_benefit_cycles ubc
  join benefit_definitions bd on bd.id = ubc.benefit_definition_id
  join card_products cp on cp.id = bd.card_product_id
  left join benefit_redemptions br on br.benefit_cycle_id = ubc.id
  where cp.name ilike '%sapphire preferred%'
    and bd.name ilike '%hotel%'
    and ubc.period_end >= current_date
    and ubc.status <> 'expired'
  group by ubc.id
)
update user_benefit_cycles ubc
set
  allotted_value = 100,
  status = case
    when tc.redeemed_total >= 100 then 'fully_used'::benefit_cycle_status
    when tc.redeemed_total > 0    then 'partially_used'::benefit_cycle_status
    else 'unused'::benefit_cycle_status
  end
from target_cycles tc
where ubc.id = tc.id
returning ubc.id, ubc.allotted_value, ubc.status;

-- Optional follow-up, NOT run above: the $100 credit resets each
-- cardmember (anniversary) year. If the definition currently says
-- reset_basis = 'calendar', existing cycle date ranges were generated on
-- the calendar basis and flipping this mid-stream will misalign them, so
-- decide deliberately before running:
--
-- update benefit_definitions bd
-- set reset_basis = 'anniversary'
-- from card_products cp
-- where cp.id = bd.card_product_id
--   and cp.name ilike '%sapphire preferred%'
--   and bd.name ilike '%hotel%';
