-- Liquidation enhancements: last-sold staleness, snooze/exclude list.

CREATE TABLE IF NOT EXISTS public.liquidation_exclusions (
  sku         text PRIMARY KEY,
  reason      text,
  excluded_by uuid,
  excluded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.liquidation_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read liq_excl"  ON public.liquidation_exclusions FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write liq_excl" ON public.liquidation_exclusions FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- Candidates with last_sold (staleness) + snooze exclusion.
DROP FUNCTION IF EXISTS public.get_liquidation_candidates(numeric, numeric, integer);
CREATE OR REPLACE FUNCTION public.get_liquidation_candidates(
  max_velocity   numeric DEFAULT 0.5,
  min_capital    numeric DEFAULT 25,
  limit_n        integer DEFAULT 100,
  include_excluded boolean DEFAULT false
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
    AND NOT EXISTS (SELECT 1 FROM price_campaigns c WHERE c.sku = pc.sku AND c.status = 'active')
    AND (include_excluded OR NOT EXISTS (SELECT 1 FROM liquidation_exclusions x WHERE x.sku = pc.sku))
  ORDER BY (pc.current_stock * pc.cost_price) DESC
  LIMIT GREATEST(limit_n, 1);
$$;

-- Capital currently under active clearance (for the freed/under-clearance KPI).
CREATE OR REPLACE FUNCTION public.get_clearance_capital()
RETURNS TABLE(active_campaigns bigint, capital_under_clearance numeric, campaigns_run bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'active')::bigint,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE status = 'active'), 0), 2),
    count(*) FILTER (WHERE status IN ('ended','reverted'))::bigint
  FROM price_campaigns;
$$;
