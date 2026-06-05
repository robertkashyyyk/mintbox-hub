-- Format downgrade savings (Parcel → Large Letter): items shipping on a parcel
-- service that fit within Large Letter limits, where the actual courier paid
-- exceeds the Large Letter rate. Saving = actual paid − Large Letter price.

-- Seed observed standard rates into carrier_format_services so savings compute
-- out of the box (editable in Carrier Settings → Format Services).
--   Large Letter: RM Tracked 48 - Letterbox ≈ £1.65
--   Parcel:       RM Tracked 48             ≈ £2.65
--   DHL:          DHL Ecom UK Next Day      ≈ £5.50
UPDATE carrier_format_services SET price_pence = 165 WHERE slug = 'large-letter' AND price_pence IS NULL;
UPDATE carrier_format_services SET price_pence = 265 WHERE slug = 'parcel'       AND price_pence IS NULL;
UPDATE carrier_format_services SET price_pence = 550 WHERE slug = 'dhl'          AND price_pence IS NULL;

-- Per-SKU candidates for downgrade analysis. Returns the domestic, non-DHL,
-- non-international universe with avg actual courier paid + dims; the UI applies
-- the target-format fit test (sorted 3-D + weight) and computes the saving.
CREATE OR REPLACE FUNCTION public.get_downgrade_candidates(
  from_date         date,
  to_date           date,
  min_orders        integer DEFAULT 3,
  single_item_only  boolean DEFAULT true
)
RETURNS TABLE(
  sku text,
  product_name text,
  brand_name text,
  orders bigint,
  single_item_orders bigint,
  avg_price numeric,
  avg_courier numeric,
  length_cm numeric,
  depth_cm numeric,
  height_cm numeric,
  weight_g numeric,
  review_verdict text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH lines AS (
    SELECT ole.sku, ole.product_name, ole.brand_id,
           ole.price, ole.courier_cost, ole.lines_in_order
    FROM order_line_economics ole
    WHERE ole.order_date >= from_date
      AND ole.order_date <= (to_date + 1)
      AND ole.courier_cost > 0
      -- domestic standard parcel universe only (Large Letter is the downgrade target)
      AND COALESCE(ole.courier, '')         NOT ILIKE '%dhl%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%dhl%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%letterbox%'   -- already Large Letter
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%(ll)%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%international%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%intl%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%european%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%special%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%express%'
      AND (NOT single_item_only OR ole.lines_in_order = 1)
  ),
  agg AS (
    SELECT sku,
      max(product_name) AS product_name,
      (array_agg(brand_id) FILTER (WHERE brand_id IS NOT NULL))[1] AS brand_id,
      count(*) AS orders,
      count(*) FILTER (WHERE lines_in_order = 1) AS single_item_orders,
      round(avg(price), 2) AS avg_price,
      round(avg(courier_cost), 2) AS avg_courier
    FROM lines
    GROUP BY sku
    HAVING count(*) >= min_orders
  )
  SELECT a.sku, a.product_name, b.name AS brand_name,
    a.orders, a.single_item_orders, a.avg_price, a.avg_courier,
    pc.length, pc.depth, pc.height, pc.weight, r.verdict
  FROM agg a
  LEFT JOIN products_cache pc ON pc.sku = a.sku
  LEFT JOIN brands b ON b.id = a.brand_id
  LEFT JOIN courier_margin_reviews r ON r.sku = a.sku
  ORDER BY a.orders DESC;
$$;
