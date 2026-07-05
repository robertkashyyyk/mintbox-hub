-- Missing Costs page performance: the page was loading ALL ~22k missing-cost products
-- (paginated 1000s) plus every missing_cost order line into the browser, then filtering
-- client-side — hence the slowness. Replace that with two brand-scoped RPCs:
--   1) missing_cost_brand_summary()  — cheap grouped aggregate powering the brand chips
--   2) missing_costs_for_brand(...)  — rows for ONE brand (or the Unmapped bucket) with
--      28d/7d velocity + last-sold computed server-side.
-- "Missing cost" definition matches the page: cost null/<=0, not discontinued/quarantined,
-- has a mintsoft_id.

CREATE OR REPLACE FUNCTION public.missing_cost_brand_summary()
RETURNS TABLE(brand_id uuid, brand_name text, missing_count integer,
              sold_28d_skus integer, sold_28d_units numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH mc AS (
    SELECT pc.brand_id, pc.sku
    FROM products_cache pc
    WHERE (pc.cost_price IS NULL OR pc.cost_price <= 0)
      AND COALESCE(pc.discontinued,false) = false
      AND COALESCE(pc.quarantined,false) = false
      AND pc.mintsoft_id IS NOT NULL
  ),
  s AS (
    SELECT ol.sku, SUM(ol.qty)::numeric AS units
    FROM order_lines ol
    WHERE ol.order_date >= now() - interval '28 days'
    GROUP BY ol.sku
  )
  SELECT mc.brand_id,
         COALESCE(b.name, 'Unmapped')                                   AS brand_name,
         COUNT(*)::integer                                              AS missing_count,
         COUNT(*) FILTER (WHERE COALESCE(s.units,0) > 0)::integer       AS sold_28d_skus,
         COALESCE(SUM(s.units),0)::numeric                              AS sold_28d_units
  FROM mc
  LEFT JOIN brands b ON b.id = mc.brand_id
  LEFT JOIN s ON s.sku = mc.sku
  GROUP BY mc.brand_id, COALESCE(b.name, 'Unmapped')
  ORDER BY sold_28d_units DESC, missing_count DESC;
$$;

CREATE OR REPLACE FUNCTION public.missing_costs_for_brand(
  p_brand_id uuid DEFAULT NULL,
  p_unmapped boolean DEFAULT false
)
RETURNS TABLE(id uuid, sku text, name text, suppliers text, current_stock numeric,
              brand_id uuid, brand_name text, mintsoft_id integer,
              units_28d numeric, units_7d numeric, last_sold timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH mc AS (
    SELECT pc.id, pc.sku, pc.name, pc.suppliers, pc.current_stock, pc.brand_id, pc.mintsoft_id
    FROM products_cache pc
    WHERE (pc.cost_price IS NULL OR pc.cost_price <= 0)
      AND COALESCE(pc.discontinued,false) = false
      AND COALESCE(pc.quarantined,false) = false
      AND pc.mintsoft_id IS NOT NULL
      AND CASE WHEN p_unmapped THEN pc.brand_id IS NULL ELSE pc.brand_id = p_brand_id END
  ),
  s AS (
    SELECT ol.sku,
           (SUM(ol.qty) FILTER (WHERE ol.order_date >= now() - interval '28 days'))::numeric AS u28,
           (SUM(ol.qty) FILTER (WHERE ol.order_date >= now() - interval '7 days'))::numeric  AS u7,
           MAX(ol.order_date) AS last_sold
    FROM order_lines ol
    WHERE ol.order_date >= now() - interval '400 days'
      AND ol.sku IN (SELECT sku FROM mc)
    GROUP BY ol.sku
  )
  SELECT mc.id, mc.sku, mc.name, mc.suppliers, mc.current_stock, mc.brand_id,
         COALESCE(b.name, 'Unmapped') AS brand_name, mc.mintsoft_id,
         COALESCE(s.u28,0)::numeric, COALESCE(s.u7,0)::numeric, s.last_sold
  FROM mc
  LEFT JOIN brands b ON b.id = mc.brand_id
  LEFT JOIN s ON s.sku = mc.sku;
$$;

REVOKE ALL ON FUNCTION public.missing_cost_brand_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.missing_costs_for_brand(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missing_cost_brand_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.missing_costs_for_brand(uuid, boolean) TO authenticated, service_role;
