-- Analytics layer A: read-only reporting views over the domain tables, for
-- operator dashboards (Metabase). These derive business metrics from the
-- source-of-truth tables — cards, redemptions, portfolios — rather than from a
-- separate events stream, so they can't drift from reality. Behavioral/event
-- analytics (screens, funnels) come later in a separate analytics_events table.
--
-- Ownership & access model:
--   * Views are owned by `postgres` (created via the SQL editor). No table has
--     FORCE ROW LEVEL SECURITY, so the owner bypasses RLS and these views
--     aggregate across ALL portfolios.
--   * The BI role (see admin-scripts/analytics_reporting_role.sql) is granted
--     SELECT on these views ONLY — never on public base tables — so it reads
--     curated aggregates with no raw per-user rows. No emails/PII are selected
--     here (signups use created_at counts only).

create schema if not exists analytics;

-- Headline KPIs — a single row for the top of the dashboard.
create or replace view analytics.kpis as
select
  (select count(*) from auth.users)                                     as total_users,
  (select count(*) from auth.users
     where created_at >= now() - interval '30 days')                    as new_users_30d,
  (select count(*) from public.portfolios)                              as total_portfolios,
  (select count(*) from public.user_cards)                              as total_cards,
  (select count(*) from public.user_cards where is_active)              as active_cards,
  (select count(*) from public.benefit_redemptions)                     as total_redemptions,
  (select coalesce(sum(amount), 0) from public.benefit_redemptions)     as value_redeemed_all_time,
  (select coalesce(sum(amount), 0) from public.benefit_redemptions
     where redeemed_on >= (now() - interval '30 days')::date)           as value_redeemed_30d;

-- New users per day (UTC), for a growth chart.
create or replace view analytics.signups_daily as
select (created_at at time zone 'UTC')::date as day,
       count(*)                              as new_users
from auth.users
group by 1
order by 1;

-- Per-portfolio rollup: members, cards, active cards.
create or replace view analytics.portfolios_overview as
select p.id         as portfolio_id,
       p.name,
       p.type,
       p.created_at,
       (select count(*) from public.portfolio_members m where m.portfolio_id = p.id) as member_count,
       (select count(*) from public.user_cards c        where c.portfolio_id = p.id) as card_count,
       (select count(*) from public.user_cards c
          where c.portfolio_id = p.id and c.is_active)                                as active_card_count
from public.portfolios p
order by p.created_at desc;

-- Card product adoption (full catalog; 0 for never-added products).
create or replace view analytics.card_adoption as
select cp.id                                    as card_product_id,
       cp.name                                  as card_name,
       ci.name                                  as issuer_name,
       count(uc.id)                             as times_added,
       count(uc.id) filter (where uc.is_active) as active_count
from public.card_products cp
join public.card_issuers ci on ci.id = cp.issuer_id
left join public.user_cards uc on uc.card_product_id = cp.id
group by cp.id, cp.name, ci.name
order by times_added desc;

-- Redemptions per day: count + dollars captured.
create or replace view analytics.redemptions_daily as
select redeemed_on               as day,
       count(*)                  as redemption_count,
       coalesce(sum(amount), 0)  as value_redeemed
from public.benefit_redemptions
group by 1
order by 1;

-- Per-benefit performance: allotted vs redeemed and a redemption rate.
create or replace view analytics.benefit_performance as
with redeemed as (
  select benefit_definition_id,
         sum(amount) as redeemed_value,
         count(*)    as redemption_count
  from public.benefit_redemptions
  group by benefit_definition_id
),
allotted as (
  select benefit_definition_id,
         sum(allotted_value) as allotted_value,
         count(*)            as cycle_count
  from public.user_benefit_cycles
  group by benefit_definition_id
)
select bd.id                              as benefit_definition_id,
       bd.name                            as benefit_name,
       cp.name                            as card_name,
       bc.name                            as category,
       bd.reset_frequency,
       coalesce(a.cycle_count, 0)         as cycle_count,
       coalesce(a.allotted_value, 0)      as allotted_value,
       coalesce(r.redeemed_value, 0)      as redeemed_value,
       coalesce(r.redemption_count, 0)    as redemption_count,
       case when coalesce(a.allotted_value, 0) > 0
            then round(coalesce(r.redeemed_value, 0) / a.allotted_value, 4)
            else null end                 as redemption_rate
from public.benefit_definitions bd
join public.card_products cp        on cp.id = bd.card_product_id
left join public.benefit_categories bc on bc.id = bd.benefit_category_id
left join redeemed r on r.benefit_definition_id = bd.id
left join allotted a on a.benefit_definition_id = bd.id
order by redeemed_value desc;

-- Benefit cycle status distribution (unused / partially_used / fully_used / expired).
create or replace view analytics.benefit_cycle_status as
select status,
       count(*)                        as cycle_count,
       coalesce(sum(allotted_value), 0) as allotted_value
from public.user_benefit_cycles
group by status
order by cycle_count desc;
