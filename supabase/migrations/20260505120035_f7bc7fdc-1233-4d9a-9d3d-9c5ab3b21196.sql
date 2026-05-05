
-- Add lsa.min_threshold setting (default 1 — Mintsoft "unset" sentinel)
INSERT INTO public.app_settings (key, value, description)
VALUES ('lsa.min_threshold', '1'::jsonb, 'SKUs with low_stock_alert_level <= this value are treated as having no LSA configured and excluded from LSA Calibration and Buy Recommendations.')
ON CONFLICT (key) DO NOTHING;

-- Update Buy Recommendations RPC to use lsa.min_threshold
CREATE OR REPLACE FUNCTION public.get_buy_recommendations(p_supplier_id uuid DEFAULT NULL::uuid, p_brand_id uuid DEFAULT NULL::uuid, p_include_pending boolean DEFAULT false)
 RETURNS TABLE(sku text, product_name text, brand_id uuid, brand_name text, supplier_id uuid, supplier_name text, current_stock numeric, on_order numeric, back_orders numeric, low_stock_alert numeric, unit_cost numeric, required_qty numeric, pending_po_qty numeric, pending_po_id uuid, sales_4w numeric, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.min_threshold'), 1) AS lsa_min
  ),
  bo AS (
    SELECT sku, sum(qty)::numeric AS back_orders
    FROM order_lines
    WHERE order_status = 'ONBACKORDER'
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY sku
  ),
  s4w AS (
    SELECT sku, sum(qty)::numeric AS sales_4w
    FROM order_lines
    WHERE order_date >= (now() - interval '28 days')
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY sku
  ),
  pending AS (
    SELECT
      l.sku,
      sum(l.qty_ordered)::numeric AS pending_qty,
      (array_agg(po.id ORDER BY po.sent_at DESC NULLS LAST))[1] AS some_po_id
    FROM purchase_order_lines l
    JOIN purchase_orders po ON po.id = l.po_id
    WHERE po.status = 'sent'
      AND po.mintsoft_po_id IS NULL
    GROUP BY l.sku
  ),
  base AS (
    SELECT
      pc.sku,
      pc.name AS product_name,
      pc.brand_id,
      b.name AS brand_name,
      sp.supplier_id AS supplier_id,
      s.name AS supplier_name,
      COALESCE(pc.current_stock, 0)::numeric AS current_stock,
      COALESCE(pc.on_order, 0)::numeric AS on_order,
      COALESCE(bo.back_orders, 0)::numeric AS back_orders,
      COALESCE(pc.low_stock_alert_level, 0)::numeric AS low_stock_alert,
      pc.cost_price::numeric AS unit_cost,
      COALESCE(pending.pending_qty, 0)::numeric AS pending_po_qty,
      pending.some_po_id AS pending_po_id,
      COALESCE(s4w.sales_4w, 0)::numeric AS sales_4w
    FROM products_cache pc
    CROSS JOIN cfg
    LEFT JOIN brands b ON b.id = pc.brand_id
    LEFT JOIN sku_prefixes sp ON sp.prefix = upper(split_part(
        pc.sku,
        CASE WHEN pc.sku LIKE '%/%' THEN '/' ELSE '-' END,
        1
    ))
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN bo ON bo.sku = pc.sku
    LEFT JOIN pending ON pending.sku = pc.sku
    LEFT JOIN s4w ON s4w.sku = pc.sku
    WHERE COALESCE(pc.quarantined, false) = false
      AND COALESCE(pc.discontinued, false) = false
      AND (
        COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
        OR COALESCE(bo.back_orders, 0) > 0
      )
  ),
  scored AS (
    SELECT
      *,
      GREATEST(
        (back_orders + low_stock_alert) - (current_stock + on_order),
        0
      ) AS raw_required
    FROM base
  )
  SELECT
    sku, product_name, brand_id, brand_name, supplier_id, supplier_name,
    current_stock, on_order, back_orders, low_stock_alert, unit_cost,
    raw_required AS required_qty, pending_po_qty, pending_po_id, sales_4w,
    CASE
      WHEN pending_po_qty > 0 THEN 'po_sent_pending'
      WHEN raw_required > 0   THEN 'recommended'
      ELSE 'covered'
    END AS status
  FROM scored
  WHERE (p_supplier_id IS NULL OR supplier_id = p_supplier_id)
    AND (p_brand_id IS NULL OR brand_id = p_brand_id)
    AND (raw_required > 0 OR (p_include_pending AND pending_po_qty > 0))
  ORDER BY supplier_name NULLS LAST, brand_name NULLS LAST, sku;
$function$;

-- Update LSA Calibration RPC to exclude SKUs with current_lsa <= lsa.min_threshold
CREATE OR REPLACE FUNCTION public.get_lsa_calibration(p_brand_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sku text, product_name text, brand_id uuid, brand_name text, supplier_id uuid, supplier_name text, current_stock numeric, current_lsa numeric, weekly_velocity numeric, base_multiplier numeric, target_lsa numeric, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.weekly_window_weeks'), 4) AS weeks,
      COALESCE((SELECT (value)::numeric FROM app_settings WHERE key = 'lsa.global_base_multiplier'), 4) AS global_mult,
      COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.min_threshold'), 1) AS lsa_min,
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
      AND COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
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
$function$;
