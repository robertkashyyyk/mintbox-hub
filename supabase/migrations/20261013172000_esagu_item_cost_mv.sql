-- 2026-10-13: catalogue cost per eSagu item, precomputed, so esagu_costfloor_targets never does
-- ~7k random products_cache lookups (73 ms warm, ~10 s cold). Refreshed hourly at :15 right
-- after amazon.mv_esagu_item_lean (guards run 06:30/06:45/07:30, after the 06:15 refresh).
create materialized view if not exists amazon.mv_esagu_item_cost as
select e.esagu_item_id, pc.cost_price as catalogue_cost
from amazon.esagu_item e
join public.products_cache pc on pc.sku = e.catalogue_sku
where pc.cost_price > 0;
create unique index if not exists mv_esagu_item_cost_pk on amazon.mv_esagu_item_cost (esagu_item_id);
analyze amazon.mv_esagu_item_cost;

create or replace function public.esagu_costfloor_targets()
returns table(item_id bigint, fba boolean, cost numeric, fulfil numeric, floor_gbp numeric, cur_min numeric, cur_max numeric, amazon_price numeric, ext_market numeric)
language sql stable security definer set search_path to 'public', 'amazon'
as $function$
  with cfg as (
    select coalesce((select (value#>>'{}')::numeric from public.app_settings where key='product_vat_rate'), 0.20) as vat,
           (select fee_pct from public.channel_fee_rules where name='Amazon' and active order by priority limit 1) as fee,
           coalesce((select (value->>'fbm_fulfil')::numeric from public.app_settings where key='esagu_costfloor'),2.65) as fbm_fulfil,
           coalesce((select (value->>'fba_fulfil')::numeric from public.app_settings where key='esagu_costfloor'),3.97) as fba_fulfil,
           coalesce((select (value->>'margin_pct')::numeric from public.app_settings where key='esagu_costfloor'),0) as margin_pct
  ),
  clr as (
    select distinct c.sku from public.price_campaigns c
     where c.status='active' and c.type in ('sale','liquidation') and c.channels @> array['amazon']::text[] and c.sku is not null
  ),
  base as (
    select e.esagu_item_id, e.fba, k.catalogue_cost as cost, e.min_price as cur_min, e.max_price as cur_max, e.amazon_price,
           case when e.fba then c.fba_fulfil else c.fbm_fulfil end as fulfil,
           (1.0/(1+c.vat) - c.fee - c.margin_pct) as denom, e.ext_market
    from amazon.mv_esagu_item_lean e
    join amazon.mv_esagu_item_cost k on k.esagu_item_id = e.esagu_item_id
    cross join cfg c
    where e.catalogue_sku is not null and e.mode='OPTIMIZATION'
      and not exists (select 1 from clr where clr.sku = e.catalogue_sku)
  )
  select esagu_item_id, fba, cost, fulfil, round((cost + fulfil)/nullif(denom,0),2) as floor_gbp,
         cur_min, cur_max, amazon_price, ext_market
  from base
  where denom > 0 and round((cost + fulfil)/nullif(denom,0),2) > coalesce(cur_min,0) + 0.05
$function$;

select cron.alter_job(
  (select jobid from cron.job where jobname = 'amazon-reprice-status-refresh'),
  command := $$SET statement_timeout='300000'; REFRESH MATERIALIZED VIEW CONCURRENTLY amazon.mv_esagu_item_lean; ANALYZE amazon.mv_esagu_item_lean; REFRESH MATERIALIZED VIEW CONCURRENTLY amazon.mv_esagu_item_cost; ANALYZE amazon.mv_esagu_item_cost; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_amazon_reprice_items; ANALYZE public.mv_amazon_reprice_items;$$);
