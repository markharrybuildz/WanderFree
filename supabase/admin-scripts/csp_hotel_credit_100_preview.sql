-- Preview: Chase Sapphire Preferred hotel credit $50 -> $100.
-- Read-only. Run this first, check the rows, then run csp_hotel_credit_100.sql.
--
-- Background: Chase doubled the CSP's Chase Travel hotel credit to $100
-- effective 2026-06-15, for new and existing cardmembers, same $95 fee.
-- The credit resets each cardmember (anniversary) year, not calendar year.

-- 1. The catalog row(s) that would be updated.
select
  bd.id,
  cp.name        as card_product,
  bd.name        as benefit_name,
  bd.value_per_period,
  bd.annual_value,
  bd.reset_frequency,
  bd.reset_basis
from benefit_definitions bd
join card_products cp on cp.id = bd.card_product_id
where cp.name ilike '%sapphire preferred%'
  and bd.name ilike '%hotel%';

-- 2. Current/future user cycles that would have allotted_value bumped,
--    with their redemption totals and the status each would land on.
select
  ubc.id,
  ubc.user_card_id,
  ubc.period_start,
  ubc.period_end,
  ubc.allotted_value            as current_allotted,
  ubc.status                    as current_status,
  coalesce(r.total, 0)          as redeemed_total,
  case
    when coalesce(r.total, 0) >= 100 then 'fully_used'
    when coalesce(r.total, 0) > 0    then 'partially_used'
    else 'unused'
  end                           as new_status
from user_benefit_cycles ubc
join benefit_definitions bd on bd.id = ubc.benefit_definition_id
join card_products cp on cp.id = bd.card_product_id
left join lateral (
  select sum(br.amount) as total
  from benefit_redemptions br
  where br.benefit_cycle_id = ubc.id
) r on true
where cp.name ilike '%sapphire preferred%'
  and bd.name ilike '%hotel%'
  and ubc.period_end >= current_date
  and ubc.status <> 'expired';
