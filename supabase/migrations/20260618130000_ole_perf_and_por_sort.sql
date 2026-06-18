-- PERF + POR-sort.
-- 1) order_line_economics: resolve channel fee once per DISTINCT channel (was a
--    correlated channel_fee_rules lookup PER ROW = ~21M seq scans -> the 500s).
--    Re-applies the prior fix (20260616130000_order_line_economics_fee_perf) which
--    was never applied. Output columns identical -> CREATE OR REPLACE is safe.
-- 2) get_threeds_reprice_candidates: order by POR%% (margin) not absolute GBP, so
--    the 1000-row cap keeps thin-margin items (raiseable to a higher tier), not
--    just big-GBP losers. Losses are negative on both measures, so still included.

-- ============================================================================
-- PERF: order_line_economics — resolve channel fee per DISTINCT CHANNEL, not per row
-- ----------------------------------------------------------------------------
-- Root cause of slow reports + repricer jobs (diagnosed 2026-06-16):
-- the `fee_resolved` CTE ran a correlated subquery against channel_fee_rules
-- ONCE PER ORDER LINE. The match is `COALESCE(channel,'') ILIKE channel_pattern`
-- — the pattern lives in the table, so it can't be indexed and Postgres full-
-- scans the (tiny, ~2-active-row) table every single time. With all order lines
-- since 2026-01-01 that produced ~21 MILLION sequential scans on a 2-row table
-- (pg_stat_user_tables: channel_fee_rules seq_scan ≈ 21.4M).
--
-- The resolved fee rule depends ONLY on `channel` — nothing else row-specific —
-- so we resolve it ONCE per distinct channel and join it back. There are only a
-- handful of distinct channels, collapsing ~21M scans to a handful. Output is
-- IDENTICAL: the same `fee_rule_json` shape feeds the unchanged final SELECT.
--
-- This is a pure view replacement — no data change, no schema change, fully
-- reversible (re-run 20260507185557 to restore the per-row version).
-- ============================================================================
CREATE OR REPLACE VIEW public.order_line_economics
WITH (security_invoker=on) AS
WITH lines_priced AS (
  SELECT
    ol.*,
    COALESCE(ol.unit_price, 0::numeric) AS raw_price,
    pc.cost_price AS cost_each,
    count(*) OVER (PARTITION BY ol.mintsoft_order_id) AS lines_in_order,
    SUM(COALESCE(ol.unit_price, 0::numeric) * ol.qty::numeric)
      OVER (PARTITION BY ol.mintsoft_order_id) AS order_revenue_total,
    COALESCE(pc.cost_price, 0::numeric) * ol.qty::numeric AS cost_weight,
    SUM(COALESCE(pc.cost_price, 0::numeric) * ol.qty::numeric)
      OVER (PARTITION BY ol.mintsoft_order_id) AS cost_weight_total,
    SUM(ol.qty::numeric) OVER (PARTITION BY ol.mintsoft_order_id) AS qty_total
  FROM order_lines ol
  LEFT JOIN products_cache pc ON pc.sku = ol.sku
  WHERE ol.order_date >= '2026-01-01'::timestamptz
),
lines_realloc AS (
  SELECT
    lp.*,
    CASE
      WHEN lines_in_order <= 1 THEN raw_price * qty::numeric
      WHEN cost_weight_total > 0 THEN
        order_revenue_total * (cost_weight / cost_weight_total)
      WHEN qty_total > 0 THEN
        order_revenue_total * (qty::numeric / qty_total)
      ELSE raw_price * qty::numeric
    END AS line_revenue
  FROM lines_priced lp
),
lines_with_rev_total AS (
  SELECT
    lr.*,
    SUM(lr.line_revenue) OVER (PARTITION BY lr.mintsoft_order_id) AS realloc_revenue_total
  FROM lines_realloc lr
),
courier_resolved AS (
  SELECT
    lr.*,
    COALESCE(cr.cost, 0::numeric) AS courier_full_cost,
    cr.courier
  FROM lines_with_rev_total lr
  LEFT JOIN courier_rates cr ON cr.service = lr.courier_service
),
courier_allocated AS (
  SELECT
    cr.*,
    -- Revenue-weighted courier share. Falls back to qty share, then equal split.
    CASE
      WHEN lines_in_order <= 1 THEN courier_full_cost
      WHEN realloc_revenue_total > 0 THEN
        courier_full_cost * (line_revenue / realloc_revenue_total)
      WHEN qty_total > 0 THEN
        courier_full_cost * (qty::numeric / qty_total)
      ELSE courier_full_cost / GREATEST(lines_in_order, 1)::numeric
    END AS courier_line_cost
  FROM courier_resolved cr
),
-- ── PERF FIX: resolve the channel-fee rule once per distinct channel ──────────
channel_fees AS (
  SELECT
    c.channel,
    (
      SELECT row_to_json(r.*)
      FROM (
        SELECT vat_rate, fee_pct, fixed_fee, name
        FROM channel_fee_rules
        WHERE active = true
          AND COALESCE(c.channel, '') ILIKE channel_pattern
        ORDER BY priority
        LIMIT 1
      ) r
    ) AS fee_rule_json
  FROM (SELECT DISTINCT channel FROM courier_allocated) c
),
fee_resolved AS (
  SELECT
    ca.*,
    cf.fee_rule_json
  FROM courier_allocated ca
  LEFT JOIN channel_fees cf ON cf.channel IS NOT DISTINCT FROM ca.channel
)
SELECT
  id,
  mintsoft_order_id,
  line_index,
  sku,
  product_name,
  brand_id,
  qty,
  CASE WHEN qty > 0 THEN round(line_revenue / qty::numeric, 6) ELSE 0 END AS price,
  cost_each,
  currency,
  order_date,
  channel,
  courier_service,
  courier,
  order_status,
  lines_in_order,
  round(courier_line_cost, 4) AS courier_cost,
  round(
    COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
      / GREATEST(lines_in_order, 1)::numeric
    + line_revenue
      * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
      * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
  , 4) AS channel_fee,
  fee_rule_json->>'name' AS fee_rule_name,
  round(line_revenue, 4) AS order_value,
  round(
    line_revenue - COALESCE(cost_each, 0) * qty::numeric
    - courier_line_cost
    - (
        COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
          / GREATEST(lines_in_order, 1)::numeric
        + line_revenue
          * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
          * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
      )
  , 4) AS profit,
  CASE
    WHEN line_revenue > 0 AND qty > 0 THEN round(
      (
        line_revenue - COALESCE(cost_each, 0) * qty::numeric
        - courier_line_cost
        - (
            COALESCE((fee_rule_json->>'fixed_fee')::numeric, 0)
              / GREATEST(lines_in_order, 1)::numeric
            + line_revenue
              * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20))
              * COALESCE((fee_rule_json->>'fee_pct')::numeric, 0)
          )
      ) / NULLIF(line_revenue * (1::numeric + COALESCE((fee_rule_json->>'vat_rate')::numeric, 0.20)), 0)
    , 6)
    ELSE NULL
  END AS por_pct,
  CASE
    WHEN length(sku) >= 4 AND substring(sku, 4, 1) = ANY(ARRAY['-', '/']) THEN 'Good'
    ELSE 'Dirt'
  END AS good_dirt,
  cost_each IS NULL OR cost_each = 0 AS missing_cost,
  EXTRACT(isoyear FROM order_date)::integer AS iso_year,
  EXTRACT(week FROM order_date)::integer AS iso_week,
  date_trunc('week', order_date)::date AS week_start
