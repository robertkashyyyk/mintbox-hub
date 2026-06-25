-- ============================================================================
-- Clearance Standing Report — per-campaign rows (active + historical) with the
-- units/revenue sold within each campaign's window. The report's headline cards
-- aggregate this client-side; the trend graph reuses liquidation_snapshots.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_clearance_report_campaigns()
RETURNS TABLE(
  id           uuid,
  sku          text,
  type         text,
  status       text,
  stage        text,
  discount_pct numeric,
  capital      numeric,
  units        integer,
  revenue      numeric,
  outcome      text,
  start_date   date,
  end_date     date
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH camp AS (
    SELECT id, sku, type, status, stage, outcome, end_date, start_date, discount_pct,
           baseline_stock, baseline_cost
    FROM price_campaigns
  ),
  sales AS (
    SELECT regexp_replace(ol.sku, '-Q[0-9]+$', '') AS base_sku, ol.order_date, ol.qty, ol.unit_price
    FROM order_lines ol
    WHERE ol.order_date >= (SELECT min(start_date) FROM camp)
      AND regexp_replace(ol.sku, '-Q[0-9]+$', '') IN (SELECT sku FROM camp)
  )
  SELECT
    c.id, c.sku, c.type, c.status, c.stage, c.discount_pct,
    round(COALESCE(c.baseline_stock * c.baseline_cost, 0), 2) AS capital,
    COALESCE(SUM(s.qty) FILTER (WHERE s.order_date >= c.start_date AND s.order_date <= COALESCE(c.end_date, current_date) + 1), 0)::integer AS units,
    round(COALESCE(SUM(s.qty * s.unit_price) FILTER (WHERE s.order_date >= c.start_date AND s.order_date <= COALESCE(c.end_date, current_date) + 1), 0), 2) AS revenue,
    c.outcome, c.start_date, c.end_date
  FROM camp c
  LEFT JOIN sales s ON s.base_sku = c.sku
  GROUP BY c.id, c.sku, c.type, c.status, c.stage, c.discount_pct, c.baseline_stock, c.baseline_cost, c.outcome, c.start_date, c.end_date
  ORDER BY capital DESC
  LIMIT 500;
$$;

GRANT EXECUTE ON FUNCTION public.get_clearance_report_campaigns() TO authenticated;
