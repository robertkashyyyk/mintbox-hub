-- ROLLBACK for 20261013171000_esagu_guards_read_lean_mv.sql
-- Verbatim prod definitions captured 2026-10-13 before the guards were moved onto
-- amazon.mv_esagu_item_lean. Re-run to restore (they read amazon.esagu_item directly).

CREATE OR REPLACE FUNCTION public.esagu_costfloor_targets()
 RETURNS TABLE(item_id bigint, fba boolean, cost numeric, fulfil numeric, floor_gbp numeric, cur_min numeric, cur_max numeric, amazon_price numeric, ext_market numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'amazon'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((SELECT (value#>>'{}')::numeric FROM public.app_settings WHERE key='product_vat_rate'), 0.20) AS vat,
      (SELECT fee_pct FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS fee,
      COALESCE((SELECT (value->>'fbm_fulfil')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),2.65) AS fbm_fulfil,
      COALESCE((SELECT (value->>'fba_fulfil')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),3.97) AS fba_fulfil,
      COALESCE((SELECT (value->>'margin_pct')::numeric FROM public.app_settings WHERE key='esagu_costfloor'),0) AS margin_pct
  ),
  base AS (
    SELECT e.esagu_item_id, e.fba, pc.cost_price AS cost, e.min_price AS cur_min, e.max_price AS cur_max, e.amazon_price,
           CASE WHEN e.fba THEN c.fba_fulfil ELSE c.fbm_fulfil END AS fulfil,
           (1.0/(1+c.vat) - c.fee - c.margin_pct) AS denom,
           (SELECT min((o->>'price')::numeric) FROM jsonb_array_elements(e.offers) o
            WHERE o->>'seller' <> 'A18KNZ0ID7MNQY' AND jsonb_array_length(COALESCE(o->'excl','[]'::jsonb))=0 AND NULLIF(o->>'price','') IS NOT NULL) AS ext_market
    FROM amazon.esagu_item e
    JOIN public.products_cache pc ON pc.sku = e.catalogue_sku
    CROSS JOIN cfg c
    WHERE e.catalogue_sku IS NOT NULL AND pc.cost_price > 0 AND e.mode='OPTIMIZATION'
      AND NOT public.is_amazon_clearance_sku(e.catalogue_sku)
  )
  SELECT esagu_item_id, fba, cost, fulfil,
         round((cost + fulfil)/NULLIF(denom,0),2) AS floor_gbp,
         cur_min, cur_max, amazon_price, ext_market
  FROM base
  WHERE denom > 0
    AND round((cost + fulfil)/NULLIF(denom,0),2) > COALESCE(cur_min,0) + 0.05
$function$;

CREATE OR REPLACE FUNCTION public.esagu_guard_targets()
 RETURNS TABLE(fba_item_id bigint, target_maxprice numeric, fba_min numeric, ext_market numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'amazon'
AS $function$
  WITH sib AS (
    SELECT asin, min(amazon_price) AS fbm FROM amazon.esagu_item
    WHERE NOT fba AND amazon_price IS NOT NULL GROUP BY asin
  )
  SELECT f.esagu_item_id, s.fbm, f.min_price, ext.ext_market
  FROM amazon.esagu_item f
  JOIN sib s ON s.asin = f.asin
  LEFT JOIN LATERAL (
    SELECT min((o->>'price')::numeric) AS ext_market
    FROM jsonb_array_elements(f.offers) o
    WHERE o->>'seller' <> 'A18KNZ0ID7MNQY'
      AND jsonb_array_length(COALESCE(o->'excl','[]'::jsonb)) = 0
      AND NULLIF(o->>'price','') IS NOT NULL
  ) ext ON true
  WHERE f.fba AND f.mode='OPTIMIZATION' AND COALESCE(f.quantity,0)>0 AND f.min_price IS NOT NULL
    AND f.amazon_price > s.fbm + 0.01
    AND s.fbm >= f.min_price
    AND f.max_price IS DISTINCT FROM s.fbm
    AND ext.ext_market IS NOT NULL
    AND s.fbm >= ext.ext_market * 0.90
    AND NOT public.is_amazon_clearance_sku(f.catalogue_sku)
$function$;

CREATE OR REPLACE FUNCTION public.esagu_margin_targets()
 RETURNS TABLE(item_id bigint, new_max numeric, old_max numeric, ext_market numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'amazon'
AS $function$
  WITH x AS (
    SELECT e.esagu_item_id, e.amazon_price, e.max_price,
      (SELECT min((o->>'price')::numeric) FROM jsonb_array_elements(e.offers) o
       WHERE o->>'seller' <> 'A18KNZ0ID7MNQY' AND jsonb_array_length(COALESCE(o->'excl','[]'::jsonb))=0 AND NULLIF(o->>'price','') IS NOT NULL) AS ext_market
    FROM amazon.esagu_item e
    WHERE e.mode='OPTIMIZATION' AND NOT e.fba AND e.amazon_price IS NOT NULL
      AND NOT public.is_amazon_clearance_sku(e.catalogue_sku)
  )
  SELECT esagu_item_id, round(LEAST(ext_market*0.98, amazon_price*1.20),2), max_price, ext_market
  FROM x
  WHERE ext_market IS NOT NULL AND max_price < ext_market*0.97 AND amazon_price >= max_price-0.02
    AND round(LEAST(ext_market*0.98, amazon_price*1.20),2) > max_price + 0.05
$function$;
