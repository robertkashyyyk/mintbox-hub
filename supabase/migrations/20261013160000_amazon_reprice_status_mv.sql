-- 2026-10-13: /decisions/threeds-reprice (Amazon toggle) returned 500s: get_amazon_reprice_summary
-- took ~17 s and get_amazon_reprice_overview ~6 s against the 8 s API statement timeout, and the
-- page rendered zeros + "Nothing needs attention". Both scanned all ~38k wide amazon.esagu_item
-- rows (cold, ~63 MB) per page load; the summary also called esagu_break_even_floor() per row.
--
-- Fix: per-item inputs are precomputed in public.mv_amazon_reprice_items (applied via MCP as
-- migration "amazon_reprice_items_mv"; definition below for repo parity), refreshed hourly at
-- :15 after the :07 eSagu mirror sync. The RPCs keep their exact page logic and signatures.
-- Verified before switching: summary jsonb identical; overview(100000, 0.20) 29,083 rows,
-- EXCEPT both ways = 0. Rollback: supabase/manual/20261013_amazon_reprice_rpcs_before.sql.
-- NOTE (unchanged, separate issue): VAT still comes from channel_fee_rules.vat_rate (0 since
-- 2026-09-29), so these cost floors are ~20% low — the open VAT-coupling bug.

create materialized view if not exists public.mv_amazon_reprice_items as
with cfg as (
  select (select vat_rate from public.channel_fee_rules where name='Amazon' and active order by priority limit 1) as vat,
         (select fee_pct  from public.channel_fee_rules where name='Amazon' and active order by priority limit 1) as fee,
         coalesce((select (value->>'fbm_fulfil')::numeric from public.app_settings where key='esagu_costfloor'),2.65) as fbm_fulfil,
         coalesce((select (value->>'fba_fulfil')::numeric from public.app_settings where key='esagu_costfloor'),3.97) as fba_fulfil,
         coalesce((select (value->>'margin_pct')::numeric from public.app_settings where key='esagu_costfloor'),0) as margin_pct
),
base as (
  select e.esagu_item_id, e.catalogue_sku as sku, e.asin, e.fba, e.amazon_price, e.min_price, e.max_price,
         e.buy_box_seller, (e.buy_box_seller='A18KNZ0ID7MNQY') as we_hold_box, e.competable_price, e.quantity,
         (select min((o->>'price')::numeric) from jsonb_array_elements(e.offers) o
           where o->>'seller'='A3P5ROKL5A1OLE' and nullif(o->>'price','') is not null) as amazon_own,
         (select max((o->>'price')::numeric) from jsonb_array_elements(e.offers) o
           where o->>'seller' not in ('A18KNZ0ID7MNQY','A3P5ROKL5A1OLE')
             and jsonb_array_length(coalesce(o->'excl','[]'::jsonb))=0
             and nullif(o->>'price','') is not null) as best_comp_price,
         pc.cost_price as cost,
         case when e.fba then c.fba_fulfil else c.fbm_fulfil end as fulfil,
         (1.0/(1+c.vat) - c.fee) as keep_rate,
         c.vat, c.fee, c.margin_pct,
         exists (select 1 from amazon.fba_switch_exclusions fx where fx.sku = e.catalogue_sku) as never_fba
  from amazon.esagu_item e
  left join public.products_cache pc on pc.sku = e.catalogue_sku
  cross join cfg c
  where e.mode='OPTIMIZATION' and e.amazon_price is not null
    and not (e.fba and coalesce(e.quantity,0)=0)
)
select b.*,
  case when cost>0 then round((cost+fulfil)/nullif(keep_rate,0),2) end as cost_floor,
  case when cost>0 then round((cost+fulfil)/nullif(1.0/(1+vat) - fee - margin_pct,0),2) end as guard_floor,
  now() as refreshed_at
from base b;

create unique index if not exists mv_amazon_reprice_items_pk on public.mv_amazon_reprice_items (esagu_item_id);
create index if not exists mv_amazon_reprice_items_sku on public.mv_amazon_reprice_items (sku);
revoke all on public.mv_amazon_reprice_items from public, anon, authenticated;
grant select on public.mv_amazon_reprice_items to service_role;

