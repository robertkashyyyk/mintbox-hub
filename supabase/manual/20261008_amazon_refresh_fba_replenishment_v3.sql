-- ============================================================================
-- FBA Replenishment nightly refresh v3 — APPLY VIA SUPABASE SQL EDITOR.
-- The MCP migration channel's classifier auto-declines this function (it
-- contains the snapshot's own delete-stale-rows step), so it is applied by
-- hand, per Robert's written approval of 2026-10-08:
--   * the ONLY delete is amazon.fba_replenishment_snapshot's stale rows
--     (WHERE computed_at < this run), after an in-transaction UPSERT — the
--     page never sees an empty table, and no source table is touched.
-- Until this is applied the snapshot was brought to the same state manually;
-- this function simply takes over from the 03:10 nightly cron (already
-- scheduled as amazon-nightly-fba-replenishment-snapshot).
-- ============================================================================
create or replace function public.amazon_refresh_fba_replenishment()
returns void
language plpgsql
security definer
set search_path = public, amazon
as $$
declare
  v_fba_share numeric;
  v_cover numeric;
  v_moq integer;
  v_now timestamptz := now();
begin
  select target_weeks_cover, default_moq into v_cover, v_moq from amazon.replenishment_config where id;

  insert into amazon.fba_replenishment_snapshot as t (
    marketplace_id, country_code, base_sku, weekly_velocity, units_7d, units_30d,
    fba_on_hand, fba_reserved, fba_reserved_customer,
    fba_inbound_working, fba_inbound_shipped, fba_inbound_receiving, fba_in_transit,
    unit_cost, avg_sell_price, referral_fee_per_unit, fba_fee_per_unit,
    never_fba, computed_at,
    pending_send_units, shipment_extra_units, is_candidate, buy_first,
    ever_fba, coleraine_placeholder, is_hazmat
  )
  select marketplace_id, country_code, base_sku, weekly_velocity, units_7d, units_30d,
         fba_on_hand, fba_reserved, fba_reserved_customer,
         fba_inbound_working, fba_inbound_shipped, fba_inbound_receiving, fba_in_transit,
         unit_cost, avg_sell_price, referral_fee_per_unit, fba_fee_per_unit,
         is_excluded, v_now,
         0, 0, false, false, false, false, false
  from amazon.v_fba_replenishment_base
  on conflict (marketplace_id, base_sku) do update set
    country_code = excluded.country_code,
    weekly_velocity = excluded.weekly_velocity,
    units_7d = excluded.units_7d,
    units_30d = excluded.units_30d,
    fba_on_hand = excluded.fba_on_hand,
    fba_reserved = excluded.fba_reserved,
    fba_reserved_customer = excluded.fba_reserved_customer,
    fba_inbound_working = excluded.fba_inbound_working,
    fba_inbound_shipped = excluded.fba_inbound_shipped,
    fba_inbound_receiving = excluded.fba_inbound_receiving,
    fba_in_transit = excluded.fba_in_transit,
    unit_cost = excluded.unit_cost,
    avg_sell_price = excluded.avg_sell_price,
    referral_fee_per_unit = excluded.referral_fee_per_unit,
    fba_fee_per_unit = excluded.fba_fee_per_unit,
    never_fba = excluded.never_fba,
    computed_at = excluded.computed_at,
    pending_send_units = 0, shipment_extra_units = 0,
    is_candidate = false, buy_first = false,
    ever_fba = false, coleraine_placeholder = false, is_hazmat = false,
    asins = null, fbm_units_90d = null, fbm_net_per_unit = null, fbm_price_gross = null,
    fba_net_per_unit_eff = null, net_diff = null, fee_source = null,
    suggested_first_send = null, coleraine_available = null, can_send_now = null,
    amazon_seller_sku = null, title = null, hazmat_source = null;

  -- Remove only the rows the new run did not touch (SKUs out of the window).
  delete from amazon.fba_replenishment_snapshot where computed_at < v_now;

  with ax as (
    select amazon.base_sku(x.resolved_sku) as bs, string_agg(distinct x.asin, ', ') as asins
    from amazon.v_asin_sku x where x.resolved_sku is not null group by 1
  ),
  ef as (
    select distinct amazon.base_sku(x.resolved_sku) as bs
    from amazon.fba_inventory_snapshot f
    join amazon.v_asin_sku x on x.marketplace_id = f.marketplace_id and x.asin = f.asin
    where x.resolved_sku is not null
      and (f.afn_fulfillable_quantity + f.afn_inbound_working_quantity
           + f.afn_inbound_shipped_quantity + f.afn_inbound_receiving_quantity) > 0
  ),
  fba_sku as (
    select distinct on (amazon.base_sku(x.resolved_sku))
           amazon.base_sku(x.resolved_sku) as bs, f.sku as seller_sku
    from amazon.fba_inventory_snapshot f
    join amazon.v_asin_sku x on x.marketplace_id = f.marketplace_id and x.asin = f.asin
    where x.resolved_sku is not null and coalesce(f.afn_listing_exists, true)
    order by amazon.base_sku(x.resolved_sku), f.snapshot_date desc,
             (f.afn_fulfillable_quantity > 0) desc
  ),
  kw as (
    select array(select jsonb_array_elements_text(value)) as words
    from public.app_settings where key = 'amazon.hazmat_keywords'
  )
  update amazon.fba_replenishment_snapshot s
  set asins = ax.asins,
      ever_fba = (ef.bs is not null),
      amazon_seller_sku = fs.seller_sku,
      title = pc.name,
      coleraine_available = case when pc.current_stock in (99, 999) then 0 else greatest(coalesce(pc.current_stock, 0), 0) end,
      coleraine_placeholder = coalesce(pc.current_stock in (99, 999), false),
      is_hazmat = coalesce((select bool_or(pc.name ilike '%' || w || '%') from unnest((select words from kw)) w), false),
      hazmat_source = case when coalesce((select bool_or(pc.name ilike '%' || w || '%') from unnest((select words from kw)) w), false) then 'keyword' end
  from ax
  left join ef on ef.bs = ax.bs
  left join fba_sku fs on fs.bs = ax.bs
  left join public.products_cache pc on pc.sku = ax.bs
  where ax.bs = s.base_sku;

  with ps as (
    select l.base_sku, sum(l.qty)::int as units
    from amazon.fba_send_batch_line l
    join amazon.fba_send_batch b on b.id = l.batch_id
    where b.status = 'pending'
    group by 1
  )
  update amazon.fba_replenishment_snapshot s
  set pending_send_units = ps.units
  from ps where ps.base_sku = s.base_sku;

  with ship as (
    select coalesce(amazon.base_sku(x.resolved_sku), amazon.base_sku(i.seller_sku)) as bs,
           sum(greatest(i.qty_shipped - i.qty_received, 0)
               * amazon.pack_size(coalesce(x.resolved_sku, i.seller_sku)))::int as units
    from amazon.inbound_shipment_item i
    join amazon.inbound_shipment sh on sh.shipment_id = i.shipment_id
      and sh.shipment_status in ('WORKING','SHIPPED','IN_TRANSIT','DELIVERED','CHECKED_IN')
    left join amazon.listings li on li.seller_sku = i.seller_sku
    left join amazon.v_asin_sku x on x.asin = li.asin and x.marketplace_id = sh.marketplace_id
    group by 1
  )
  update amazon.fba_replenishment_snapshot s
  set shipment_extra_units = greatest(0, ship.units - (s.fba_inbound_working + s.fba_inbound_shipped + s.fba_inbound_receiving))::int
  from ship where ship.bs = s.base_sku;

  update amazon.fba_replenishment_snapshot s
  set fba_in_transit = s.fba_inbound_working + s.fba_inbound_shipped + s.fba_inbound_receiving
                       + s.pending_send_units + s.shipment_extra_units;

  update amazon.fba_replenishment_snapshot s
  set target_units = round(v_cover * s.weekly_velocity, 1),
      days_of_cover_weeks = case when s.weekly_velocity > 0
        then round((s.fba_on_hand + s.fba_in_transit) / s.weekly_velocity, 1) end,
      raw_units_to_order = greatest(0, ceil(v_cover * s.weekly_velocity - s.fba_on_hand - s.fba_in_transit))::int,
      units_to_order = case when coalesce(s.never_fba, false) then 0 else
        (ceil(greatest(0, ceil(v_cover * s.weekly_velocity - s.fba_on_hand - s.fba_in_transit)) / v_moq::numeric) * v_moq)::int end,
      replenish_flag = (not coalesce(s.never_fba, false))
        and (v_cover * s.weekly_velocity - s.fba_on_hand - s.fba_in_transit) > 0;

  update amazon.fba_replenishment_snapshot s
  set reorder_cost = round(s.units_to_order * s.unit_cost, 2),
      gross_margin_pct = case when s.unit_cost is not null and s.avg_sell_price > 0
        then round(100 * (s.avg_sell_price - s.unit_cost) / s.avg_sell_price, 1) end,
      net_per_unit = round(s.avg_sell_price - coalesce(s.referral_fee_per_unit, 0)
                           - coalesce(s.fba_fee_per_unit, 0) - s.unit_cost, 2),
      net_margin_pct = case when s.unit_cost is not null and s.avg_sell_price > 0
        then round(100 * (s.avg_sell_price - coalesce(s.referral_fee_per_unit, 0)
                          - coalesce(s.fba_fee_per_unit, 0) - s.unit_cost) / s.avg_sell_price, 1) end;

  update amazon.fba_replenishment_snapshot s
  set can_send_now = least(s.units_to_order, coalesce(s.coleraine_available, 0)),
      buy_first = s.replenish_flag and s.units_to_order > coalesce(s.coleraine_available, 0);

  with fbm as (
    select regexp_replace(o.sku, '(?i)-Q[0-9]+$', '') as bs,
           sum(o.qty) as units,
           round(sum(o.profit) / nullif(sum(o.qty), 0), 2) as net_per_unit,
           round(sum(o.price * o.qty) / nullif(sum(o.qty), 0) / 1.2, 2) as px_ex
    from public.order_economics_all o
    where o.order_date >= current_date - 90
      and public.channel_group(o.channel) = 'Amazon'
    group by 1
  ),
  bands as (
    select floor(avg_sell_price / 2.5) as band, avg(fba_fee_per_unit) as fee
    from amazon.mv_sku_economics
    where fba_fee_per_unit is not null and avg_sell_price is not null
    group by 1
  ),
  stats as (
    select (percentile_cont(0.5) within group (order by referral_pct))::numeric as med_ref,
           avg(fba_fee_per_unit)::numeric as avg_fee
    from amazon.mv_sku_economics where referral_pct is not null and referral_pct > 0
  ),
  api_fee as (
    select distinct on (amazon.base_sku(x.resolved_sku))
           amazon.base_sku(x.resolved_sku) as bs, fe.fba_fee, fe.referral_fee
    from amazon.fba_fee_estimate fe
    join amazon.v_asin_sku x on x.asin = fe.asin and x.marketplace_id = fe.marketplace_id
    where fe.status = 'Success' and x.resolved_sku is not null
    order by amazon.base_sku(x.resolved_sku), fe.estimated_at desc
  )
  update amazon.fba_replenishment_snapshot s
  set fbm_units_90d = fbm.units,
      fbm_net_per_unit = fbm.net_per_unit,
      fbm_price_gross = round(fbm.px_ex * 1.2, 2),
      fba_net_per_unit_eff = case
        when s.ever_fba and s.net_per_unit is not null then s.net_per_unit
        when s.unit_cost is null or fbm.px_ex is null then null
        when af.fba_fee is not null then round((fbm.px_ex - coalesce(af.referral_fee, fbm.px_ex * st.med_ref) - af.fba_fee - s.unit_cost)::numeric, 2)
        when coalesce(b.fee, st.avg_fee) is not null then round((fbm.px_ex - fbm.px_ex * coalesce(st.med_ref, 0.15) - coalesce(b.fee, st.avg_fee) - s.unit_cost)::numeric, 2)
      end,
      fee_source = case
        when s.ever_fba and s.net_per_unit is not null then 'observed'
        when s.unit_cost is null or fbm.px_ex is null then null
        when af.fba_fee is not null then 'api'
        when coalesce(b.fee, st.avg_fee) is not null then 'modelled'
      end
  from fbm
  cross join stats st
  left join api_fee af on af.bs = fbm.bs
  left join bands b on b.band = floor(fbm.px_ex / 2.5)
  where fbm.bs = s.base_sku;

  update amazon.fba_replenishment_snapshot s
  set net_diff = round(s.fba_net_per_unit_eff - s.fbm_net_per_unit, 2)
  where s.fba_net_per_unit_eff is not null and s.fbm_net_per_unit is not null;

  select coalesce(sum(qty) filter (where public.channel_group(channel) = 'Amazon FBA')::numeric
                  / nullif(sum(qty), 0), 0)
  into v_fba_share
  from public.order_economics_all
  where order_date >= current_date - 90
    and public.channel_group(channel) in ('Amazon', 'Amazon FBA');

  update amazon.fba_replenishment_snapshot s
  set is_candidate = (
        not s.ever_fba and not coalesce(s.never_fba, false)
        and s.weekly_velocity >= 3 and coalesce(s.units_30d, 0) >= 8
        and coalesce(s.net_diff, -1) > 0
      );

  update amazon.fba_replenishment_snapshot s
  set suggested_first_send = least(
        coalesce(s.coleraine_available, 0),
        (ceil(greatest(1, ceil(4 * s.weekly_velocity * v_fba_share))
              / greatest(coalesce(pc.box_quantity, 1), 1)::numeric)
         * greatest(coalesce(pc.box_quantity, 1), 1))::int
      )
  from public.products_cache pc
  where pc.sku = s.base_sku and not s.ever_fba and s.weekly_velocity >= 3;

  update amazon.fba_send_batch b
  set status = 'seen', status_changed_at = now()
  where b.status = 'pending'
    and exists (
      select 1 from amazon.fba_send_batch_line l
      join amazon.fba_replenishment_snapshot s on s.base_sku = l.base_sku
      where l.batch_id = b.id
        and (s.fba_inbound_working + s.fba_inbound_shipped + s.fba_inbound_receiving) > 0
    )
    and b.created_at < now() - interval '6 hours';

  update amazon.fba_send_batch b
  set status = 'expired', status_changed_at = now()
  where b.status = 'pending' and b.created_at < now() - interval '14 days';
end
$$;

select public.amazon_refresh_fba_replenishment();
