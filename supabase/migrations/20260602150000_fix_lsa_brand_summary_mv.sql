-- Fix lsa_brand_summary: was filtering on mintsoft_product_id (only 30 rows)
-- but the sync script writes to mintsoft_id (220k+ rows). Also broaden the
-- filter so brands with LSA set OR with recent sales both appear — not just
-- brands where low_stock_alert_level > lsa_min (which excluded everything
-- except NGK, the only brand with LSA pre-configured).

DROP MATERIALIZED VIEW IF EXISTS lsa_brand_summary;

CREATE MATERIALIZED VIEW lsa_brand_summary AS
WITH cfg AS (
  SELECT
    COALESCE((SELECT value::integer FROM app_settings WHERE key = 'lsa.weekly_window_weeks'), 4) AS weeks,
    COALESCE((SELECT value::numeric FROM app_settings WHERE key = 'lsa.global_base_multiplier'), 4) AS global_mult,
    COALESCE((SELECT value::integer FROM app_settings WHERE key = 'lsa.min_threshold'), 1) AS lsa_min,
    COALESCE((SELECT (value->>'critical')::numeric FROM app_settings WHERE key = 'lsa.tolerance'), 0.5)  AS t_crit,
    COALESCE((SELECT (value->>'low')::numeric      FROM app_settings WHERE key = 'lsa.tolerance'), 0.85) AS t_low,
    COALESCE((SELECT (value->>'high')::numeric     FROM app_settings WHERE key = 'lsa.tolerance'), 1.15) AS t_high,
    COALESCE((SELECT (value->>'excess')::numeric   FROM app_settings WHERE key = 'lsa.tolerance'), 1.5)  AS t_excess
),
sales AS (
  SELECT ol.sku, SUM(ol.qty)::numeric AS units
  FROM order_lines ol, cfg
  WHERE ol.order_date >= (now() - (cfg.weeks || ' weeks')::interval)
    AND ol.order_date >= '2026-01-01T00:00:00Z'
  GROUP BY ol.sku
),
scored AS (
  SELECT
    pc.brand_id,
    b.name AS brand_name,
    COALESCE(pc.low_stock_alert_level, 0::numeric) AS current_lsa,
    ROUND(COALESCE(sales.units, 0) / NULLIF(cfg.weeks, 0)::numeric
          * COALESCE(b.base_multiplier, cfg.global_mult)) AS target_lsa,
    cfg.t_crit, cfg.t_low, cfg.t_high, cfg.t_excess
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  LEFT JOIN sales   ON sales.sku = pc.sku
  CROSS JOIN cfg
  WHERE COALESCE(pc.quarantined, false)   = false
    AND COALESCE(pc.discontinued, false)  = false
    AND pc.mintsoft_id IS NOT NULL
    AND (
      COALESCE(sales.units, 0) > 0
      OR COALESCE(pc.low_stock_alert_level, 0) > 0
    )
),
classified AS (
  SELECT
    brand_id,
    brand_name,
    CASE
      WHEN target_lsa = 0 AND current_lsa = 0 THEN 'target'
      WHEN target_lsa = 0 AND current_lsa > 0  THEN 'excess'
      WHEN current_lsa < (target_lsa * t_crit)  THEN 'critical'
      WHEN current_lsa < (target_lsa * t_low)   THEN 'low'
      WHEN current_lsa <= (target_lsa * t_high)  THEN 'target'
      WHEN current_lsa <= (target_lsa * t_excess) THEN 'high'
      ELSE 'excess'
    END AS status
  FROM scored
)
SELECT
  brand_id,
  brand_name,
  COUNT(*)::integer                                          AS total,
  COUNT(*) FILTER (WHERE status = 'critical')::integer      AS critical,
  COUNT(*) FILTER (WHERE status = 'low')::integer           AS low,
  COUNT(*) FILTER (WHERE status = 'target')::integer        AS target,
  COUNT(*) FILTER (WHERE status = 'high')::integer          AS high,
  COUNT(*) FILTER (WHERE status = 'excess')::integer        AS excess,
  now()                                                     AS refreshed_at
FROM classified
GROUP BY brand_id, brand_name;
