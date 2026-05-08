
CREATE OR REPLACE VIEW public.order_telemetry_open_lines AS
WITH bouncer_counts AS (
  SELECT
    mintsoft_order_id,
    COUNT(*) FILTER (
      WHERE from_status = 'AWAITINGPICKING' AND to_status = 'NEW'
    ) AS bounce_back_count
  FROM public.order_status_history
  GROUP BY mintsoft_order_id
),
active_po_skus AS (
  SELECT DISTINCT pol.sku
  FROM public.purchase_order_lines pol
  JOIN public.purchase_orders po ON po.id = pol.po_id
  WHERE po.status IN ('draft', 'sent', 'approved', 'partial')
)
SELECT
  ol.id,
  ol.mintsoft_order_id,
  ol.line_index,
  ol.sku,
  ol.qty,
  ol.order_date,
  ol.channel,
  ol.channel_order_ref,
  ol.warehouse_id,
  ol.brand_id,
  ol.order_status,
  ol.order_status_id,
  ol.product_name,
  ol.customer_name,
  ol.last_status_change_at,
  ol.last_backordered_at,
  b.name AS brand_name,
  COALESCE(bc.bounce_back_count, 0)::int AS bounce_back_count,
  COALESCE(pc.current_stock, 0)::numeric AS current_stock,
  COALESCE(pc.on_order, 0)::numeric AS on_order_qty,
  (aps.sku IS NOT NULL) AS on_active_po,
  CASE
    WHEN ol.order_status = 'ONBACKORDER' THEN
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (now() - COALESCE(ol.last_backordered_at, ol.last_status_change_at, ol.order_date))) / 86400
      )::int
    ELSE NULL
  END AS days_on_backorder,
  CASE
    WHEN COALESCE(bc.bounce_back_count, 0) >= 2 THEN 'bouncer'
    WHEN COALESCE(pc.current_stock, 0) <= 0
         AND COALESCE(pc.on_order, 0) <= 0
         AND aps.sku IS NULL
         AND ol.order_status IN ('NEW','AWAITINGPICKING','ONBACKORDER') THEN 'unordered'
    WHEN ol.order_status = 'ONBACKORDER'
         AND EXTRACT(EPOCH FROM (now() - COALESCE(ol.last_backordered_at, ol.last_status_change_at, ol.order_date))) / 86400 >= 5 THEN 'chronic_backorder'
    ELSE NULL
  END AS problem_kind
FROM public.order_lines ol
LEFT JOIN public.brands b ON b.id = ol.brand_id
LEFT JOIN bouncer_counts bc ON bc.mintsoft_order_id = ol.mintsoft_order_id
LEFT JOIN public.products_cache pc ON pc.sku = ol.sku
LEFT JOIN active_po_skus aps ON aps.sku = ol.sku
WHERE ol.order_date >= '2026-01-01'
  AND ol.order_status IN ('NEW','AWAITINGPICKING','ONBACKORDER','PICKED');

GRANT SELECT ON public.order_telemetry_open_lines TO authenticated;
