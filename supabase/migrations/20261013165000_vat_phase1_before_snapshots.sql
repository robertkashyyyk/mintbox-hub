-- VAT Phase 1 (2026-10-13): BEFORE snapshots. Rollback source for the fee rules,
-- and the baseline for the before/after band and floor comparison.
create table if not exists fee_vat_rebase.channel_fee_rules_2026_10_13 as
  select now() as snapshot_at, r.* from public.channel_fee_rules r;

create table if not exists fee_vat_rebase.phase1_bands as
with cfg as (select (value->>'loss_max')::numeric lo, (value->>'breakeven_max')::numeric be, (value->>'poor_max')::numeric po,
                    (value->>'average_max')::numeric av, (value->>'good_max')::numeric go, (value->>'great_max')::numeric gr,
                    (value->>'amazing_max')::numeric am from public.app_settings where key='profit.loss_bands'),
l as (select public.channel_group(channel) ch, profit_incl_postage p, order_value_incl_postage v, missing_cost
      from public.order_economics_all where order_date >= now() - interval '91 days' and order_value_incl_postage > 0)
select 'before'::text as phase, now() as captured_at, l.ch,
  case when l.missing_cost then 'unknown'
       when l.p/(l.v*1.2)*100 < c.lo then 'loss' when l.p/(l.v*1.2)*100 <= c.be then 'breakeven'
       when l.p/(l.v*1.2)*100 <= c.po then 'poor' when l.p/(l.v*1.2)*100 <= c.av then 'average'
       when l.p/(l.v*1.2)*100 <= c.go then 'good' when l.p/(l.v*1.2)*100 <= c.gr then 'great'
       when l.p/(l.v*1.2)*100 <= c.am then 'amazing' else 'stellar' end as band,
  count(*) as lines, round(sum(l.p),2) as contribution, round(sum(l.v),2) as revenue
from l cross join cfg c group by 1,2,3,4;

create table if not exists fee_vat_rebase.phase1_amazon_floors as
select 'before'::text as phase, now() as captured_at,
  public.esagu_break_even_floor(0, false) as clearance_hard_floor_fbm,
  public.esagu_break_even_floor(0, true)  as clearance_hard_floor_fba,
  public.esagu_break_even_floor(10, false) as be_floor_cost10_fbm,
  public.esagu_break_even_floor(10, true)  as be_floor_cost10_fba,
  public.get_amazon_reprice_summary() as reprice_summary,
  (select count(*) from public.esagu_stuck_fba_candidates()) as stuck_fba_candidates,
  (select round(avg(cost_floor),2) from public.mv_amazon_reprice_items where cost_floor is not null) as avg_page_cost_floor;

revoke all on fee_vat_rebase.channel_fee_rules_2026_10_13, fee_vat_rebase.phase1_bands, fee_vat_rebase.phase1_amazon_floors from public, anon, authenticated;
