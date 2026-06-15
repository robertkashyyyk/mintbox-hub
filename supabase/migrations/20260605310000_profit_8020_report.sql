-- 80:20 Profit Report — data spine.
--
-- A new *lens* on the profit data already computed (see get_threeds_reprice_candidates),
-- not a new pipeline. eBay/FBM only (all 3DS transactions are eBay), commercial SKUs
-- where landed cost is known. Aggregated to BASE SKU (the physical, costed, stocked unit):
-- pack variants (-Qnn) roll up to their base so capital is never double-counted across
-- packs that draw from the same bin. Base-unit accounting (qty x pack_size) for cost,
-- cover and velocity; courier stays per-parcel (qty). base_sku / pack_size are parsed
-- from the SKU's -Qnn suffix (join-free, to keep the planner off a fan-out nested loop).
--
-- Built as small layered views (v_8020_*) + thin functions. The leaderboard reads the
-- retained snapshot table (fast); the heavy view is only touched by the weekly capture
-- and the one-time backfill (~6s). Apply via the Supabase SQL editor / a direct
-- connection (whole file runs in one go).

-- ---------------------------------------------------------------------------
-- Per-parcel courier cost per base SKU (median, domestic only) + global fallback.
-- ---------------------------------------------------------------------------
-- Sourced from
-- order_lines + courier_rates directly (NOT the heavy order_line_economics view)
-- so the snapshot computes in ~1s rather than ~7s.
CREATE OR REPLACE VIEW public.v_8020_courier AS
  SELECT ol.sku AS base_sku,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.cost) AS courier_unit
  FROM public.order_lines ol
  JOIN public.courier_rates cr ON cr.service = ol.courier_service AND cr.active
  WHERE ol.order_date >= now() - interval '180 days'
    AND cr.cost IS NOT NULL
    AND strpos(upper(COALESCE(ol.courier_service, '')), 'INTL') = 0
    AND strpos(upper(COALESCE(ol.courier_service, '')), 'INTERNATIONAL') = 0
    AND strpos(upper(COALESCE(ol.courier_service, '')), 'COUNTRY PRICED') = 0
  GROUP BY ol.sku;

CREATE OR REPLACE VIEW public.v_8020_courier_global AS
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY cr.cost) AS courier_unit
  FROM public.order_lines ol
  JOIN public.courier_rates cr ON cr.service = ol.courier_service AND cr.active
  WHERE ol.order_date >= now() - interval '180 days' AND cr.cost IS NOT NULL;

-- International orders carry untracked courier; exclude as the repricer does.
CREATE OR REPLACE VIEW public.v_8020_intl_orders AS
  SELECT DISTINCT ol.order_number AS ebay_ref
  FROM public.order_lines ol
  WHERE ol.order_number IS NOT NULL
    AND (strpos(upper(ol.courier_service), 'INTL') > 0
      OR strpos(upper(ol.courier_service), 'INTERNATIONAL') > 0
      OR strpos(upper(ol.courier_service), 'COUNTRY PRICED') > 0);

