-- ============================================================================
-- Refined stuck + headroom logic (from real-item testing):
--  • stuck_fba ONLY when (a) Amazon's own offer (A3P5ROKL5A1OLE) sits below our floor
--    and dominates the box, OR (b) there is NO beatable competitor priced at/above our
--    floor to slot beneath (we'd be the most expensive → won't sell). A ladder of
--    competitors above the floor means we can sell → NOT stuck (fixes B00365XYQI,
--    B000WZABDO false positives).
--  • margin_headroom no longer suppressed when Amazon undercuts — if a real competitor
--    sits above us, raise toward them for margin even though Amazon holds the box
--    (fixes B000CSD6SS FBM, B000WJKOTQ FBM).
-- "beatable competitor" = offer not ours (A18KNZ0ID7MNQY), not Amazon (A3P5ROKL5A1OLE),
-- not eSagu-excluded. (Applied to remote DB via MCP 2026-07-02.)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_amazon_reprice_overview(int, numeric);
CREATE OR REPLACE FUNCTION public.get_amazon_reprice_overview(p_limit int DEFAULT 300, p_target_por numeric DEFAULT NULL)
 RETURNS TABLE(esagu_item_id bigint, sku text, asin text, fba boolean,
               amazon_price numeric, min_price numeric, max_price numeric,
               buy_box_seller text, we_hold_box boolean, competable_price numeric, amazon_own numeric,
               cost numeric, cost_floor numeric, current_por numeric, target_price numeric,
               never_fba boolean, status text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH cfg AS (
    SELECT (SELECT vat_rate FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS vat,
           (SELECT fee_pct  FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS fee,
           COALESCE((SELECT (value->>'fbm_fulfil')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),2.65) AS fbm_fulfil,
           COALESCE((SELECT (value->>'fba_fulfil')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),3.97) AS fba_fulfil
  ),
  x AS (
    SELECT e.esagu_item_id, e.catalogue_sku AS sku, e.asin, e.fba,
           e.amazon_price, e.min_price, e.max_price, e.buy_box_seller,
           (e.buy_box_seller='A18KNZ0ID7MNQY') AS we_hold_box, e.competable_price, e.quantity, e.offers,
           (SELECT min((o->>'price')::numeric) FROM jsonb_array_elements(e.offers) o
            WHERE o->>'seller'='A3P5ROKL5A1OLE' AND NULLIF(o->>'price','') IS NOT NULL) AS amazon_own,
           pc.cost_price AS cost,
           CASE WHEN e.fba THEN c.fba_fulfil ELSE c.fbm_fulfil END AS fulfil,
           (1.0/(1+c.vat) - c.fee) AS keep_rate,
           EXISTS (SELECT 1 FROM amazon.fba_switch_exclusions fx WHERE fx.sku = e.catalogue_sku) AS never_fba
    FROM amazon.esagu_item e
    LEFT JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    CROSS JOIN cfg c
    WHERE e.mode='OPTIMIZATION' AND e.amazon_price IS NOT NULL
      AND NOT public.is_amazon_clearance_sku(e.catalogue_sku)
      AND NOT (e.fba AND COALESCE(e.quantity,0)=0)
  ),
  s AS (
    SELECT x.*,
      CASE WHEN cost>0 THEN round((cost+fulfil)/NULLIF(keep_rate,0),2) END AS cost_floor,
      CASE WHEN cost>0 AND amazon_price>0 THEN round(keep_rate - (cost+fulfil)/amazon_price, 4) END AS current_por,
      CASE WHEN cost>0 AND p_target_por IS NOT NULL AND (keep_rate - p_target_por) > 0
           THEN round((cost+fulfil)/(keep_rate - p_target_por), 2) END AS target_price
    FROM x
  ),
  h AS (
    SELECT s.*,
      (cost_floor IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(offers) o
        WHERE o->>'seller' NOT IN ('A18KNZ0ID7MNQY','A3P5ROKL5A1OLE')
          AND jsonb_array_length(COALESCE(o->'excl','[]'::jsonb))=0
          AND NULLIF(o->>'price','') IS NOT NULL
          AND (o->>'price')::numeric >= cost_floor
      )) AS has_headroom_comp
    FROM s
  ),
  s2 AS (
    SELECT h.*,
      CASE
        WHEN fba AND COALESCE(quantity,0)>0 AND cost_floor IS NOT NULL
             AND ((amazon_own IS NOT NULL AND amazon_own < cost_floor) OR NOT has_headroom_comp) THEN 'stuck_fba'
        WHEN cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01 THEN 'below_floor'
        WHEN buy_box_seller IS NOT NULL AND NOT we_hold_box THEN 'losing_box'
        WHEN NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL
             AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02 THEN 'margin_headroom'
        ELSE 'ok'
      END AS status
    FROM h
  )
  SELECT esagu_item_id, sku, asin, fba, amazon_price, min_price, max_price, buy_box_seller, we_hold_box, competable_price, amazon_own,
         cost, cost_floor, current_por, target_price, never_fba, status
  FROM s2 WHERE status <> 'ok'
  ORDER BY CASE status WHEN 'stuck_fba' THEN 1 WHEN 'below_floor' THEN 2 WHEN 'losing_box' THEN 3 WHEN 'margin_headroom' THEN 4 ELSE 5 END,
           (COALESCE(competable_price,0) - COALESCE(amazon_price,0)) DESC
  LIMIT p_limit
$function$;
GRANT EXECUTE ON FUNCTION public.get_amazon_reprice_overview(int, numeric) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_amazon_reprice_summary()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH x AS (
    SELECT e.esagu_item_id, e.fba, e.amazon_price, e.max_price, e.competable_price, e.quantity, e.offers,
           (e.buy_box_seller='A18KNZ0ID7MNQY') AS we_hold_box, e.buy_box_seller,
           (SELECT min((o->>'price')::numeric) FROM jsonb_array_elements(e.offers) o
            WHERE o->>'seller'='A3P5ROKL5A1OLE' AND NULLIF(o->>'price','') IS NOT NULL) AS amazon_own,
           CASE WHEN pc.cost_price>0 THEN public.esagu_break_even_floor(pc.cost_price, e.fba) END AS cost_floor
    FROM amazon.esagu_item e
    LEFT JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    WHERE e.mode='OPTIMIZATION' AND e.amazon_price IS NOT NULL
      AND NOT (e.fba AND COALESCE(e.quantity,0)=0)
  ),
  y AS (
    SELECT *,
      (fba AND COALESCE(quantity,0)>0 AND cost_floor IS NOT NULL AND (
        (amazon_own IS NOT NULL AND amazon_own < cost_floor)
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(offers) o
          WHERE o->>'seller' NOT IN ('A18KNZ0ID7MNQY','A3P5ROKL5A1OLE')
            AND jsonb_array_length(COALESCE(o->'excl','[]'::jsonb))=0
            AND NULLIF(o->>'price','') IS NOT NULL AND (o->>'price')::numeric >= cost_floor)
      )) AS is_stuck
    FROM x
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'we_hold_box', count(*) FILTER (WHERE we_hold_box),
    'stuck_fba', count(*) FILTER (WHERE is_stuck),
    'below_floor', count(*) FILTER (WHERE cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01 AND NOT is_stuck),
    'losing_box', count(*) FILTER (WHERE buy_box_seller IS NOT NULL AND NOT we_hold_box),
    'margin_headroom', count(*) FILTER (WHERE NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02)
  ) FROM y
$function$;
