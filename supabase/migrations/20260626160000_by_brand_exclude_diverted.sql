-- Keep get_liquidation_by_brand consistent with the candidate list: exclude
-- SKUs already diverted to Opportunities (open 'unlisted_sku' task).
CREATE OR REPLACE FUNCTION public.get_liquidation_by_brand(
  max_velocity numeric DEFAULT 0.5,
  min_capital  numeric DEFAULT 25
)
RETURNS TABLE(brand_name text, total_candidates bigint, capital_tied numeric, dead_count bigint, capital_under_clearance numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH cand AS (
    SELECT COALESCE(b.name, '(no brand)') AS brand_name, pc.sku, pc.current_stock, pc.cost_price,
      NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.sku = pc.sku) AS is_dead
    FROM products_cache pc LEFT JOIN brands b ON b.id = pc.brand_id
    WHERE COALESCE(pc.discontinued,false)=false AND COALESCE(pc.quarantined,false)=false
      AND pc.current_stock>0 AND pc.cost_price>0
      AND COALESCE(pc.velocity_per_week,0)<=max_velocity
      AND (pc.current_stock*pc.cost_price)>=min_capital
      AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku=pc.sku AND c.status='active')
      AND NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku=pc.sku)
      AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_rule='unlisted_sku' AND t.linked_entity_id=pc.sku AND t.status NOT IN ('done','cancelled'))
  ),
  cand_agg AS (
    SELECT brand_name, count(*)::bigint tot, round(sum(current_stock*cost_price),2) cap,
           count(*) FILTER (WHERE is_dead)::bigint dead
    FROM cand GROUP BY brand_name
  ),
  clr AS (
    SELECT COALESCE(b.name,'(no brand)') AS brand_name, round(sum(pcmp.baseline_stock*pcmp.baseline_cost),2) cap
    FROM price_campaigns pcmp
    JOIN products_cache pc ON pc.sku = pcmp.sku
    LEFT JOIN brands b ON b.id = pc.brand_id
    WHERE pcmp.status='active'
    GROUP BY 1
  )
  SELECT COALESCE(ca.brand_name, clr.brand_name) AS brand_name,
    COALESCE(ca.tot,0), COALESCE(ca.cap,0), COALESCE(ca.dead,0), COALESCE(clr.cap,0)
  FROM cand_agg ca FULL OUTER JOIN clr ON ca.brand_name = clr.brand_name
  ORDER BY COALESCE(ca.cap,0) DESC;
$$;