-- ---------------------------------------------------------------------------
-- Exploded transactions: base_sku + pack_size parsed from the -Qnn suffix,
-- ISO week, domestic + non-DEL/PNR only.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_8020_tx AS
  SELECT
    -- base_sku / pack_size parsed from the SKU's -Qnn suffix (join-free, so the
    -- planner can't pick a fan-out nested loop).
    regexp_replace(t.sku, '(?i)-Q[0-9]+$', '') AS base_sku,
    GREATEST(COALESCE(NULLIF(substring(t.sku from '(?i)-Q([0-9]+)$'), '')::int, 1), 1) AS pack_size,
    t.quantity, t.price,
    -- Some very recent sales have no settled FVF yet (null). Estimate at eBay UK's
    -- ~13% of gross so the sale still gets a sensible profit instead of nulling out.
    COALESCE(t.final_value_fee, 0.13 * (t.price + COALESCE((t.raw->>'shippingPrice')::numeric, 0))) AS final_value_fee,
    COALESCE((t.raw->>'shippingPrice')::numeric, 0) AS shipping,
    t.order_date,
    EXTRACT(isoyear FROM t.order_date)::int AS iso_year,
    EXTRACT(week FROM t.order_date)::int AS iso_week,
    date_trunc('week', t.order_date)::date AS week_start
  FROM public.threeds_order_transactions t
  LEFT JOIN public.v_8020_intl_orders io ON io.ebay_ref = t.order_external_id
  WHERE t.price > 0
    AND COALESCE(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')
    AND t.sku !~* '-(DEL|PNR)(-|$)'
    AND io.ebay_ref IS NULL;

-- ---------------------------------------------------------------------------
-- Per ISO-week, per base SKU economics (the two-truths profit, costed).
-- Cost known only: the Unknown / no-cost bucket is excluded from every ranking.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_8020_weekly AS
  WITH agg AS (
    SELECT x.iso_year, x.iso_week, x.week_start, x.base_sku,
      SUM(x.quantity)::bigint AS commercial_qty,
      SUM(x.quantity * x.pack_size)::bigint AS base_units,
      SUM(x.price) AS item_gross,
      SUM(x.shipping) AS postage_gross,
      SUM(x.final_value_fee) AS fvf
    FROM public.v_8020_tx x
    GROUP BY x.iso_year, x.iso_week, x.week_start, x.base_sku
  ),
  priced AS (
    SELECT a.iso_year, a.iso_week, a.week_start, a.base_sku,
      pc.name AS product_name, b.name AS brand_name, pc.brand_id,
      a.commercial_qty, a.base_units, a.fvf,
      a.item_gross / 1.2 AS revenue,
      NULLIF(pc.cost_price, 0) * a.base_units AS cost_total,
      COALESCE(cu.courier_unit, g.courier_unit) * a.commercial_qty AS courier_total,
      a.item_gross + a.postage_gross AS gmv_gross
    FROM agg a
    CROSS JOIN public.v_8020_courier_global g
    LEFT JOIN public.products_cache pc ON pc.sku = a.base_sku
    LEFT JOIN public.brands b ON b.id = pc.brand_id
    LEFT JOIN public.v_8020_courier cu ON cu.base_sku = a.base_sku
    WHERE COALESCE(pc.cost_price, 0) > 0
  )
  SELECT iso_year, iso_week, week_start, base_sku, product_name, brand_name, brand_id,
    commercial_qty, base_units,
    ROUND(revenue::numeric, 2) AS revenue,
    ROUND(cost_total::numeric, 2) AS cost_total,
    ROUND(fvf::numeric, 2) AS fees_total,
    ROUND(courier_total::numeric, 2) AS courier_total,
    ROUND((gmv_gross / 1.2 - fvf - courier_total - cost_total)::numeric, 2) AS profit,
    CASE WHEN gmv_gross > 0
      THEN ROUND(((gmv_gross / 1.2 - fvf - courier_total - cost_total) / gmv_gross * 100)::numeric, 2)
      ELSE NULL END AS por_pct
  FROM priced;

-- ---------------------------------------------------------------------------
-- Retained ISO-week snapshots (stability + any over-time view).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profit_8020_weekly (
  iso_year     int  NOT NULL,
  iso_week     int  NOT NULL,
  week_start   date NOT NULL,
  base_sku     text NOT NULL,
  product_name text,
  brand_name   text,
  units        bigint,
  revenue      numeric,
  profit       numeric,
  por_pct      numeric,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (iso_year, iso_week, base_sku)
);

CREATE INDEX IF NOT EXISTS idx_profit_8020_weekly_week ON public.profit_8020_weekly (iso_year, iso_week);
CREATE INDEX IF NOT EXISTS idx_profit_8020_weekly_sku  ON public.profit_8020_weekly (base_sku);

ALTER TABLE public.profit_8020_weekly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profit_8020_weekly read" ON public.profit_8020_weekly;
CREATE POLICY "profit_8020_weekly read" ON public.profit_8020_weekly FOR SELECT USING (true);

-- Upsert one ISO week (the week containing p_week_start) from the live view.
CREATE OR REPLACE FUNCTION public.capture_profit_8020_week(p_week_start date)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mon date := date_trunc('week', p_week_start)::date;
  v_n   integer;
BEGIN
  INSERT INTO public.profit_8020_weekly
    (iso_year, iso_week, week_start, base_sku, product_name, brand_name, units, revenue, profit, por_pct)
  SELECT w.iso_year, w.iso_week, w.week_start, w.base_sku, w.product_name, w.brand_name,
    w.base_units, w.revenue, w.profit, w.por_pct
  FROM public.v_8020_weekly w
  WHERE w.week_start = v_mon
  ON CONFLICT (iso_year, iso_week, base_sku) DO UPDATE SET
    week_start = EXCLUDED.week_start, product_name = EXCLUDED.product_name,
    brand_name = EXCLUDED.brand_name, units = EXCLUDED.units, revenue = EXCLUDED.revenue,
    profit = EXCLUDED.profit, por_pct = EXCLUDED.por_pct, captured_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Live leaderboard: trailing-window economics + capital / target / cover / stability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_8020_leaderboard(p_weeks integer DEFAULT 8)
 RETURNS TABLE(
   base_sku text, product_name text, brand_name text,
   units numeric, profit numeric, profit_per_week numeric, por_pct numeric,
   on_hand numeric, cost_each numeric, avg_weekly_units numeric, stock_cover_days numeric,
   capital numeric, targeted_capital numeric, trapped_capital numeric, overstock boolean,
   capital_efficiency numeric, weeks_in_top_tier integer
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  -- Reads from the retained snapshot table (fast; completed ISO weeks only).
  -- The expensive live view (v_8020_weekly) is only touched by the weekly capture.
  WITH recent_weeks AS (
    SELECT iso_year, iso_week FROM public.profit_8020_weekly
    GROUP BY iso_year, iso_week
    ORDER BY iso_year DESC, iso_week DESC
    LIMIT p_weeks
  ),
  slice AS (
    SELECT s.* FROM public.profit_8020_weekly s
    JOIN recent_weeks r ON r.iso_year = s.iso_year AND r.iso_week = s.iso_week
  ),
  win AS (
    SELECT base_sku,
      MAX(product_name) AS product_name,
      MAX(brand_name) AS brand_name,
      SUM(units)::numeric AS units,
      SUM(profit) AS profit,
      SUM(revenue) AS revenue
    FROM slice
    GROUP BY base_sku
  ),
  ranked AS (
    SELECT base_sku,
      cume_dist() OVER (PARTITION BY iso_year, iso_week ORDER BY profit) AS pr
    FROM slice
  ),
  stability AS (
    SELECT base_sku, COUNT(*) FILTER (WHERE pr >= 0.8)::int AS weeks_in_top_tier
    FROM ranked GROUP BY base_sku
  )
  SELECT
    win.base_sku, win.product_name, win.brand_name,
    win.units,
    ROUND(win.profit::numeric, 2) AS profit,
    ROUND((win.profit / NULLIF(p_weeks, 0))::numeric, 2) AS profit_per_week,
    CASE WHEN win.revenue > 0 THEN ROUND((win.profit / win.revenue * 100)::numeric, 2) ELSE NULL END AS por_pct,
    COALESCE(pc.current_stock, 0)::numeric AS on_hand,
    ROUND(pc.cost_price::numeric, 4) AS cost_each,
    COALESCE(v.avg_weekly_units, 0)::numeric AS avg_weekly_units,
    CASE WHEN COALESCE(v.avg_weekly_units, 0) > 0
      THEN ROUND((COALESCE(pc.current_stock, 0) / (v.avg_weekly_units / 7.0))::numeric, 1)
      ELSE NULL END AS stock_cover_days,
    ROUND((COALESCE(pc.current_stock, 0) * pc.cost_price)::numeric, 2) AS capital,
    CASE WHEN b.base_multiplier IS NOT NULL AND COALESCE(v.avg_weekly_units, 0) > 0
      THEN ROUND((v.avg_weekly_units * b.base_multiplier * 2 * pc.cost_price)::numeric, 2)
      ELSE NULL END AS targeted_capital,
    CASE WHEN b.base_multiplier IS NOT NULL AND COALESCE(v.avg_weekly_units, 0) > 0
      THEN GREATEST(0, ROUND((COALESCE(pc.current_stock, 0) * pc.cost_price
             - v.avg_weekly_units * b.base_multiplier * 2 * pc.cost_price)::numeric, 2))
      ELSE NULL END AS trapped_capital,
    CASE WHEN b.base_multiplier IS NOT NULL AND COALESCE(v.avg_weekly_units, 0) > 0
      THEN (COALESCE(pc.current_stock, 0) * pc.cost_price)
           >= 1.5 * (v.avg_weekly_units * b.base_multiplier * 2 * pc.cost_price)
      ELSE false END AS overstock,
    CASE WHEN COALESCE(pc.current_stock, 0) * pc.cost_price > 0
      THEN ROUND(((win.profit / NULLIF(p_weeks, 0)) / (pc.current_stock * pc.cost_price))::numeric, 4)
      ELSE NULL END AS capital_efficiency,
    COALESCE(s.weeks_in_top_tier, 0) AS weeks_in_top_tier
  FROM win
  LEFT JOIN public.products_cache pc ON pc.sku = win.base_sku
  LEFT JOIN public.sku_velocity v ON v.sku = win.base_sku
  LEFT JOIN public.brands b ON b.id = pc.brand_id
  LEFT JOIN stability s ON s.base_sku = win.base_sku
  ORDER BY win.profit DESC NULLS LAST;
$function$;

GRANT SELECT ON public.v_8020_weekly TO anon, authenticated, service_role;
GRANT SELECT ON public.profit_8020_weekly TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capture_profit_8020_week(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_8020_leaderboard(integer) TO anon, authenticated, service_role;

-- Weekly snapshot of the just-finished ISO week, Sunday 20:30 UTC (after the
-- liquidation snapshot at 20:00). Idempotent: re-running replaces the job by name.
SELECT cron.schedule(
  'capture-profit-8020-weekly',
  '30 20 * * 0',
  $$SELECT public.capture_profit_8020_week((date_trunc('week', now())::date - 7));$$
);

-- Backfill the trailing 8 completed ISO weeks in a SINGLE pass (computes the
-- heavy view once, not once per week), so the stability column has history
-- immediately. This is the only statement that does real work at apply time.
-- If it exceeds the SQL-editor statement timeout, run JUST this INSERT on its
-- own / via a direct connection — every object above is already created.
INSERT INTO public.profit_8020_weekly
  (iso_year, iso_week, week_start, base_sku, product_name, brand_name, units, revenue, profit, por_pct)
SELECT w.iso_year, w.iso_week, w.week_start, w.base_sku, w.product_name, w.brand_name,
  w.base_units, w.revenue, w.profit, w.por_pct
FROM public.v_8020_weekly w
WHERE w.week_start >= date_trunc('week', now())::date - 56
  AND w.week_start <  date_trunc('week', now())::date
ON CONFLICT (iso_year, iso_week, base_sku) DO UPDATE SET
  week_start = EXCLUDED.week_start, product_name = EXCLUDED.product_name,
  brand_name = EXCLUDED.brand_name, units = EXCLUDED.units, revenue = EXCLUDED.revenue,
  profit = EXCLUDED.profit, por_pct = EXCLUDED.por_pct, captured_at = now();