create or replace function public.get_amazon_reprice_summary()
returns jsonb
language sql stable security definer
set search_path to 'public', 'amazon'
as $function$
  with y as (
    select m.*,
      (fba and coalesce(quantity,0)>0 and guard_floor is not null and (
        (amazon_own is not null and amazon_own < guard_floor)
        or not coalesce(best_comp_price >= guard_floor, false))) as is_stuck
    from public.mv_amazon_reprice_items m
  )
  select jsonb_build_object(
    'total', count(*),
    'we_hold_box', count(*) filter (where we_hold_box),
    'stuck_fba', count(*) filter (where is_stuck),
    'below_floor', count(*) filter (where guard_floor is not null and amazon_price < guard_floor - 0.01 and not is_stuck),
    'losing_box', count(*) filter (where buy_box_seller is not null and not we_hold_box),
    'margin_headroom', count(*) filter (where not fba and max_price is not null and competable_price is not null
                                          and max_price < competable_price*0.97 and amazon_price >= max_price-0.02),
    'as_of', max(refreshed_at)
  ) from y
$function$;

create or replace function public.get_amazon_reprice_overview(p_limit integer default 300, p_target_por numeric default null::numeric)
returns table(esagu_item_id bigint, sku text, asin text, fba boolean, amazon_price numeric, min_price numeric, max_price numeric,
              buy_box_seller text, we_hold_box boolean, competable_price numeric, amazon_own numeric, cost numeric, cost_floor numeric,
              current_por numeric, target_price numeric, never_fba boolean, status text)
language sql stable security definer
set search_path to 'public', 'amazon'
as $function$
  with clr as (
    select distinct c.sku from public.price_campaigns c
     where c.status='active' and c.type in ('sale','liquidation')
       and c.channels @> array['amazon']::text[] and c.sku is not null
  ),
  s as (
    select m.*,
      case when m.cost>0 and m.amazon_price>0 then round(m.keep_rate - (m.cost+m.fulfil)/m.amazon_price, 4) end as current_por,
      case when m.cost>0 and p_target_por is not null and (m.keep_rate - p_target_por) > 0
           then round((m.cost+m.fulfil)/(m.keep_rate - p_target_por), 2) end as target_price,
      (m.cost_floor is not null and coalesce(m.best_comp_price >= m.cost_floor, false)) as has_headroom_comp
    from public.mv_amazon_reprice_items m
    where not exists (select 1 from clr where clr.sku = m.sku)
  ),
  s2 as (
    select s.*,
      case
        when s.fba and coalesce(s.quantity,0)>0 and s.cost_floor is not null
             and ((s.amazon_own is not null and s.amazon_own < s.cost_floor) or not s.has_headroom_comp) then 'stuck_fba'
        when s.cost_floor is not null and s.amazon_price < s.cost_floor - 0.01 then 'below_floor'
        when s.buy_box_seller is not null and not s.we_hold_box then 'losing_box'
        when not s.fba and s.max_price is not null and s.competable_price is not null
             and s.max_price < s.competable_price*0.97 and s.amazon_price >= s.max_price-0.02 then 'margin_headroom'
        else 'ok'
      end as status
    from s
  )
  select s2.esagu_item_id, s2.sku, s2.asin, s2.fba, s2.amazon_price, s2.min_price, s2.max_price, s2.buy_box_seller, s2.we_hold_box,
         s2.competable_price, s2.amazon_own, s2.cost, s2.cost_floor, s2.current_por, s2.target_price, s2.never_fba, s2.status
  from s2 where s2.status <> 'ok'
  order by case s2.status when 'stuck_fba' then 1 when 'below_floor' then 2 when 'losing_box' then 3 when 'margin_headroom' then 4 else 5 end,
           (coalesce(s2.competable_price,0) - coalesce(s2.amazon_price,0)) desc
  limit p_limit
$function$;

-- Hourly refresh, after the :07 eSagu mirror sync (cron 74). Session-level timeout in the
-- command itself (a function-level SET does not cover the top-level cron statement).
select cron.schedule('amazon-reprice-status-refresh', '15 * * * *',
  $$SET statement_timeout='300000'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_amazon_reprice_items; ANALYZE public.mv_amazon_reprice_items;$$);
