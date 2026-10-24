-- Record only (applied in prod 2026-10-13; one-off approval snapshots, not schema).
-- fee_vat_rebase.ebay_requeue_dryrun_2026_10_13: eBay prices queued since the VAT bug that sit
-- below the VAT-correct break-even floor (296 rows). Raise-only; nothing queued until approved.
create table if not exists fee_vat_rebase.ebay_requeue_dryrun_2026_10_13 as
with p as (
  select r.id as pending_id, r.store_id, s.store_name, s.mintsoft_channel ch, r.sku, r.price::numeric as current_price, r.queued_at,
         regexp_replace(coalesce(al.true_sku, r.sku), '(?i)-Q[0-9]+$', '') as base,
         coalesce(nullif(substring(r.sku from '(?i)-Q([0-9]+)$'),'')::int, 1) as pack
  from public.threeds_reprice_pending r
  join public.threeds_stores s on s.id = r.store_id
  left join public.threeds_sku_aliases al on al.dirt_sku = r.sku
  where r.source = 'repricer' and r.queued_at >= '2026-09-29 13:10:21+00'
    and not exists (select 1 from public.threeds_reprice_pending r2 where r2.store_id = r.store_id and r2.sku = r.sku and r2.queued_at > r.queued_at)),
f as (
  select p.*, (pc.cost_price * p.pack)::numeric as cost,
         coalesce(cm.courier_per_ship, ccm.courier_per_ship, 2.00)::numeric as courier,
         fr.fee_pct::numeric as fee_pct_gross, fr.fixed_fee::numeric as fixed_fee
  from p
  join public.products_cache pc on pc.sku = p.base and pc.cost_price > 0
  left join public.mv_threeds_courier_median cm on cm.channel = p.ch and cm.base_sku = p.base
  left join public.mv_threeds_courier_channel_median ccm on ccm.channel = p.ch
  left join lateral (select fee_pct, fixed_fee from public.channel_fee_rules where active and p.ch ilike channel_pattern order by priority limit 1) fr on true)
select now() as built_at, pending_id, store_id, store_name, sku, base as base_sku, pack, current_price, queued_at as current_queued_at,
       cost, courier, fee_pct_gross, fixed_fee,
       -- VAT-correct break-even (inc VAT): profit_net = P/1.2 - fee_pct_gross*P - fixed - cost - courier = 0
       round((cost + courier + fixed_fee) / (1/1.2 - fee_pct_gross), 2) as true_floor,
       coalesce(public.charm_snap_up(round((cost + courier + fixed_fee) / (1/1.2 - fee_pct_gross), 2)),
                round((cost + courier + fixed_fee) / (1/1.2 - fee_pct_gross), 2)) as proposed_price
from f
where current_price < round((cost + courier + fixed_fee) / (1/1.2 - fee_pct_gross), 2);
revoke all on fee_vat_rebase.ebay_requeue_dryrun_2026_10_13 from public, anon, authenticated;

-- fee_vat_rebase.amazon_floor_dryrun_2026_10_13: proposed eSagu minimum raises (267 rows);
-- live_min / dryrun_result / max_bumped_to filled from esagu-set-floor dry runs
-- (net._http_response 14898, 14899). Raise-only; nothing pushed until approved.
create table if not exists fee_vat_rebase.amazon_floor_dryrun_2026_10_13 as
select now() as built_at, t.item_id as esagu_item_id, e.catalogue_sku as sku, e.asin, t.fba, t.cost, t.fulfil,
       t.cur_min as cur_min_mirror, t.floor_gbp as proposed_min, t.cur_max, t.amazon_price, t.ext_market,
       null::numeric as live_min, null::text as dryrun_result
from public.esagu_costfloor_targets() t
join amazon.mv_esagu_item_lean e on e.esagu_item_id = t.item_id;
alter table fee_vat_rebase.amazon_floor_dryrun_2026_10_13 add column if not exists max_bumped_to numeric;
revoke all on fee_vat_rebase.amazon_floor_dryrun_2026_10_13 from public, anon, authenticated;
