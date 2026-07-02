-- ============================================================================
-- Ring-fence the eSagu price-RAISING levers (margin recovery, FBA guard) from
-- Amazon clearance: never raise a price on a SKU we're deliberately clearing down.
-- Channel-aware — only active 'sale'/'liquidation' campaigns scoped to Amazon fire
-- (price_campaigns.channels @> {amazon}); an eBay-only clearance leaves the Amazon
-- price free to optimise. Complements the LSA/buy-recs clearance ring-fences the
-- Sale/Liquidation side built (20260702120000 / 120100) — those protect the eBay/LSA
-- lane; THIS protects the eSagu lane. (Applied to remote DB via MCP 2026-07-02.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_amazon_clearance_sku(p_sku text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT p_sku IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.price_campaigns c
    WHERE c.sku = p_sku AND c.status='active'
      AND c.type IN ('sale','liquidation')
      AND c.channels @> ARRAY['amazon']::text[]
  );
$function$;

CREATE OR REPLACE FUNCTION public.esagu_margin_targets()
 RETURNS TABLE(item_id bigint, new_max numeric, old_max numeric, ext_market numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
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

CREATE OR REPLACE FUNCTION public.esagu_guard_targets()
 RETURNS TABLE(fba_item_id bigint, target_maxprice numeric, fba_min numeric, ext_market numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'amazon'
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
