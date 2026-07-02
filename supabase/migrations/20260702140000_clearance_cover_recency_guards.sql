-- ============================================================================
-- Clearance candidate quality: add a weeks-of-cover guard + a recency guard.
--
-- Problem: the candidate filter was velocity(≤0.5/wk) + capital(≥£25) only. That's
-- too blunt — it flags slow-but-healthy high-value long-tail items the same as dead
-- stock. e.g. KKH-3732009 (Klokkerholm diesel tank, £357 cost, 3 in stock = £1,071):
-- velocity 0.31/wk trips the wire, but it sold YESTERDAY and has ~9.7 weeks of cover.
-- That's not dead — it's turning fine, just low unit-volume because it's expensive.
--
-- Fix — two extra guards, both must indicate "stale" for a SKU to be a candidate:
--   1. WEEKS OF COVER (primary): only flag if stock covers MORE than `min_cover`
--      weeks of sales (default 12 → "12 weeks or less is hardly an issue"). Never-sold
--      items have no velocity → treated as infinite cover → still flagged (the point).
--   2. RECENCY: and it must NOT have sold within the last `sold_within_weeks` weeks
--      (default 6). If it sold recently, it's working through — leave it.
--
-- Both are parameters (min_cover surfaced as a page control) so they're tunable.
-- Applied consistently to the candidate list, the count, and the by-brand chips.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_liquidation_candidates(numeric, numeric, integer, boolean, text);
CREATE OR REPLACE FUNCTION public.get_liquidation_candidates(
  max_velocity      numeric DEFAULT 0.5,
  min_capital       numeric DEFAULT 25,
  limit_n           integer DEFAULT 100,
  include_excluded  boolean DEFAULT false,
  p_brand           text    DEFAULT NULL,
  min_cover         numeric DEFAULT 12,
  sold_within_weeks integer DEFAULT 6
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
    -- weeks-of-cover guard: overstocked (or never-selling) only
    AND (COALESCE(pc.velocity_per_week, 0) <= 0
         OR (pc.current_stock / NULLIF(pc.velocity_per_week, 0)) > min_cover)
    -- recency guard: not sold within the recent window
    AND NOT EXISTS (SELECT 1 FROM order_lines ol
                    WHERE ol.sku = pc.sku
                      AND ol.order_date >= now() - (sold_within_weeks || ' weeks')::interval)
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
    AND (include_excluded OR NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku))
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_rule = 'unlisted_sku' AND t.linked_entity_id = pc.sku AND t.status NOT IN ('done','cancelled'))
  ORDER BY (pc.current_stock * pc.cost_price) DESC
  LIMIT GREATEST(limit_n, 1);
$$;

DROP FUNCTION IF EXISTS public.get_liquidation_candidate_count(numeric, numeric, text);
CREATE OR REPLACE FUNCTION public.get_liquidation_candidate_count(
  max_velocity      numeric DEFAULT 0.5,
  min_capital       numeric DEFAULT 25,
  p_brand           text    DEFAULT NULL,
  min_cover         numeric DEFAULT 12,
  sold_within_weeks integer DEFAULT 6
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
    AND (COALESCE(pc.velocity_per_week, 0) <= 0
         OR (pc.current_stock / NULLIF(pc.velocity_per_week, 0)) > min_cover)
    AND NOT EXISTS (SELECT 1 FROM order_lines ol
                    WHERE ol.sku = pc.sku
                      AND ol.order_date >= now() - (sold_within_weeks || ' weeks')::interval)
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
    AND NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku)
    AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.source_rule = 'unlisted_sku' AND t.linked_entity_id = pc.sku AND t.status NOT IN ('done','cancelled'));
$$;

DROP FUNCTION IF EXISTS public.get_liquidation_by_brand(numeric, numeric);
CREATE OR REPLACE FUNCTION public.get_liquidation_by_brand(
  max_velocity      numeric DEFAULT 0.5,
  min_capital       numeric DEFAULT 25,
  min_cover         numeric DEFAULT 12,
  sold_within_weeks integer DEFAULT 6
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
      AND (COALESCE(pc.velocity_per_week, 0) <= 0
           OR (pc.current_stock / NULLIF(pc.velocity_per_week, 0)) > min_cover)
      AND NOT EXISTS (SELECT 1 FROM order_lines ol
                      WHERE ol.sku = pc.sku
                        AND ol.order_date >= now() - (sold_within_weeks || ' weeks')::interval)
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

GRANT EXECUTE ON FUNCTION public.get_liquidation_candidates(numeric,numeric,integer,boolean,text,numeric,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_liquidation_candidate_count(numeric,numeric,text,numeric,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_liquidation_by_brand(numeric,numeric,numeric,integer) TO authenticated;
