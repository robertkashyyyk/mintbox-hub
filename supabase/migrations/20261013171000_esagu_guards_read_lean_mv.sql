-- 2026-10-13: eSagu guard target RPCs read amazon.mv_esagu_item_lean (narrow, offers
-- precomputed) instead of scanning amazon.esagu_item, and use one set-based clearance
-- anti-join instead of is_amazon_clearance_sku() per row. Outputs verified identical
-- (costfloor 267, fba guard 1, margin 299 rows; EXCEPT both ways = 0).
-- Rollback: supabase/manual/20261013_esagu_guard_targets_before.sql
-- (esagu_costfloor_targets is superseded by 20261013172000_esagu_item_cost_mv.sql.)

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
    select e.esagu_item_id, e.fba, pc.cost_price as cost, e.min_price as cur_min, e.max_price as cur_max, e.amazon_price,
           case when e.fba then c.fba_fulfil else c.fbm_fulfil end as fulfil,
           (1.0/(1+c.vat) - c.fee - c.margin_pct) as denom, e.ext_market
    from amazon.mv_esagu_item_lean e
    join public.products_cache pc on pc.sku = e.catalogue_sku
    cross join cfg c
    where e.catalogue_sku is not null and pc.cost_price > 0 and e.mode='OPTIMIZATION'
      and not exists (select 1 from clr where clr.sku = e.catalogue_sku)
  )
  select esagu_item_id, fba, cost, fulfil, round((cost + fulfil)/nullif(denom,0),2) as floor_gbp,
         cur_min, cur_max, amazon_price, ext_market
  from base
  where denom > 0 and round((cost + fulfil)/nullif(denom,0),2) > coalesce(cur_min,0) + 0.05
$function$;

create or replace function public.esagu_guard_targets()
returns table(fba_item_id bigint, target_maxprice numeric, fba_min numeric, ext_market numeric)
language sql stable security definer set search_path to 'public', 'amazon'
as $function$
  with sib as (
    select asin, min(amazon_price) as fbm from amazon.mv_esagu_item_lean
     where not fba and amazon_price is not null group by asin
  ),
  clr as (
    select distinct c.sku from public.price_campaigns c
     where c.status='active' and c.type in ('sale','liquidation') and c.channels @> array['amazon']::text[] and c.sku is not null
  )
  select f.esagu_item_id, s.fbm, f.min_price, f.ext_market
  from amazon.mv_esagu_item_lean f
  join sib s on s.asin = f.asin
  where f.fba and f.mode='OPTIMIZATION' and coalesce(f.quantity,0)>0 and f.min_price is not null
    and f.amazon_price > s.fbm + 0.01
    and s.fbm >= f.min_price
    and f.max_price is distinct from s.fbm
    and f.ext_market is not null
    and s.fbm >= f.ext_market * 0.90
    and not exists (select 1 from clr where clr.sku = f.catalogue_sku)
$function$;

create or replace function public.esagu_margin_targets()
returns table(item_id bigint, new_max numeric, old_max numeric, ext_market numeric)
language sql stable security definer set search_path to 'public', 'amazon'
as $function$
  with clr as (
    select distinct c.sku from public.price_campaigns c
     where c.status='active' and c.type in ('sale','liquidation') and c.channels @> array['amazon']::text[] and c.sku is not null
  ),
  x as (
    select e.esagu_item_id, e.amazon_price, e.max_price, e.ext_market
    from amazon.mv_esagu_item_lean e
    where e.mode='OPTIMIZATION' and not e.fba and e.amazon_price is not null
      and not exists (select 1 from clr where clr.sku = e.catalogue_sku)
  )
  select esagu_item_id, round(least(ext_market*0.98, amazon_price*1.20),2), max_price, ext_market
  from x
  where ext_market is not null and max_price < ext_market*0.97 and amazon_price >= max_price-0.02
    and round(least(ext_market*0.98, amazon_price*1.20),2) > max_price + 0.05
$function$;

-- Hourly refresh at :15 now covers the lean mirror too (before the reprice page MV).
select cron.alter_job(
  (select jobid from cron.job where jobname = 'amazon-reprice-status-refresh'),
  command := $$SET statement_timeout='300000'; REFRESH MATERIALIZED VIEW CONCURRENTLY amazon.mv_esagu_item_lean; ANALYZE amazon.mv_esagu_item_lean; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_amazon_reprice_items; ANALYZE public.mv_amazon_reprice_items;$$);
