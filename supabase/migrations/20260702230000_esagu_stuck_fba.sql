-- ============================================================================
-- Stuck-FBA detector + auto-exclude. FBA items with stock whose break-even floor
-- sits ABOVE market can't sell profitably -> they eat FBA storage. Feature:
--   1. detect  (esagu_stuck_fba_candidates)
--   2. blow out via Amazon clearance  (handed to the Sale/Liquidation system)
--   3. never recommend for FBA again  (esagu_exclude_stuck_fba -> fba_switch_exclusions)
-- Cron: 'esagu-exclude-stuck-fba-weekly' (Sun 05:00) keeps the exclusion list current.
-- (Applied to remote DB via MCP 2026-07-02.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.esagu_break_even_floor(p_cost numeric, p_fba boolean)
 RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT round((p_cost + CASE WHEN p_fba THEN c.fba_fulfil ELSE c.fbm_fulfil END)
               / NULLIF(1.0/(1+c.vat) - c.fee - c.margin_pct, 0), 2)
  FROM (
    SELECT (SELECT vat_rate FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS vat,
           (SELECT fee_pct  FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS fee,
           COALESCE((SELECT (value->>'fbm_fulfil')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),2.65) AS fbm_fulfil,
           COALESCE((SELECT (value->>'fba_fulfil')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),3.97) AS fba_fulfil,
           COALESCE((SELECT (value->>'margin_pct')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),0) AS margin_pct
  ) c
$function$;

CREATE OR REPLACE FUNCTION public.esagu_stuck_fba_candidates()
 RETURNS TABLE(esagu_item_id bigint, sku text, asin text, cost numeric, floor_gbp numeric, market numeric, amazon_price numeric, qty int)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH x AS (
    SELECT e.esagu_item_id, e.catalogue_sku AS sku, e.asin, pc.cost_price AS cost, e.amazon_price, e.quantity AS qty,
           public.esagu_break_even_floor(pc.cost_price, true) AS floor_gbp,
           (SELECT min((o->>'price')::numeric) FROM jsonb_array_elements(e.offers) o
            WHERE o->>'seller' <> 'A18KNZ0ID7MNQY' AND jsonb_array_length(COALESCE(o->'excl','[]'::jsonb))=0 AND NULLIF(o->>'price','') IS NOT NULL) AS market
    FROM amazon.esagu_item e
    JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    WHERE e.fba AND pc.cost_price > 0 AND COALESCE(e.quantity,0) > 0
  )
  SELECT esagu_item_id, sku, asin, cost, floor_gbp, market, amazon_price, qty
  FROM x WHERE market IS NOT NULL AND floor_gbp > market
$function$;

CREATE OR REPLACE FUNCTION public.esagu_exclude_stuck_fba()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH ins AS (
    INSERT INTO amazon.fba_switch_exclusions (sku, reason, note)
    SELECT DISTINCT c.sku, 'floored_unsellable_fba',
           'auto: break-even floor '||c.floor_gbp||' > market '||c.market||' (eats FBA storage)'
    FROM public.esagu_stuck_fba_candidates() c
    WHERE c.sku IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM amazon.fba_switch_exclusions x WHERE x.sku = c.sku)
    RETURNING 1
  )
  SELECT count(*)::int FROM ins;
$function$;

GRANT EXECUTE ON FUNCTION public.esagu_stuck_fba_candidates() TO authenticated, service_role;
