-- FBA Replenishment page fix (2026-10-08). The page blanked because
-- public.v_fba_replenishment took ~8.6s warm against the authenticated role's
-- 8s statement_timeout: sales_traffic_daily grew 232k -> 1.14M rows with the
-- 2025 S&T backfill and the velocity view full-scanned + disk-sorted it on
-- every load (the cfg-CTE-driven date filter could not be pushed into the scan).
-- Three parts: (1) metric_date index, (2) literal date guard in the velocity
-- view (8.6s -> 3.8s warm), (3) nightly-precomputed snapshot serving the page
-- (ms) with a data_as_of column. Applied to prod 2026-10-08 via MCP.

create index if not exists sales_traffic_daily_metric_date_idx
  on amazon.sales_traffic_daily (metric_date);

create or replace view amazon.v_fba_velocity as
with cfg as (
  select replenishment_config.velocity_weeks
  from amazon.replenishment_config
  where replenishment_config.id
),
resolved as (
  select st.marketplace_id,
         st.metric_date,
         st.units_ordered,
         x.resolved_sku as sku
  from amazon.sales_traffic_daily st
  join amazon.v_asin_sku x
    on x.marketplace_id = st.marketplace_id and x.asin = st.child_asin
  where x.resolved_sku is not null
    and st.metric_date >= current_date - 112  -- literal guard: lets the planner use the metric_date index
),
weekly as (
  select r.marketplace_id,
         amazon.base_sku(r.sku) as base_sku,
         floor(((current_date - r.metric_date) / 7)::double precision)::integer as week_index,
         sum(r.units_ordered * amazon.pack_size(r.sku))::numeric as single_units
  from resolved r, cfg
  where r.metric_date >= (current_date - cfg.velocity_weeks * 7)
  group by r.marketplace_id, amazon.base_sku(r.sku),
           floor(((current_date - r.metric_date) / 7)::double precision)::integer
)
select w.marketplace_id,
       w.base_sku,
       round(sum(w.single_units * (c.velocity_weeks - w.week_index)::numeric)
             / nullif(sum(c.velocity_weeks - w.week_index), 0)::numeric, 2) as weekly_velocity,
       sum(w.single_units) filter (where w.week_index = 0) as units_7d,
       sum(w.single_units) filter (where w.week_index <= 3) as units_30d,
       sum(w.single_units) as units_window
from weekly w, cfg c
group by w.marketplace_id, w.base_sku;

create table if not exists amazon.fba_replenishment_snapshot (
  marketplace_id text not null,
  country_code character(2),
  base_sku text not null,
  weekly_velocity numeric,
  units_7d numeric,
  units_30d numeric,
  fba_on_hand bigint,
  fba_in_transit bigint,
  target_units numeric,
  days_of_cover_weeks numeric,
  raw_units_to_order integer,
  units_to_order integer,
  replenish_flag boolean,
  unit_cost numeric,
  reorder_cost numeric,
  avg_sell_price numeric,
  referral_fee_per_unit numeric,
  fba_fee_per_unit numeric,
  gross_margin_pct numeric,
  net_per_unit numeric,
  net_margin_pct numeric,
  never_fba boolean,
  computed_at timestamptz not null default now(),
  primary key (marketplace_id, base_sku)
);

create or replace function public.amazon_refresh_fba_replenishment()
returns void
language plpgsql
security definer
set search_path = public, amazon
as $$
begin
  delete from amazon.fba_replenishment_snapshot;
  insert into amazon.fba_replenishment_snapshot (
    marketplace_id, country_code, base_sku, weekly_velocity, units_7d, units_30d,
    fba_on_hand, fba_in_transit, target_units, days_of_cover_weeks,
    raw_units_to_order, units_to_order, replenish_flag, unit_cost, reorder_cost,
    avg_sell_price, referral_fee_per_unit, fba_fee_per_unit, gross_margin_pct,
    net_per_unit, net_margin_pct, never_fba, computed_at
  )
  select marketplace_id, country_code, base_sku, weekly_velocity, units_7d, units_30d,
         fba_on_hand, fba_in_transit, target_units, days_of_cover_weeks,
         raw_units_to_order, units_to_order, replenish_flag, unit_cost, reorder_cost,
         avg_sell_price, referral_fee_per_unit, fba_fee_per_unit, gross_margin_pct,
         net_per_unit, net_margin_pct, never_fba, now()
  from amazon.v_fba_replenishment;
end
$$;
revoke all on function public.amazon_refresh_fba_replenishment() from public, anon, authenticated;
grant execute on function public.amazon_refresh_fba_replenishment() to service_role;

select public.amazon_refresh_fba_replenishment();

create or replace view public.v_fba_replenishment as
select marketplace_id, country_code, base_sku, weekly_velocity, units_7d, units_30d,
       fba_on_hand, fba_in_transit, target_units, days_of_cover_weeks,
       raw_units_to_order, units_to_order, replenish_flag, unit_cost, reorder_cost,
       avg_sell_price, referral_fee_per_unit, fba_fee_per_unit, gross_margin_pct,
       net_per_unit, net_margin_pct, computed_at as data_as_of
from amazon.fba_replenishment_snapshot;

select cron.unschedule(jobid) from cron.job where jobname = 'amazon-nightly-fba-replenishment-snapshot';
select cron.schedule(
  'amazon-nightly-fba-replenishment-snapshot',
  '10 3 * * *',
  $job$select public.amazon_refresh_fba_replenishment();$job$
);
