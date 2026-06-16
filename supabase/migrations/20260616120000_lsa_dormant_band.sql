-- Add a "Dormant" band to lsa_brand_summary and keep it OUT of the POT% denominator.
--
-- Problem: items with no demand in the velocity window get target_lsa=0, and the old
-- CASE branded ANY such item with current_lsa>0 as "excess" — including the huge tail
-- sitting at the minimum LSA (1, the Mintsoft default). Those are already at the floor;
-- nothing to do. For NGK that was 2,681 of 2,705 "excess", crushing POT% to ~12%.
--
-- Fix: classify "no demand AND at/below the LSA floor" as DORMANT (informational — these
-- are dead/no-demand lines, also the liquidation / strangled-seller candidate pool).
-- POT% should be measured over the ACTIVELY-MANAGED set only (total − dormant), so the
-- dormant tail no longer drags it down. A no-demand item with LSA set ABOVE the floor is
-- still genuinely "excess" (lowerable).

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
    cfg.lsa_min, cfg.t_crit, cfg.t_low, cfg.t_high, cfg.t_excess
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
      -- No demand in window: at/below the floor = dormant (nothing to do);
      -- above the floor = genuinely over-set (lowerable).
      WHEN target_lsa = 0 AND current_lsa <= lsa_min THEN 'dormant'
      WHEN target_lsa = 0 AND current_lsa >  lsa_min THEN 'excess'
      WHEN current_lsa < (target_lsa * t_crit)   THEN 'critical'
      WHEN current_lsa < (target_lsa * t_low)    THEN 'low'
      WHEN current_lsa <= (target_lsa * t_high)  THEN 'target'
      WHEN current_lsa <= (target_lsa * t_excess) THEN 'high'
      ELSE 'excess'
    END AS status
  FROM scored
)
SELECT
  brand_id,
  brand_name,
  COUNT(*)::integer                                     AS total,
  COUNT(*) FILTER (WHERE status = 'critical')::integer AS critical,
  COUNT(*) FILTER (WHERE status = 'low')::integer      AS low,
  COUNT(*) FILTER (WHERE status = 'target')::integer   AS target,
  COUNT(*) FILTER (WHERE status = 'high')::integer     AS high,
  COUNT(*) FILTER (WHERE status = 'excess')::integer   AS excess,
  COUNT(*) FILTER (WHERE status = 'dormant')::integer  AS dormant,
  -- Actively-managed total (excludes dormant) — the POT% denominator.
  COUNT(*) FILTER (WHERE status <> 'dormant')::integer AS active_total,
  now()                                                AS refreshed_at
FROM classified
GROUP BY brand_id, brand_name;

-- Unique index so the nightly refresh can run CONCURRENTLY if it chooses.
CREATE UNIQUE INDEX idx_lsa_brand_summary_brand ON lsa_brand_summary (brand_id);

GRANT SELECT ON lsa_brand_summary TO anon, authenticated, service_role;

REFRESH MATERIALIZED VIEW lsa_brand_summary;
