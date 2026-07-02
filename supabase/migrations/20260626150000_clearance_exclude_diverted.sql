-- ============================================================================
-- Clearance — a SKU that's been diverted to Opportunities (an open 'unlisted_sku'
-- task exists) should NOT keep showing as a Clearance candidate. Otherwise you
-- re-select it, it re-diverts, and it never leaves the list. Exclude any SKU
-- with an open unlisted task from both the candidate list and the count.
-- (Model: listed dead stock → Clearance; unlisted → Opportunities.)
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_liquidation_candidates(numeric, numeric, integer, boolean, text);
CREATE OR REPLACE FUNCTION public.get_liquidation_candidates(
  max_velocity   numeric DEFAULT 0.5,
  min_capital    numeric DEFAULT 25,
  limit_n        integer DEFAULT 100,
  include_excluded boolean DEFAULT false,
  p_brand        text DEFAULT NULL
)
RETURNS TABLE(
  sku text, product_name text, brand_name text,
  current_stock numeric, cost_price numeric, velocity_per_week numeric,
  units_sold_90d integer, weeks_of_cover numeric, capital_tied numeric,
  last_sold date, in_campaign boolean, is_excluded boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pc.sku, pc.name, b.name,
    pc.current_stock, pc.cost_price, COALESCE(pc.velocity_per_week, 0),
    pc.units_sold_90d,
    CASE WHEN COALESCE(pc.velocity_per_week,0) > 0 THEN round(pc.current_stock / pc.velocity_per_week, 1) ELSE NULL END,
    round(pc.current_stock * pc.cost_price, 2),
    (SELECT max(ol.order_date)::date FROM order_lines ol WHERE ol.sku = pc.sku),
    EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active'),
    EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku)
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND pc.cost_price > 0
    AND COALESCE(pc.velocity_per_week, 0) <= max_velocity
    AND (pc.current_stock * pc.cost_price) >= min_capital
    AND (p_brand IS NULL OR b.name = p_brand)
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
    AND (include_excluded OR NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku))
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_rule = 'unlisted_sku' AND t.linked_entity_id = pc.sku AND t.status NOT IN ('done','cancelled'))
  ORDER BY (pc.current_stock * pc.cost_price) DESC
  LIMIT GREATEST(limit_n, 1);
$$;

DROP FUNCTION IF EXISTS public.get_liquidation_candidate_count(numeric, numeric, text);
CREATE OR REPLACE FUNCTION public.get_liquidation_candidate_count(
  max_velocity numeric DEFAULT 0.5,
  min_capital  numeric DEFAULT 25,
  p_brand      text DEFAULT NULL
)
RETURNS TABLE(total bigint, total_capital numeric, dead_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    count(*)::bigint,
    round(COALESCE(sum(pc.current_stock * pc.cost_price), 0), 2),
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM order_lines ol WHERE ol.sku = pc.sku))::bigint
  FROM products_cache pc
  LEFT JOIN brands b ON b.id = pc.brand_id
  WHERE COALESCE(pc.discontinued, false) = false
    AND COALESCE(pc.quarantined, false) = false
    AND pc.current_stock > 0
    AND pc.cost_price > 0
    AND COALESCE(pc.velocity_per_week, 0) <= max_velocity
    AND (pc.current_stock * pc.cost_price) >= min_capital
    AND (p_brand IS NULL OR b.name = p_brand)
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku)
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_rule = 'unlisted_sku' AND t.linked_entity_id = pc.sku AND t.status NOT IN ('done','cancelled'));
$$;
