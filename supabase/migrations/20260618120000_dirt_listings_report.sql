-- Layer B (flag): "Dirt SKUs live on eBay" report.
-- Each row in threeds_sku_aliases is a live eBay listing whose custom label is an
-- old dirt code that Mintsoft maps to a true SKU. This RPC enriches each with the
-- store, eBay item id, recent sales, and the true product, so we can surface them
-- in Housekeeping (and later push label corrections to 3D).

CREATE OR REPLACE FUNCTION public.get_dirt_listings()
 RETURNS TABLE(
   dirt_sku text, true_sku text, store_name text, external_item_id text,
   units_90d bigint, revenue_90d numeric, last_sold timestamptz,
   true_name text, true_cost numeric, true_stock numeric, needs_review boolean
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH tx AS (
    SELECT t.sku AS dirt_sku,
           COALESCE(t.store_name, t.store_url) AS store_name,
           (array_agg(t.external_item_id ORDER BY t.order_date DESC))[1] AS external_item_id,
           COALESCE(SUM(t.quantity) FILTER (WHERE t.order_date >= now() - interval '90 days'), 0)::bigint AS units_90d,
           COALESCE(SUM(t.price)    FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS revenue_90d,
           MAX(t.order_date) AS last_sold
    FROM public.threeds_order_transactions t
    JOIN public.threeds_sku_aliases a ON a.dirt_sku = t.sku
    GROUP BY 1, 2
  )
  SELECT tx.dirt_sku, a.true_sku, tx.store_name, tx.external_item_id,
         tx.units_90d, ROUND(tx.revenue_90d::numeric, 2) AS revenue_90d, tx.last_sold,
         pc.name AS true_name, pc.cost_price AS true_cost, pc.current_stock AS true_stock,
         a.needs_review
  FROM tx
  JOIN public.threeds_sku_aliases a ON a.dirt_sku = tx.dirt_sku
  LEFT JOIN public.products_cache pc ON pc.sku = a.true_sku
  ORDER BY tx.revenue_90d DESC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.get_dirt_listings() TO authenticated;
