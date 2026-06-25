-- ============================================================================
-- Clearance — split "under active clearance" into On Sale vs In Liquidation.
-- Sales capital comes back (recovered); liquidation capital is being written
-- down — so they shouldn't share one number.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_clearance_breakdown()
RETURNS TABLE(
  on_sale_count       bigint,
  on_sale_capital     numeric,
  liquidation_count   bigint,
  liquidation_capital numeric,
  campaigns_run       bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'active' AND type = 'sale')::bigint,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE status = 'active' AND type = 'sale'), 0), 2),
    count(*) FILTER (WHERE status = 'active' AND type = 'liquidation')::bigint,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE status = 'active' AND type = 'liquidation'), 0), 2),
    count(*) FILTER (WHERE status IN ('ended', 'reverted'))::bigint
  FROM price_campaigns;
$$;

GRANT EXECUTE ON FUNCTION public.get_clearance_breakdown() TO authenticated;
