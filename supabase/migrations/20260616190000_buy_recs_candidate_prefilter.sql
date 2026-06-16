-- Speed up get_buy_recommendations (buying page was ~12s and timing out for the anon role
-- at ~3.4s; barely completing for authenticated ~8s).
--
-- Root cause: the `base` CTE built EVERY product with an LSA or backorder (~184,649 of 225k)
-- and ran the per-row sku_prefixes LATERAL supplier lookup on all of them, then dropped ~98%
-- at the final WHERE (required_qty_boxed > 0 OR pending). The expensive LATERAL/brand/supplier
-- joins ran 184k times to produce ~3k rows.
--
-- Fix: split into a cheap `cand` (candidate) CTE that computes only the quantities needed to
-- decide whether a row can survive, using just products_cache + the aggregate CTEs (hash joins),
-- and pre-filters to the survivors BEFORE the expensive joins. The supplier LATERAL + brand +
-- supplier joins then run only on the ~few-thousand candidates.
--
-- PROVABLY PARITY-PRESERVING: the final WHERE keeps a row iff
--   required_qty_boxed > 0  (⟺ raw_required > 0 ⟺ (back_orders+effective_lsa) > (current_stock+on_order))
--   OR (p_include_pending AND pending_po_qty > 0).
-- The `cand` filter keeps the SUPERSET `(back_orders+effective_lsa) > (current_stock+on_order)
--   OR pending_po_qty > 0` (independent of p_include_pending), computed from the identical
-- expressions. The brand/supplier joins are LEFT JOINs that only add columns, never drop rows,
-- so restricting them to candidates yields byte-identical output. cand is MATERIALIZED to force
-- the filter to happen before the LATERAL.

CREATE OR REPLACE FUNCTION public.get_buy_recommendations(
  p_supplier_id uuid DEFAULT NULL::uuid,
  p_brand_id uuid DEFAULT NULL::uuid,
  p_include_pending boolean DEFAULT false
)
RETURNS TABLE(
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
  raw_required_qty numeric,
  box_quantity integer,
  pending_po_qty numeric,
  pending_po_id uuid,
  sales_4w numeric,
  status text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE((SELECT (value)::int FROM app_settings WHERE key = 'lsa.min_threshold'), 1) AS lsa_min
  ),
  bo_live AS (
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
    -- Only look back 7 days — matches the useSentPoSuppression hook window.
    SELECT l.sku, sum(l.qty_ordered)::numeric AS pending_qty,
      (array_agg(po.id ORDER BY po.sent_at DESC NULLS LAST))[1] AS some_po_id
    FROM purchase_order_lines l
    JOIN purchase_orders po ON po.id = l.po_id
    WHERE po.status = 'sent'
      AND po.mintsoft_po_id IS NULL
      AND po.sent_at >= (now() - interval '7 days')
    GROUP BY l.sku
  ),
  todays_asn AS (
    SELECT sku, SUM(qty)::numeric AS asn_qty
    FROM todays_open_asns
    GROUP BY sku
  ),
  cand AS MATERIALIZED (
    SELECT
      pc.sku, pc.name AS product_name, pc.brand_id,
      COALESCE(pc.current_stock, 0)::numeric AS current_stock,
      GREATEST(COALESCE(pc.on_order, 0), COALESCE(ta.asn_qty, 0))::numeric AS on_order,
      COALESCE(pc.mintsoft_back_orders, bo_live.back_orders, 0)::numeric AS back_orders,
      COALESCE(pc.low_stock_alert_level, 0)::numeric AS low_stock_alert,
      CASE WHEN COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
           THEN COALESCE(pc.low_stock_alert_level, 0)::numeric
           ELSE 0::numeric END AS effective_lsa,
      pc.cost_price::numeric AS unit_cost,
      GREATEST(COALESCE(pc.box_quantity, 1), 1)::integer AS box_quantity,
      COALESCE(pending.pending_qty, 0)::numeric AS pending_po_qty,
      pending.some_po_id AS pending_po_id,
      COALESCE(s4w.sales_4w, 0)::numeric AS sales_4w
    FROM products_cache pc
    CROSS JOIN cfg
    LEFT JOIN bo_live ON bo_live.sku = pc.sku
    LEFT JOIN pending ON pending.sku = pc.sku
    LEFT JOIN s4w ON s4w.sku = pc.sku
    LEFT JOIN todays_asn ta ON ta.sku = pc.sku
    WHERE COALESCE(pc.quarantined, false) = false
      AND COALESCE(pc.discontinued, false) = false
      AND pc.sku NOT LIKE 'DIRT%'
      AND (
        COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
        OR COALESCE(pc.mintsoft_back_orders, bo_live.back_orders, 0) > 0
      )
      -- Pre-filter to rows that can possibly be recommended or are pending (superset of the
      -- final WHERE) so the expensive supplier LATERAL below only runs on candidates.
      AND (
        (
          COALESCE(pc.mintsoft_back_orders, bo_live.back_orders, 0)
          + CASE WHEN COALESCE(pc.low_stock_alert_level, 0) > cfg.lsa_min
                 THEN COALESCE(pc.low_stock_alert_level, 0)::numeric
                 ELSE 0::numeric END
        )
        > (
          COALESCE(pc.current_stock, 0)::numeric
          + GREATEST(COALESCE(pc.on_order, 0), COALESCE(ta.asn_qty, 0))::numeric
        )
        OR COALESCE(pending.pending_qty, 0) > 0
      )
  ),
  base AS (
    SELECT
      cand.*,
      b.name AS brand_name,
      sp.supplier_id AS supplier_id,
      s.name AS supplier_name
    FROM cand
    LEFT JOIN brands b ON b.id = cand.brand_id
    LEFT JOIN LATERAL (
      SELECT sp2.supplier_id, sp2.prefix
      FROM sku_prefixes sp2
      WHERE upper(cand.sku) LIKE sp2.prefix || '-%'
         OR upper(cand.sku) LIKE sp2.prefix || '/%'
      ORDER BY length(sp2.prefix) DESC
      LIMIT 1
    ) sp ON true
    LEFT JOIN suppliers s ON s.id = sp.supplier_id
  ),
  scored AS (
    SELECT *,
      GREATEST((back_orders + effective_lsa) - (current_stock + on_order), 0) AS raw_required
    FROM base
  ),
  boxed AS (
    SELECT *,
      CASE
        WHEN raw_required <= 0 THEN raw_required
        WHEN box_quantity <= 1 THEN raw_required
        ELSE (CEIL(raw_required::numeric / box_quantity::numeric) * box_quantity::numeric)
      END AS required_qty_boxed
    FROM scored
  )
  SELECT sku, product_name, brand_id, brand_name, supplier_id, supplier_name,
    current_stock, on_order, back_orders, low_stock_alert, unit_cost,
    required_qty_boxed AS required_qty,
    raw_required AS raw_required_qty,
    box_quantity,
    pending_po_qty, pending_po_id, sales_4w,
    CASE WHEN pending_po_qty > 0 THEN 'po_sent_pending'
         WHEN required_qty_boxed > 0 THEN 'recommended'
         ELSE 'covered' END AS status
  FROM boxed
  WHERE (p_supplier_id IS NULL OR supplier_id = p_supplier_id)
    AND (p_brand_id IS NULL OR brand_id = p_brand_id)
    AND (required_qty_boxed > 0 OR (p_include_pending AND pending_po_qty > 0))
  ORDER BY supplier_name NULLS LAST, brand_name NULLS LAST, sku;
$function$;
