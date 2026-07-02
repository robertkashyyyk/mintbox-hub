-- ============================================================================
-- Amazon repricing overview for the Reprice page (Amazon channel). Amazon reprices
-- autonomously via eSagu, so this is a READ/monitoring surface: a worklist of items
-- needing attention + headline counts. No manual push (that would race eSagu).
-- (Applied to remote DB via MCP 2026-07-02.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_amazon_reprice_overview(p_limit int DEFAULT 300)
 RETURNS TABLE(esagu_item_id bigint, sku text, asin text, fba boolean,
               amazon_price numeric, min_price numeric, max_price numeric,
               buy_box_seller text, we_hold_box boolean, competable_price numeric,
               cost_floor numeric, status text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH x AS (
    SELECT e.esagu_item_id, e.catalogue_sku AS sku, e.asin, e.fba,
           e.amazon_price, e.min_price, e.max_price, e.buy_box_seller,
           (e.buy_box_seller='A18KNZ0ID7MNQY') AS we_hold_box, e.competable_price, e.quantity,
           CASE WHEN pc.cost_price>0 THEN public.esagu_break_even_floor(pc.cost_price, e.fba) END AS cost_floor
    FROM amazon.esagu_item e
    LEFT JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    WHERE e.mode='OPTIMIZATION' AND e.amazon_price IS NOT NULL
  ),
  s AS (
    SELECT x.*,
      CASE
        WHEN cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01 THEN 'below_floor'
        WHEN fba AND cost_floor IS NOT NULL AND competable_price IS NOT NULL
             AND cost_floor > competable_price AND COALESCE(quantity,0)>0 THEN 'stuck_fba'
        WHEN buy_box_seller IS NOT NULL AND NOT we_hold_box THEN 'losing_box'
        WHEN NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL
             AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02 THEN 'margin_headroom'
        ELSE 'ok'
      END AS status
    FROM x
  )
  SELECT esagu_item_id, sku, asin, fba, amazon_price, min_price, max_price,
         buy_box_seller, we_hold_box, competable_price, cost_floor, status
  FROM s WHERE status <> 'ok'
  ORDER BY CASE status WHEN 'below_floor' THEN 1 WHEN 'stuck_fba' THEN 2
                       WHEN 'losing_box' THEN 3 WHEN 'margin_headroom' THEN 4 ELSE 5 END,
           (COALESCE(competable_price,0) - COALESCE(amazon_price,0)) DESC
  LIMIT p_limit
$function$;

CREATE OR REPLACE FUNCTION public.get_amazon_reprice_summary()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH x AS (
    SELECT e.esagu_item_id, e.fba, e.amazon_price, e.max_price, e.competable_price, e.quantity,
           (e.buy_box_seller='A18KNZ0ID7MNQY') AS we_hold_box, e.buy_box_seller,
           CASE WHEN pc.cost_price>0 THEN public.esagu_break_even_floor(pc.cost_price, e.fba) END AS cost_floor
    FROM amazon.esagu_item e
    LEFT JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    WHERE e.mode='OPTIMIZATION' AND e.amazon_price IS NOT NULL
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'we_hold_box', count(*) FILTER (WHERE we_hold_box),
    'below_floor', count(*) FILTER (WHERE cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01),
    'stuck_fba', count(*) FILTER (WHERE fba AND cost_floor IS NOT NULL AND competable_price IS NOT NULL AND cost_floor > competable_price AND COALESCE(quantity,0)>0),
    'losing_box', count(*) FILTER (WHERE buy_box_seller IS NOT NULL AND NOT we_hold_box),
    'margin_headroom', count(*) FILTER (WHERE NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02)
  ) FROM x
$function$;

GRANT EXECUTE ON FUNCTION public.get_amazon_reprice_overview(int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_amazon_reprice_summary() TO anon, authenticated;
