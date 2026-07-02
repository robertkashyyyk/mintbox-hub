-- ============================================================================
-- Amazon worklist blow-out: stuck-FBA rows can be blown out (Amazon-scoped
-- liquidation campaign via the Clearance system + esagu-clearance) and flagged
-- never-FBA from the worklist. Adds amazon_flag_never_fba(sku) and extends
-- get_amazon_reprice_overview to (a) hide SKUs already on Amazon clearance and
-- (b) return never_fba. (Applied to remote DB via MCP 2026-07-02.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.amazon_flag_never_fba(p_sku text, p_note text DEFAULT NULL)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
DECLARE v_rows int;
BEGIN
  INSERT INTO amazon.fba_switch_exclusions (sku, reason, note, excluded_by)
  SELECT p_sku, 'floored_unsellable_fba', COALESCE(p_note, 'manual blow-out from Amazon worklist'), auth.uid()
  WHERE p_sku IS NOT NULL AND NOT EXISTS (SELECT 1 FROM amazon.fba_switch_exclusions x WHERE x.sku = p_sku);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END; $function$;
GRANT EXECUTE ON FUNCTION public.amazon_flag_never_fba(text, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_amazon_reprice_overview(int, numeric);
CREATE OR REPLACE FUNCTION public.get_amazon_reprice_overview(p_limit int DEFAULT 300, p_target_por numeric DEFAULT NULL)
 RETURNS TABLE(esagu_item_id bigint, sku text, asin text, fba boolean,
               amazon_price numeric, min_price numeric, max_price numeric,
               buy_box_seller text, we_hold_box boolean, competable_price numeric,
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
           pc.cost_price AS cost,
           CASE WHEN e.fba THEN c.fba_fulfil ELSE c.fbm_fulfil END AS fulfil,
           (1.0/(1+c.vat) - c.fee) AS keep_rate,
           EXISTS (SELECT 1 FROM amazon.fba_switch_exclusions fx WHERE fx.sku = e.catalogue_sku) AS never_fba
    FROM amazon.esagu_item e
    LEFT JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    CROSS JOIN cfg c
    WHERE e.mode='OPTIMIZATION' AND e.amazon_price IS NOT NULL
      AND NOT public.is_amazon_clearance_sku(e.catalogue_sku)
  ),
  s AS (
    SELECT x.*,
      CASE WHEN cost>0 THEN round((cost+fulfil)/NULLIF(keep_rate,0),2) END AS cost_floor,
      CASE WHEN cost>0 AND amazon_price>0 THEN round(keep_rate - (cost+fulfil)/amazon_price, 4) END AS current_por,
      CASE WHEN cost>0 AND p_target_por IS NOT NULL AND (keep_rate - p_target_por) > 0
           THEN round((cost+fulfil)/(keep_rate - p_target_por), 2) END AS target_price
    FROM x
  ),
  s2 AS (
    SELECT s.*,
      CASE
        WHEN cost_floor IS NOT NULL AND amazon_price < cost_floor - 0.01 THEN 'below_floor'
        WHEN fba AND cost_floor IS NOT NULL AND competable_price IS NOT NULL AND cost_floor > competable_price AND COALESCE(quantity,0)>0 THEN 'stuck_fba'
        WHEN buy_box_seller IS NOT NULL AND NOT we_hold_box THEN 'losing_box'
        WHEN NOT fba AND max_price IS NOT NULL AND competable_price IS NOT NULL AND max_price < competable_price*0.97 AND amazon_price >= max_price-0.02 THEN 'margin_headroom'
        ELSE 'ok'
      END AS status
    FROM s
  )
  SELECT esagu_item_id, sku, asin, fba, amazon_price, min_price, max_price, buy_box_seller, we_hold_box, competable_price,
         cost, cost_floor, current_por, target_price, never_fba, status
  FROM s2 WHERE status <> 'ok'
  ORDER BY CASE status WHEN 'below_floor' THEN 1 WHEN 'stuck_fba' THEN 2 WHEN 'losing_box' THEN 3 WHEN 'margin_headroom' THEN 4 ELSE 5 END,
           (COALESCE(competable_price,0) - COALESCE(amazon_price,0)) DESC
  LIMIT p_limit
$function$;
GRANT EXECUTE ON FUNCTION public.get_amazon_reprice_overview(int, numeric) TO anon, authenticated;
