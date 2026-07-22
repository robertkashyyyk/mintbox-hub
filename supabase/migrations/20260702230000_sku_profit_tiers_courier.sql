-- Add avg_courier to get_sku_profit_tiers so the Buy-Recs "Raise to tier" action
-- can back-solve the target price with each SKU's OWN courier cost (from its recent
-- sales) instead of bandRecoveryTarget's flat DEFAULT_COURIER_UNIT fallback. Flat
-- courier fees mis-price cheap/heavy items badly — never assume one. Per-unit
-- courier = courier_cost / qty, averaged over the SKU's last <=8 costed sales; null
-- when there's no costed sale (the UI then skips the SKU rather than guess a fee).
DROP FUNCTION IF EXISTS public.get_sku_profit_tiers(text[]);
CREATE OR REPLACE FUNCTION public.get_sku_profit_tiers(p_skus text[])
RETURNS TABLE(sku text, blended_por numeric, band text, sample_size integer, last_sold date, avg_courier numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH lines AS (
    SELECT regexp_replace(oe.sku,'-Q[0-9]+$','') AS base_sku,
           oe.order_value, oe.profit, oe.order_date,
           CASE WHEN oe.qty > 0 THEN oe.courier_cost / oe.qty ELSE NULL END AS courier_unit,
           row_number() OVER (PARTITION BY regexp_replace(oe.sku,'-Q[0-9]+$','')
                              ORDER BY oe.order_date DESC) AS rn
    FROM order_economics_all oe
    WHERE regexp_replace(oe.sku,'-Q[0-9]+$','') = ANY(p_skus)
      AND NOT oe.missing_cost
  ),
  agg AS (
    SELECT base_sku, count(*)::int AS sample_size, max(order_date)::date AS last_sold,
           CASE WHEN sum(order_value) > 0 THEN round(sum(profit)/sum(order_value)*100, 1) END AS blended_por,
           round(avg(courier_unit) FILTER (WHERE courier_unit IS NOT NULL)::numeric, 2) AS avg_courier
    FROM lines WHERE rn <= 8 GROUP BY base_sku
  )
  SELECT a.base_sku, a.blended_por,
    CASE
      WHEN a.blended_por IS NULL     THEN 'unknown'
      WHEN a.blended_por <= -1.0     THEN 'loss'
      WHEN a.blended_por <= 1.0      THEN 'breakeven'
      WHEN a.blended_por <= 9.99     THEN 'poor'
      WHEN a.blended_por <= 19.99    THEN 'average'
      WHEN a.blended_por <= 24.99    THEN 'good'
      WHEN a.blended_por <= 29.99    THEN 'great'
      WHEN a.blended_por <= 49.99    THEN 'amazing'
      ELSE 'stellar' END AS band,
    a.sample_size, a.last_sold, a.avg_courier
  FROM agg a;
$$;
REVOKE ALL ON FUNCTION public.get_sku_profit_tiers(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sku_profit_tiers(text[]) TO authenticated, service_role;
