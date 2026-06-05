-- Courier Margin report: SKUs where the courier fee eats too much of the sale
-- price (esp. DHL). Surfaces actual per-order courier cost from
-- order_line_economics, plus the SKU's dims so the UI can judge whether the
-- item genuinely needs DHL (over Parcel limits) or is mis-routed (fits Parcel).

-- Lightweight persistence of human review decisions per SKU.
CREATE TABLE IF NOT EXISTS public.courier_margin_reviews (
  sku         text PRIMARY KEY,
  verdict     text CHECK (verdict IN ('genuinely_dhl','fix_courier','ignore')),
  note        text,
  reviewed_by uuid,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courier_margin_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read courier_margin_reviews"  ON public.courier_margin_reviews FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write courier_margin_reviews" ON public.courier_margin_reviews FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Per-SKU courier-margin aggregation for a courier pattern + window.
CREATE OR REPLACE FUNCTION public.get_courier_margin_candidates(
  from_date         date,
  to_date           date,
  courier_pattern   text DEFAULT 'dhl',
  min_orders        integer DEFAULT 3,
  single_item_only  boolean DEFAULT false
)
RETURNS TABLE(
  sku text,
  product_name text,
  brand_name text,
  orders bigint,
  single_item_orders bigint,
  avg_price numeric,
  avg_courier numeric,
  courier_pct numeric,
  avg_margin numeric,
  avg_por_pct numeric,
  length_cm numeric,
  depth_cm numeric,
  height_cm numeric,
  weight_g numeric,
  review_verdict text,
  review_note text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH lines AS (
    SELECT
      ole.sku, ole.product_name, ole.brand_id,
      ole.price, ole.courier_cost, ole.profit, ole.por_pct, ole.lines_in_order
    FROM order_line_economics ole
    WHERE ole.order_date >= from_date
      AND ole.order_date <= (to_date + 1)
      AND ole.price > 0
      AND ole.courier_cost > 0
      AND (ole.courier ILIKE '%'||courier_pattern||'%'
           OR ole.courier_service ILIKE '%'||courier_pattern||'%')
      AND (NOT single_item_only OR ole.lines_in_order = 1)
  ),
  agg AS (
    SELECT
      sku,
      max(product_name) AS product_name,
      (array_agg(brand_id) FILTER (WHERE brand_id IS NOT NULL))[1] AS brand_id,
      count(*) AS orders,
      count(*) FILTER (WHERE lines_in_order = 1) AS single_item_orders,
      round(avg(price), 2) AS avg_price,
      round(avg(courier_cost), 2) AS avg_courier,
      round(avg(courier_cost) / NULLIF(avg(price), 0) * 100, 1) AS courier_pct,
      round(avg(profit), 2) AS avg_margin,
      round(avg(por_pct), 1) AS avg_por_pct
    FROM lines
    GROUP BY sku
    HAVING count(*) >= min_orders
  )
  SELECT
    a.sku, a.product_name, b.name AS brand_name,
    a.orders, a.single_item_orders,
    a.avg_price, a.avg_courier, a.courier_pct, a.avg_margin, a.avg_por_pct,
    pc.length, pc.depth, pc.height, pc.weight,
    r.verdict, r.note
  FROM agg a
  LEFT JOIN products_cache pc ON pc.sku = a.sku
  LEFT JOIN brands b ON b.id = a.brand_id
  LEFT JOIN courier_margin_reviews r ON r.sku = a.sku
  ORDER BY a.courier_pct DESC;
$$;
