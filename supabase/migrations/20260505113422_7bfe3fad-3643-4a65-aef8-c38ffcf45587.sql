
-- 1. Settings
INSERT INTO public.app_settings (key, value, description) VALUES
  ('lsa.weekly_window_weeks', '4'::jsonb, 'Sales window in weeks for LSA calibration velocity (4, 8, or 12).'),
  ('lsa.global_base_multiplier', '4'::jsonb, 'Fallback weeks-of-cover multiplier when brand has none.'),
  ('lsa.tolerance', '{"critical":0.5,"low":0.85,"high":1.15,"excess":1.5}'::jsonb, 'LSA classification tolerance bands (current/target ratios).')
ON CONFLICT (key) DO NOTHING;

-- 2. RPC
CREATE OR REPLACE FUNCTION public.get_lsa_calibration(p_brand_id uuid DEFAULT NULL)
RETURNS TABLE(
  sku text,
  product_name text,
  brand_id uuid,
  brand_name text,
  supplier_id uuid,
  supplier_name text,
  current_stock numeric,
  current_lsa numeric,
  weekly_velocity numeric,
  base_multiplier numeric,
  target_lsa numeric,
  status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.weekly_window_weeks'), 4) AS weeks,
      COALESCE((SELECT (value)::numeric FROM app_settings WHERE key = 'lsa.global_base_multiplier'), 4) AS global_mult,
      COALESCE((SELECT (value->>'critical')::numeric FROM app_settings WHERE key = 'lsa.tolerance'), 0.5) AS t_crit,
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
  base AS (
    SELECT
      pc.sku,
      pc.name AS product_name,
      pc.brand_id,
      b.name AS brand_name,
      sp.supplier_id,
      s.name AS supplier_name,
      COALESCE(pc.current_stock, 0)::numeric AS current_stock,
      COALESCE(pc.low_stock_alert_level, 0)::numeric AS current_lsa,
      ROUND(COALESCE(sales.units, 0) / NULLIF(cfg.weeks, 0)::numeric, 2) AS weekly_velocity,
      COALESCE(b.base_multiplier, cfg.global_mult)::numeric AS base_multiplier,
      cfg.t_crit, cfg.t_low, cfg.t_high, cfg.t_excess
    FROM products_cache pc
    LEFT JOIN brands b ON b.id = pc.brand_id
    LEFT JOIN sku_prefixes sp ON sp.prefix = upper(split_part(
      pc.sku, CASE WHEN pc.sku LIKE '%/%' THEN '/' ELSE '-' END, 1))
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN sales ON sales.sku = pc.sku
    CROSS JOIN cfg
    WHERE COALESCE(pc.quarantined, false) = false
      AND COALESCE(pc.discontinued, false) = false
      AND pc.mintsoft_product_id IS NOT NULL
  ),
  scored AS (
    SELECT
      *,
      ROUND(weekly_velocity * base_multiplier)::numeric AS target_lsa
    FROM base
  )
  SELECT
    sku, product_name, brand_id, brand_name, supplier_id, supplier_name,
    current_stock, current_lsa, weekly_velocity, base_multiplier, target_lsa,
    CASE
      WHEN target_lsa = 0 AND current_lsa = 0 THEN 'target'
      WHEN target_lsa = 0 AND current_lsa > 0 THEN 'excess'
      WHEN current_lsa < target_lsa * t_crit   THEN 'critical'
      WHEN current_lsa < target_lsa * t_low    THEN 'low'
      WHEN current_lsa <= target_lsa * t_high  THEN 'target'
      WHEN current_lsa <= target_lsa * t_excess THEN 'high'
      ELSE 'excess'
    END AS status
  FROM scored
  WHERE (p_brand_id IS NULL OR brand_id = p_brand_id);
$$;

-- 3. Sidebar / RBAC area
INSERT INTO public.system_areas (key, label, parent_key, route_path, icon_name, sort_order, is_menu_item)
VALUES ('decisions.lsa_calibration', 'LSA Calibration', 'decisions', '/decisions/lsa-calibration', 'Gauge', 30, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_area_permissions (role, area_key, capability) VALUES
  ('systems_controller',  'decisions.lsa_calibration', 'admin'),
  ('inventory_steward',   'decisions.lsa_calibration', 'execute'),
  ('commercial_governor', 'decisions.lsa_calibration', 'execute'),
  ('finance_governor',    'decisions.lsa_calibration', 'read'),
  ('operations_steward',  'decisions.lsa_calibration', 'read')
ON CONFLICT (role, area_key) DO NOTHING;
