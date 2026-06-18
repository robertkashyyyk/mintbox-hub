-- PERF: materialise order_line_economics.
-- The fee-per-channel fix removed the ~21M scans, but the view still recomputes
-- the whole 2026 dataset (window funcs + products_cache/courier_rates joins) on
-- EVERY query (cold ~7s, repricer ~9s). It is read by analytics (Profit, weekly)
-- and the repricer's 365-day courier median — none need live-to-the-second data.
-- So materialise it: pay the compute once per refresh, serve instant reads.
--
-- No dependent VIEWS exist (only SECURITY DEFINER functions + direct reads, which
-- resolve by name), so the view->matview swap is safe. Body is byte-identical to
-- the live fee-perf view, so economics are unchanged (as of last refresh).
-- Refreshed every 6h (CONCURRENTLY, non-blocking). On-demand refresh available
-- via refresh_order_line_economics().

DROP VIEW IF EXISTS public.order_line_economics;

CREATE MATERIALIZED VIEW public.order_line_economics AS
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


-- Unique index enables REFRESH ... CONCURRENTLY (non-blocking); others speed reads.
CREATE UNIQUE INDEX IF NOT EXISTS ole_mat_id_uidx        ON public.order_line_economics (id);
CREATE INDEX        IF NOT EXISTS ole_mat_week_idx       ON public.order_line_economics (iso_year, iso_week);
CREATE INDEX        IF NOT EXISTS ole_mat_chan_date_idx  ON public.order_line_economics (channel, order_date);
CREATE INDEX        IF NOT EXISTS ole_mat_sku_idx        ON public.order_line_economics (sku);

GRANT SELECT ON public.order_line_economics TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_order_line_economics()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.order_line_economics;
END
$fn$;
GRANT EXECUTE ON FUNCTION public.refresh_order_line_economics() TO authenticated, service_role;

DO $cron$ BEGIN PERFORM cron.unschedule('refresh-order-line-economics'); EXCEPTION WHEN OTHERS THEN NULL; END $cron$;
SELECT cron.schedule('refresh-order-line-economics', '30 */6 * * *', $j$SELECT public.refresh_order_line_economics();$j$);