FROM fee_resolved;

CREATE OR REPLACE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
 RETURNS TABLE(sku text, base_sku text, pack_size integer, product_name text, brand_name text, units_sold bigint, revenue numeric, base_unit_cost numeric, pack_cost_unit numeric, cost_total numeric, real_fee_rate numeric, fees_total numeric, courier_total numeric, postage_unit numeric, profit numeric, por_pct numeric, current_price numeric, current_stock numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
  WITH store_sel AS (
    SELECT ebay_store_slug AS slug FROM public.threeds_stores
    WHERE mintsoft_channel = p_channel AND ebay_store_slug IS NOT NULL LIMIT 1
  ),
  intl_orders AS (
    SELECT DISTINCT regexp_replace(ol.order_number, '-[0-9]+$', '') AS ebay_ref
    FROM public.order_lines ol
    WHERE ol.channel = p_channel AND ol.order_number IS NOT NULL
      AND (ol.courier_service ILIKE '%INTL%'
        OR ol.courier_service ILIKE '%International%'
        OR ol.courier_service ILIKE '%Country Priced%')
  ),
  tx AS (
    SELECT t.sku, al.true_sku, t.external_item_id, t.item_name, t.quantity, t.price,
           t.unit_price, t.final_value_fee, t.order_date,
           COALESCE((t.raw->>'shippingPrice')::numeric, 0) AS shipping
    FROM public.threeds_order_transactions t CROSS JOIN store_sel s
    LEFT JOIN public.threeds_sku_aliases al ON al.dirt_sku = t.sku
    WHERE t.store_url ILIKE '%' || s.slug || '%'
      AND t.order_date >= now() - make_interval(days => p_days)
      AND t.price > 0
      AND COALESCE(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')
      AND t.sku !~* '-(DEL|PNR)(-|$)'
      AND NOT EXISTS (SELECT 1 FROM intl_orders io WHERE io.ebay_ref = t.order_external_id)
  ),
  agg AS (
    SELECT tx.sku,
      -- COST base resolves the dirt SKU to its true SKU; the listing SKU (tx.sku) is untouched.
      regexp_replace(COALESCE(tx.true_sku, tx.sku), '(?i)-Q[0-9]+$', '') AS base_sku,
      GREATEST(COALESCE(NULLIF(substring(tx.sku from '(?i)-Q([0-9]+)$'), '')::int, 1), 1) AS pack_size,
      (array_agg(tx.external_item_id ORDER BY tx.order_date DESC))[1] AS external_item_id,
      (array_agg(tx.item_name ORDER BY tx.order_date DESC))[1] AS item_name,
      SUM(tx.quantity)::bigint AS units_sold,
      SUM(tx.price) AS item_gross, SUM(tx.shipping) AS postage_gross,
      SUM(tx.final_value_fee) AS fvf, COUNT(*) AS txns,
      MAX(tx.order_date) AS last_order_date,
      (array_agg(tx.unit_price ORDER BY tx.order_date DESC))[1] AS last_unit_gross
    FROM tx GROUP BY 1, 2, 3
  ),
  courier AS (
    SELECT ole.sku AS base_sku,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS courier_per_unit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL AND ole.qty > 0
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%INTL%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%International%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%Country Priced%'
    GROUP BY ole.sku
  ),
  channel_courier AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS c
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL AND ole.qty > 0
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%INTL%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%International%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%Country Priced%'
  ),
  econ AS (
    SELECT a.*,
      COALESCE(c.courier_per_unit, (SELECT c FROM channel_courier)) AS courier_unit,
      (a.item_gross + a.postage_gross) AS gmv_gross,
      CASE WHEN a.units_sold > 0 THEN a.postage_gross / a.units_sold ELSE 0 END AS postage_unit,
      CASE WHEN (a.item_gross + a.postage_gross) > 0
        THEN LEAST(0.25, GREATEST(0.05, (a.fvf - a.txns * 0.36) / (a.item_gross + a.postage_gross)))
        ELSE NULL END AS var_fee_rate
    FROM agg a
    LEFT JOIN courier c ON c.base_sku = a.base_sku
  )
  SELECT e.sku, e.base_sku, e.pack_size,
    COALESCE(pc.name, pcb.name, e.item_name) AS product_name, COALESCE(b.name, bb.name) AS brand_name, e.units_sold,
    ROUND((e.item_gross / 1.2)::numeric, 2) AS revenue,
    ROUND(pcb.cost_price::numeric, 4) AS base_unit_cost,
    ROUND((NULLIF(pcb.cost_price, 0) * e.pack_size)::numeric, 4) AS pack_cost_unit,
    ROUND((NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold)::numeric, 2) AS cost_total,
    ROUND(e.var_fee_rate::numeric, 4) AS real_fee_rate,
    ROUND(e.fvf::numeric, 2) AS fees_total,
    ROUND((e.courier_unit * e.units_sold)::numeric, 2) AS courier_total,
    ROUND(e.postage_unit::numeric, 2) AS postage_unit,
    ROUND((e.gmv_gross / 1.2 - e.fvf - e.courier_unit * e.units_sold
      - (NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold))::numeric, 2) AS profit,
    CASE WHEN e.gmv_gross > 0 THEN ROUND(((e.gmv_gross / 1.2 - e.fvf - e.courier_unit * e.units_sold
      - (NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold)) / e.gmv_gross * 100)::numeric, 2)
      ELSE NULL END AS por_pct,
    ROUND((e.last_unit_gross / 1.2)::numeric, 2) AS current_price,
    COALESCE(pc.current_stock, pcb.current_stock) AS current_stock
  FROM econ e
  LEFT JOIN public.products_cache pcb ON pcb.sku = e.base_sku
  LEFT JOIN public.products_cache pc  ON pc.sku  = e.sku
  LEFT JOIN public.brands b  ON b.id  = pc.brand_id
  LEFT JOIN public.brands bb ON bb.id = pcb.brand_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.price_campaigns pcm
    WHERE pcm.status = 'active' AND (pcm.sku = e.base_sku OR pcm.sku = e.sku)
  )
  ORDER BY por_pct ASC NULLS LAST, profit ASC NULLS LAST;
$function$;
