-- Decouple product (output) VAT from the fee rule's vat_rate in the Amazon cost-floor.
-- The fee-ex-VAT change set channel_fee_rules.vat_rate=0 (correct: fee VAT is reclaimable),
-- but esagu_costfloor_targets used that column as PRODUCT VAT in 1/(1+vat), collapsing the
-- break-even denominator from ~0.683 to ~0.85 and dropping Amazon floors ~20%. Read product
-- VAT from app_settings.product_vat_rate (default 0.20) instead. (reprice.ts fixed in the same PR.)
-- Applied live via MCP 2026-10-05; committed here for repo record.
insert into app_settings (key, value)
values ('product_vat_rate', to_jsonb(0.20::numeric))
on conflict (key) do nothing;

create or replace function public.esagu_costfloor_targets()
 returns table(item_id bigint, fba boolean, cost numeric, fulfil numeric, floor_gbp numeric, cur_min numeric, cur_max numeric, amazon_price numeric, ext_market numeric)
 language sql stable security definer set search_path to 'public','amazon'
as $function$
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
