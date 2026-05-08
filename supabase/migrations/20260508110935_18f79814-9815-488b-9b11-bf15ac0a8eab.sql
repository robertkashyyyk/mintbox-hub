-- Materialized brand-level summary of LSA calibration (mirrors get_lsa_calibration's status logic)
CREATE MATERIALIZED VIEW IF NOT EXISTS public.lsa_brand_summary AS
WITH cfg AS (
  SELECT
    COALESCE((SELECT (value)::int     FROM app_settings WHERE key = 'lsa.weekly_window_weeks'), 4) AS weeks,
    COALESCE((SELECT (value)::numeric FROM app_settings WHERE key = 'lsa.global_base_multiplier'), 4) AS global_mult,
    COALESCE((SELECT (value)::int     FROM app_settings WHERE key = 'lsa.min_threshold'), 1) AS lsa_min,
    COALESCE((SELECT (value->>'critical')::numeric FROM app_settings WHERE key = 'lsa.tolerance'), 0.5)  AS t_crit,
    COALESCE((SELECT (value->>'low')::numeric      FROM app_settings WHERE key = 'lsa.tolerance'), 0.85) AS t_low,
    COALESCE((SELECT (value->>'high')::numeric     FROM app_settings WHERE key = 'lsa.tolerance'), 1.15) AS t_high,
    COALESCE((SELECT (value->>'excess')::numeric   FROM app_settings WHERE key = 'lsa.tolerance'), 1.5)  AS t_excess
),
sales AS (
  SELECT ol.sku, SUM(ol.qty)::numeric AS units
  FROM order_lines ol, cfg
  WHERE ol.order_date >= now() - (cfg.weeks || ' weeks')::interval
    AND ol.order_date >= '2026-01-01'::timestamptz
  GROUP BY ol.sku
),
scored AS (
  SELECT
    pc.brand_id,
    b.name AS brand_name,
    COALESCE(pc.low_stock_alert_level, 0)::numeric AS current_lsa,
    ROUND(COALESCE(sales.units, 0) / NULLIF(cfg.weeks, 0)::numeric * COALESCE(b.base_multiplier, cfg.global_mult)::numeric)::numeric AS target_lsa,
    cfg.t_crit, cfg.t_low, cfg.t_high, cfg.t_excess
  FROM products_cache pc
  LEFT JOIN brands b   ON b.id = pc.brand_id
  LEFT JOIN sales      ON sales.sku = pc.sku
  CROSS JOIN cfg
  WHERE COALESCE(pc.quarantined, false)   = false
    AND COALESCE(pc.discontinued, false)  = false
    AND pc.mintsoft_product_id IS NOT NULL
    AND COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
),
classified AS (
  SELECT
    brand_id,
    brand_name,
    CASE
      WHEN target_lsa = 0 AND current_lsa = 0 THEN 'target'
      WHEN target_lsa = 0 AND current_lsa > 0 THEN 'excess'
      WHEN current_lsa <  target_lsa * t_crit   THEN 'critical'
      WHEN current_lsa <  target_lsa * t_low    THEN 'low'
      WHEN current_lsa <= target_lsa * t_high   THEN 'target'
      WHEN current_lsa <= target_lsa * t_excess THEN 'high'
      ELSE 'excess'
    END AS status
  FROM scored
)
SELECT
  brand_id,
  brand_name,
  COUNT(*)::int                                                    AS total,
  COUNT(*) FILTER (WHERE status = 'critical')::int                 AS critical,
  COUNT(*) FILTER (WHERE status = 'low')::int                      AS low,
  COUNT(*) FILTER (WHERE status = 'target')::int                   AS target,
  COUNT(*) FILTER (WHERE status = 'high')::int                     AS high,
  COUNT(*) FILTER (WHERE status = 'excess')::int                   AS excess,
  now()                                                            AS refreshed_at
FROM classified
GROUP BY brand_id, brand_name;

-- Unique index enables CONCURRENTLY refresh later if needed
CREATE UNIQUE INDEX IF NOT EXISTS lsa_brand_summary_brand_id_idx
  ON public.lsa_brand_summary (COALESCE(brand_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Refresh function (callable from cron / UI)
CREATE OR REPLACE FUNCTION public.refresh_lsa_brand_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.lsa_brand_summary;
END;
$$;

GRANT SELECT ON public.lsa_brand_summary TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.refresh_lsa_brand_summary() TO authenticated, service_role;

-- Nightly refresh at 03:15 UK time (after midnight order sync, before users arrive)
SELECT cron.schedule(
  'refresh-lsa-brand-summary-nightly',
  '15 3 * * *',
  $$ SELECT public.refresh_lsa_brand_summary(); $$
);

-- Seed it once
SELECT public.refresh_lsa_brand_summary();