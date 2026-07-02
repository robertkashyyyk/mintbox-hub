-- ============================================================================
-- Cost-based floor: eSagu min_price must cover cost + Amazon referral + VAT +
-- fulfilment, so eSagu can never sell below cost. Config-driven; ring-fenced from
-- Amazon clearance (a liquidation intentionally sells below cost). Break-even
-- inc-VAT floor: P = (cost + fulfil) / (1/(1+vat) - fee - margin_pct).
-- Driven by esagu-costfloor-guard edge fn (RAISE-only on min, bumps max just above
-- floor since eSagu requires min<max). (Applied to remote DB via MCP 2026-07-02.)
-- ============================================================================
INSERT INTO public.app_settings(key, value)
VALUES ('esagu_costfloor', jsonb_build_object('fbm_fulfil',2.65,'fba_fulfil',3.97,'margin_pct',0,'note','fulfilment grounded in 90d realized Amazon courier/FBA medians; margin_pct=0 => pure break-even'))
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.esagu_costfloor_targets()
 RETURNS TABLE(item_id bigint, fba boolean, cost numeric, fulfil numeric, floor_gbp numeric,
               cur_min numeric, cur_max numeric, amazon_price numeric, ext_market numeric)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH cfg AS (
    SELECT
      (SELECT vat_rate FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS vat,
      (SELECT fee_pct  FROM public.channel_fee_rules WHERE name='Amazon' AND active ORDER BY priority LIMIT 1) AS fee,
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

CREATE OR REPLACE FUNCTION public.amazon_esagu_costfloor_log(p_changed integer, p_detail jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
DECLARE v_conn uuid := amazon._ensure_connection('A1F83G8C2ARO7P');
BEGIN
  INSERT INTO amazon.sync_run (connection_id, object, mode, status, rows_upserted, next_cursor, finished_at)
  VALUES (v_conn, 'esagu_costfloor_guard', 'incremental', 'success', p_changed, p_detail, now());
END; $function$;
