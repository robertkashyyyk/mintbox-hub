-- ============================================================================
-- 20260630280000_amazon_fba_profit_channel.sql
-- "Amazon FBA" as a channel in Profit Intelligence (Dashboard first).
--
-- FBA orders never reach Mintsoft, so they're absent from order_line_economics.
-- Build a parallel FBA economics view shaped IDENTICALLY to order_line_economics,
-- using REAL settled fees from Finances:
--   revenue = Principal (ex-VAT, settled)   channel_fee = referral (Commission)
--   courier_cost = FBA fulfilment fee        profit = rev - cost - fba - referral
-- Then a combined source (order_line_economics + FBA) that the Dashboard RPCs
-- read. The order_line_economics matview is UNTOUCHED (repricer/weekly/scorecard
-- keep reading it directly = FBM/eBay only, which is correct). FBA is additive.
-- Starts W12 2026 (Finance backfill horizon).
-- ============================================================================

CREATE OR REPLACE VIEW public.v_fba_order_economics AS
WITH fe AS (   -- settled revenue + real fees per (order, seller-sku)
    SELECT marketplace_id, amazon_order_id, sku AS seller_sku,
           SUM(amount) FILTER (WHERE event_subtype = 'Principal' AND direction = 'credit') AS revenue,
           SUM(amount) FILTER (WHERE event_subtype = 'Commission')                         AS referral_fee,
           SUM(amount) FILTER (WHERE event_subtype = 'FBAPerUnitFulfillmentFee')           AS fba_fee
    FROM amazon.financial_events
    WHERE event_type = 'Shipment' AND sku IS NOT NULL
    GROUP BY 1, 2, 3
    HAVING SUM(amount) FILTER (WHERE event_subtype = 'Principal' AND direction = 'credit') > 0
),
oi AS (        -- FBA (AFN) order lines, from W12
    SELECT o.marketplace_id, o.amazon_order_id, o.purchase_date, o.order_status, oi.sku AS seller_sku,
           MIN(oi.asin) AS asin, SUM(oi.quantity) AS qty, MIN(oi.product_name) AS product_name
    FROM amazon.order_items oi
    JOIN amazon.orders o ON o.marketplace_id = oi.marketplace_id AND o.amazon_order_id = oi.amazon_order_id
    WHERE upper(COALESCE(o.fulfillment_channel, '')) IN ('AMAZON', 'AFN')
      AND o.purchase_date >= '2026-03-16'::timestamptz
    GROUP BY 1, 2, 3, 4, 5
),
joined AS (
    SELECT fe.marketplace_id, fe.amazon_order_id, fe.seller_sku, fe.revenue, fe.referral_fee, fe.fba_fee,
           oi.qty, oi.asin, oi.product_name, oi.purchase_date, oi.order_status, map.catalogue_sku
    FROM fe
    JOIN oi ON oi.marketplace_id = fe.marketplace_id AND oi.amazon_order_id = fe.amazon_order_id AND oi.seller_sku = fe.seller_sku
    LEFT JOIN amazon.asin_sku_map map ON map.marketplace_id = fe.marketplace_id AND map.asin = oi.asin
),
enriched AS (
    SELECT j.*,
           COALESCE(j.catalogue_sku, j.seller_sku) AS final_sku,
           pc.cost_price, pc.brand_id, COALESCE(pc.name, j.product_name) AS pname,
           COUNT(*)     OVER (PARTITION BY j.amazon_order_id) AS lines_in_order,
           ROW_NUMBER() OVER (PARTITION BY j.amazon_order_id ORDER BY j.seller_sku) AS line_index
    FROM joined j
    LEFT JOIN public.products_cache pc ON pc.sku = COALESCE(j.catalogue_sku, j.seller_sku)
)
SELECT
    ('fba:' || amazon_order_id || ':' || seller_sku)            AS id,
    hashtextextended(amazon_order_id, 0)                        AS mintsoft_order_id,  -- synthetic, for order counts
    line_index::integer                                        AS line_index,
    final_sku                                                  AS sku,
    pname                                                      AS product_name,
    brand_id,
    qty::integer                                              AS qty,
    ROUND(revenue / NULLIF(qty, 0), 6)                        AS price,
    cost_price                                                AS cost_each,
    'GBP'::text                                               AS currency,
    purchase_date                                             AS order_date,
    'Amazon FBA'::text                                        AS channel,
    'FBA'::text                                               AS courier_service,
    'Amazon FBA'::text                                        AS courier,
    order_status,
    lines_in_order::bigint                                    AS lines_in_order,
    ROUND(COALESCE(fba_fee, 0), 4)                           AS courier_cost,    -- FBA fulfilment -> courier slot
    ROUND(COALESCE(referral_fee, 0), 4)                      AS channel_fee,     -- referral -> channel fee
    'Amazon FBA (actual fees)'::text                         AS fee_rule_name,
    ROUND(revenue, 4)                                        AS order_value,
    ROUND(revenue - COALESCE(cost_price,0) * qty - COALESCE(fba_fee,0) - COALESCE(referral_fee,0), 4) AS profit,
    CASE WHEN revenue > 0 AND qty > 0
         THEN ROUND((revenue - COALESCE(cost_price,0)*qty - COALESCE(fba_fee,0) - COALESCE(referral_fee,0))
                    / NULLIF(revenue * 1.2, 0), 6)
         END                                                 AS por_pct,
    CASE WHEN length(final_sku) >= 4 AND substring(final_sku, 4, 1) = ANY(ARRAY['-','/']) THEN 'Good' ELSE 'Dirt' END AS good_dirt,
    cost_price IS NULL OR cost_price = 0                      AS missing_cost,
    EXTRACT(isoyear FROM purchase_date)::integer             AS iso_year,
    EXTRACT(week FROM purchase_date)::integer                AS iso_week,
    date_trunc('week', purchase_date)::date                  AS week_start
