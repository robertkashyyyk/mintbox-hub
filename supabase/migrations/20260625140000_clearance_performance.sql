-- ============================================================================
-- Clearance — live performance snapshot for the On Sale / In Liquidation tabs.
-- Rolls up sales WITHIN each active campaign's window (since start_date), split
-- by intent. "Uplift" = actual units sold vs what the dead-stock baseline rate
-- would have produced (baseline_velocity x weeks live) — the "is it working?".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_clearance_performance()
RETURNS TABLE(
  on_sale_count          integer,
  on_sale_capital        numeric,
  on_sale_units          integer,
  on_sale_revenue        numeric,
  on_sale_baseline_units numeric,
  on_sale_avg_discount   numeric,
  awaiting_review        integer,
  recovering             integer,
  liq_count              integer,
  liq_capital            numeric,
  liq_units              integer,
  liq_revenue            numeric,
  liq_avg_discount       numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH active AS (
    SELECT id, sku, type, stage, discount_pct, baseline_stock, baseline_cost,
           baseline_velocity, start_date
    FROM price_campaigns WHERE status = 'active'
  ),
  sales AS (
    SELECT regexp_replace(ol.sku, '-Q[0-9]+$', '') AS base_sku, ol.order_date, ol.qty, ol.unit_price
    FROM order_lines ol
    WHERE ol.order_date >= (SELECT min(start_date) FROM active)
      AND regexp_replace(ol.sku, '-Q[0-9]+$', '') IN (SELECT sku FROM active)
  ),
  per_campaign AS (
    SELECT a.id, a.sku, a.type, a.stage, a.discount_pct, a.baseline_stock, a.baseline_cost, a.baseline_velocity,
      COALESCE(SUM(s.qty) FILTER (WHERE s.order_date >= a.start_date), 0) AS units,
      round(COALESCE(SUM(s.qty * s.unit_price) FILTER (WHERE s.order_date >= a.start_date), 0), 2) AS revenue,
      GREATEST(0, (current_date - a.start_date)) / 7.0 AS weeks_live
    FROM active a
    LEFT JOIN sales s ON s.base_sku = a.sku
    GROUP BY a.id, a.sku, a.type, a.stage, a.discount_pct, a.baseline_stock, a.baseline_cost, a.baseline_velocity, a.start_date
  )
  SELECT
    count(*) FILTER (WHERE type = 'sale')::integer,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE type = 'sale'), 0), 2),
    COALESCE(sum(units) FILTER (WHERE type = 'sale'), 0)::integer,
    round(COALESCE(sum(revenue) FILTER (WHERE type = 'sale'), 0), 2),
    round(COALESCE(sum(COALESCE(baseline_velocity, 0) * weeks_live) FILTER (WHERE type = 'sale'), 0), 1),
    round(COALESCE(avg(discount_pct) FILTER (WHERE type = 'sale'), 0), 0),
    count(*) FILTER (WHERE type = 'sale' AND stage = 'review')::integer,
    count(*) FILTER (WHERE type = 'sale' AND stage = 'recovering')::integer,
    count(*) FILTER (WHERE type = 'liquidation')::integer,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE type = 'liquidation'), 0), 2),
    COALESCE(sum(units) FILTER (WHERE type = 'liquidation'), 0)::integer,
    round(COALESCE(sum(revenue) FILTER (WHERE type = 'liquidation'), 0), 2),
    round(COALESCE(avg(discount_pct) FILTER (WHERE type = 'liquidation'), 0), 0)
  FROM per_campaign;
$$;

GRANT EXECUTE ON FUNCTION public.get_clearance_performance() TO authenticated;
