CREATE OR REPLACE FUNCTION public.get_buy_recommendations(
  p_supplier_id uuid DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL,
  p_include_pending boolean DEFAULT false
)
RETURNS TABLE (
  sku text,
  product_name text,
  brand_id uuid,
  brand_name text,
  supplier_id uuid,
  supplier_name text,
  current_stock numeric,
  on_order numeric,
  back_orders numeric,
  low_stock_alert numeric,
  unit_cost numeric,
  required_qty numeric,
  pending_po_qty numeric,
  pending_po_id uuid,
  status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH bo AS (
    SELECT sku, sum(qty)::numeric AS back_orders
    FROM order_lines
    WHERE order_status = 'ONBACKORDER'
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
      p.sku,
      p.name AS product_name,
      p.brand_id,
      b.name AS brand_name,
      b.default_supplier_id AS supplier_id,
      s.name AS supplier_name,
      COALESCE(p.current_stock, 0)::numeric AS current_stock,
      COALESCE(p.on_order, 0)::numeric AS on_order,
      COALESCE(bo.back_orders, 0)::numeric AS back_orders,
      COALESCE(p.low_stock_alert, 0)::numeric AS low_stock_alert,
      p.cost_price::numeric AS unit_cost,
      COALESCE(pending.pending_qty, 0)::numeric AS pending_po_qty,
      pending.some_po_id AS pending_po_id
    FROM products_cache p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN suppliers s ON s.id = b.default_supplier_id
    LEFT JOIN bo ON bo.sku = p.sku
    LEFT JOIN pending ON pending.sku = p.sku
    WHERE COALESCE(p.quarantined, false) = false
      AND (p.low_stock_alert IS NOT NULL OR COALESCE(bo.back_orders, 0) > 0)
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
    sku,
    product_name,
    brand_id,
    brand_name,
    supplier_id,
    supplier_name,
    current_stock,
    on_order,
    back_orders,
    low_stock_alert,
    unit_cost,
    raw_required AS required_qty,
    pending_po_qty,
    pending_po_id,
    CASE
      WHEN pending_po_qty > 0 THEN 'po_sent_pending'
      WHEN raw_required > 0   THEN 'recommended'
      ELSE 'covered'
    END AS status
  FROM scored
  WHERE
    (p_supplier_id IS NULL OR supplier_id = p_supplier_id)
    AND (p_brand_id IS NULL OR brand_id = p_brand_id)
    AND (
      raw_required > 0
      OR (p_include_pending AND pending_po_qty > 0)
    )
  ORDER BY supplier_name NULLS LAST, brand_name NULLS LAST, sku;
$function$;

GRANT EXECUTE ON FUNCTION public.get_buy_recommendations(uuid, uuid, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_buy_recommendations_summary()
RETURNS TABLE (
  recommended_count bigint,
  pending_po_count bigint,
  total_required_qty numeric,
  total_required_cost numeric,
  missing_cost_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $function$
  WITH r AS (
    SELECT * FROM public.get_buy_recommendations(NULL, NULL, true)
  )
  SELECT
    count(*) FILTER (WHERE status = 'recommended')::bigint,
    count(*) FILTER (WHERE status = 'po_sent_pending')::bigint,
    COALESCE(sum(required_qty) FILTER (WHERE status = 'recommended'), 0)::numeric,
    COALESCE(sum(required_qty * COALESCE(unit_cost, 0)) FILTER (WHERE status = 'recommended'), 0)::numeric,
    count(*) FILTER (WHERE status = 'recommended' AND (unit_cost IS NULL OR unit_cost <= 0))::bigint
  FROM r;
$function$;

GRANT EXECUTE ON FUNCTION public.get_buy_recommendations_summary() TO authenticated, service_role;