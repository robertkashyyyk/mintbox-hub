-- ============================================================================
-- Amazon-aware worklist fixes:
--  1. Drop 0-stock FBA offers (nothing to sell — was noise, e.g. B000WJKOTQ).
--  2. Surface Amazon's OWN retail price (seller A3P5ROKL5A1OLE = Amazon UK). eSagu
--     excludes it from its reprice competition set, but it really caps what we can
--     win — so we show it and judge against it.
--  3. Judge "stuck in FBA" against the REAL cheapest box-winner = LEAST(domestic
--     competable, Amazon's own). Catches items the Amazon-free "market" missed
--     (e.g. B000GZFFJU: floor £8.55, market £13.94, but Amazon £3.28 → stuck).
--  4. stuck_fba takes priority over below_floor (raising the floor on an Amazon-
--     undercut FBA item just loses the box — the action is blow-out, not floor).
--  5. Suppress false margin_headroom when Amazon undercuts us.
-- competable_price stays Amazon-free (eSagu's reprice reference); amazon_own is the
-- extra truth column. (Applied to remote DB via MCP 2026-07-02.)
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
           (e.buy_box_seller='A18KNZ0ID7MNQY') AS we_hold_box, e.competable_price, e.quantity,
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
      LEAST(competable_price, amazon_own) AS effective_low,
      CASE WHEN cost>0 THEN round((cost+fulfil)/NULLIF(keep_rate,0),2) END AS cost_floor,
      CASE WHEN cost>0 AND amazon_price>0 THEN round(keep_rate - (cost+fulfil)/amazon_price, 4) END AS current_por,
      CASE WHEN cost>0 AND p_target_por IS NOT NULL AND (keep_rate - p_target_por) > 0
           THEN round((cost+fulfil)/(keep_rate - p_target_por), 2) END AS target_price
    FROM x
  ),
  s2 AS (
    SELECT s.*,
      CASE
        WHEN fba AND cost_floor IS NOT NULL AND effective_low IS NOT NULL AND cost_floor > effective_low AND COALESCE(quantity,0)>0 THEN 'stuck_fba'
        WHEN cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01 THEN 'below_floor'
        WHEN buy_box_seller IS NOT NULL AND NOT we_hold_box THEN 'losing_box'
        WHEN NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL
             AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02
             AND (amazon_own IS NULL OR amazon_own >= amazon_price) THEN 'margin_headroom'
        ELSE 'ok'
      END AS status
    FROM s
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
    SELECT e.esagu_item_id, e.fba, e.amazon_price, e.max_price, e.competable_price, e.quantity,
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
    SELECT *, (fba AND cost_floor IS NOT NULL AND LEAST(competable_price, amazon_own) IS NOT NULL
               AND cost_floor > LEAST(competable_price, amazon_own) AND COALESCE(quantity,0)>0) AS is_stuck
    FROM x
  )
  SELECT jsonb_build_object(
    'total', count(*),
    'we_hold_box', count(*) FILTER (WHERE we_hold_box),
    'stuck_fba', count(*) FILTER (WHERE is_stuck),
    'below_floor', count(*) FILTER (WHERE cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01 AND NOT is_stuck),
    'losing_box', count(*) FILTER (WHERE buy_box_seller IS NOT NULL AND NOT we_hold_box),
    'margin_headroom', count(*) FILTER (WHERE NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02 AND (amazon_own IS NULL OR amazon_own >= amazon_price))
  ) FROM y
$function$;
