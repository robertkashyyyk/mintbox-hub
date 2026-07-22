-- Per-SKU "last known" profitability tier for the Buy Recommendations page (and
-- reusable elsewhere). Blended POR = sum(profit)/sum(revenue) over each SKU's last
-- up to 8 costed sales (value-weighted, robust to single-order noise), from
-- order_economics_all (all channels incl. Amazon FBA). Computed on demand for the
-- passed SKU list only — bounded + always fresh, no matview/cron. Bands match
-- src/lib/reprice.ts (POR%: loss<=-1, breakeven<=1, poor<=9.99, average<=19.99,
-- good<=24.99, great<=29.99, amazing<=49.99, else stellar).
CREATE OR REPLACE FUNCTION public.get_sku_profit_tiers(p_skus text[])
RETURNS TABLE(sku text, blended_por numeric, band text, sample_size integer, last_sold date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH lines AS (
    SELECT regexp_replace(oe.sku,'-Q[0-9]+$','') AS base_sku,
           oe.order_value, oe.profit, oe.order_date,
           row_number() OVER (PARTITION BY regexp_replace(oe.sku,'-Q[0-9]+$','')
                              ORDER BY oe.order_date DESC) AS rn
    FROM order_economics_all oe
    WHERE regexp_replace(oe.sku,'-Q[0-9]+$','') = ANY(p_skus)
      AND NOT oe.missing_cost
  ),
  agg AS (
    SELECT base_sku, count(*)::int AS sample_size, max(order_date)::date AS last_sold,
           CASE WHEN sum(order_value) > 0 THEN round(sum(profit)/sum(order_value)*100, 1) END AS blended_por
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
    a.sample_size, a.last_sold
  FROM agg a;
$$;
REVOKE ALL ON FUNCTION public.get_sku_profit_tiers(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sku_profit_tiers(text[]) TO authenticated, service_role;