FROM enriched;

GRANT SELECT ON public.v_fba_order_economics TO authenticated, service_role;

-- Combined source: FBM/eBay (matview) + Amazon FBA. -------------------------
CREATE OR REPLACE VIEW public.order_economics_all AS
SELECT id::text AS id, mintsoft_order_id, line_index, sku, product_name, brand_id, qty, price, cost_each,
       currency, order_date, channel, courier_service, courier, order_status, lines_in_order,
       courier_cost, channel_fee, fee_rule_name, order_value, profit, por_pct, good_dirt, missing_cost,
       iso_year, iso_week, week_start
FROM public.order_line_economics
UNION ALL
SELECT id, mintsoft_order_id, line_index, sku, product_name, brand_id, qty, price, cost_each,
       currency, order_date, channel, courier_service, courier, order_status, lines_in_order,
       courier_cost, channel_fee, fee_rule_name, order_value, profit, por_pct, good_dirt, missing_cost,
       iso_year, iso_week, week_start
FROM public.v_fba_order_economics;

GRANT SELECT ON public.order_economics_all TO authenticated, service_role;

-- Repoint the two Dashboard RPCs to the combined source (only change: FROM). ----
CREATE OR REPLACE FUNCTION public.get_profit_week(p_iso_year integer, p_iso_week integer)
RETURNS TABLE (
  iso_year integer, iso_week integer, week_start date, week_end date,
  revenue numeric, qty bigint, order_count bigint, line_count bigint,
  courier_cost_total numeric, channel_fees_total numeric, cost_total numeric,
  profit numeric, por_pct numeric, aov numeric,
  good_count bigint, dirt_count bigint, missing_cost_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH src AS (
    SELECT * FROM public.order_economics_all
    WHERE iso_year = p_iso_year AND iso_week = p_iso_week
  )
  SELECT
    p_iso_year, p_iso_week,
    MIN(week_start), (MIN(week_start) + INTERVAL '6 days')::date,
    COALESCE(SUM(order_value), 0),
    COALESCE(SUM(qty), 0)::bigint,
    COUNT(DISTINCT mintsoft_order_id)::bigint,
    COUNT(*)::bigint,
    COALESCE(SUM(courier_cost), 0),
    COALESCE(SUM(channel_fee), 0),
    COALESCE(SUM(cost_each * qty), 0),
    COALESCE(SUM(profit), 0),
    CASE WHEN SUM(order_value * 1.2) > 0
      THEN ROUND((SUM(profit) / SUM(order_value * 1.2))::numeric, 6) ELSE NULL END,
    CASE WHEN COUNT(DISTINCT mintsoft_order_id) > 0
      THEN ROUND((SUM(order_value) / COUNT(DISTINCT mintsoft_order_id))::numeric, 4) ELSE NULL END,
    COUNT(*) FILTER (WHERE good_dirt = 'Good')::bigint,
    COUNT(*) FILTER (WHERE good_dirt = 'Dirt')::bigint,
    COUNT(*) FILTER (WHERE missing_cost)::bigint
  FROM src;
$$;

CREATE OR REPLACE FUNCTION public.get_profit_week_breakdown(p_iso_year integer, p_iso_week integer)
RETURNS TABLE(band text, line_count bigint, pct numeric, profit_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((value->>'loss_max')::numeric,      -1.0)  AS loss_max,
      COALESCE((value->>'breakeven_max')::numeric,  1.0)  AS breakeven_max,
      COALESCE((value->>'poor_max')::numeric,       9.99) AS poor_max,
      COALESCE((value->>'average_max')::numeric,   19.99) AS average_max,
      COALESCE((value->>'good_max')::numeric,      24.99) AS good_max,
      COALESCE((value->>'great_max')::numeric,     29.99) AS great_max,
      COALESCE((value->>'amazing_max')::numeric,   49.99) AS amazing_max
    FROM public.app_settings WHERE key = 'profit.loss_bands'
  ),
  clearance AS (
    SELECT DISTINCT
      regexp_replace(sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      start_date, COALESCE(end_date, CURRENT_DATE) AS end_date
    FROM public.price_campaigns
    WHERE status = 'active' AND type IN ('sale', 'liquidation')
  ),
  src AS (
    SELECT
      ole.profit, ole.cost_each,
      CASE WHEN ole.order_value IS NOT NULL AND ole.order_value > 0
        THEN (ole.profit / (ole.order_value * 1.2)) * 100.0 ELSE NULL END AS por_pct_line,
      EXISTS (
        SELECT 1 FROM clearance c
        WHERE c.base_sku = regexp_replace(ole.sku, '(?i)-Q[0-9]+$', '')
          AND ole.order_date::date BETWEEN c.start_date AND c.end_date
      ) AS is_clearance
    FROM public.order_economics_all ole
    WHERE ole.iso_year = p_iso_year AND ole.iso_week = p_iso_week
      AND ole.profit IS NOT NULL AND ole.order_value IS NOT NULL AND ole.order_value > 0
  ),
  banded AS (
    SELECT
      CASE
        WHEN s.is_clearance                         THEN 'clearance'
        WHEN s.cost_each IS NULL OR s.cost_each = 0 THEN 'unknown'
        WHEN s.por_pct_line <  c.loss_max          THEN 'loss'
        WHEN s.por_pct_line <= c.breakeven_max     THEN 'breakeven'
        WHEN s.por_pct_line <= c.poor_max          THEN 'poor'
        WHEN s.por_pct_line <= c.average_max       THEN 'average'
        WHEN s.por_pct_line <= c.good_max          THEN 'good'
        WHEN s.por_pct_line <= c.great_max         THEN 'great'
        WHEN s.por_pct_line <= c.amazing_max       THEN 'amazing'
        ELSE 'stellar'
      END AS band,
      s.profit
    FROM src s, cfg c
  ),
  totals AS (SELECT COUNT(*)::bigint AS n FROM banded)
  SELECT
    b.band, COUNT(*)::bigint AS line_count,
    CASE WHEN t.n > 0 THEN ROUND((COUNT(*)::numeric / t.n) * 100, 2) ELSE 0 END AS pct,
    CASE WHEN b.band = 'unknown' THEN NULL ELSE ROUND(SUM(b.profit)::numeric, 2) END AS profit_total
  FROM banded b CROSS JOIN totals t
  GROUP BY b.band, t.n
  ORDER BY array_position(
    ARRAY['clearance','unknown','loss','breakeven','poor','average','good','great','amazing','stellar'], b.band);
$function$;
