CREATE OR REPLACE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
 RETURNS TABLE(sku text, product_name text, brand_name text, units_sold bigint, revenue numeric, cost_total numeric, fees_total numeric, courier_total numeric, profit numeric, por_pct numeric, current_price numeric, current_stock numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT
      ole.sku,
      MAX(ole.product_name) AS product_name,
      (array_agg(ole.brand_id ORDER BY ole.order_date DESC))[1] AS brand_id,
      SUM(ole.qty)::bigint  AS units_sold,
      SUM(ole.order_value)  AS revenue,
      SUM(ole.cost_each * ole.qty) AS cost_total,
      SUM(ole.channel_fee)  AS fees_total,
      SUM(ole.courier_cost) AS courier_total,
      SUM(ole.profit)       AS profit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - make_interval(days => p_days)
      AND ole.order_date >= '2026-01-01'::timestamptz
    GROUP BY ole.sku
  ),
  latest_price AS (
    SELECT DISTINCT ON (ole.sku)
      ole.sku,
      ole.price
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - make_interval(days => p_days)
      AND ole.price IS NOT NULL
      AND ole.price > 0
    ORDER BY ole.sku, ole.order_date DESC
  )
  SELECT
    a.sku,
    COALESCE(pc.name, a.product_name) AS product_name,
    b.name AS brand_name,
    a.units_sold,
    ROUND(a.revenue::numeric, 2)        AS revenue,
    ROUND(a.cost_total::numeric, 2)     AS cost_total,
    ROUND(a.fees_total::numeric, 2)     AS fees_total,
    ROUND(a.courier_total::numeric, 2)  AS courier_total,
    ROUND(a.profit::numeric, 2)         AS profit,
    CASE WHEN a.revenue > 0
      THEN ROUND((a.profit / (a.revenue * 1.2) * 100)::numeric, 2)
      ELSE NULL END AS por_pct,
    ROUND(lp.price::numeric, 2) AS current_price,
    pc.current_stock
  FROM agg a
  LEFT JOIN latest_price lp ON lp.sku = a.sku
  LEFT JOIN public.products_cache pc ON pc.sku = a.sku
  LEFT JOIN public.brands b ON b.id = COALESCE(pc.brand_id, a.brand_id)
  ORDER BY a.profit ASC NULLS LAST;
$function$;