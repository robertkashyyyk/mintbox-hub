-- ============================================================================
-- Clearance measurement layer: profit (not just revenue) + full-channel (incl.
-- Amazon FBA) + a cumulative "clearance payoff" for the standing report.
--
-- Before: get_clearance_performance read raw order_lines (revenue/units only, and
-- FBA sits outside order_lines). order_economics_all already unions eBay + Amazon
-- FBM + FBA and carries per-line cost/fees/PROFIT, so we measure off that instead.
-- ============================================================================

-- ── 1. Per-campaign performance, now with net profit + FBA ──────────────────
DROP FUNCTION IF EXISTS public.get_clearance_performance();
CREATE OR REPLACE FUNCTION public.get_clearance_performance()
RETURNS TABLE(
  on_sale_count          integer,
  on_sale_capital        numeric,
  on_sale_units          integer,
  on_sale_revenue        numeric,
  on_sale_profit         numeric,
  on_sale_baseline_units numeric,
  on_sale_avg_discount   numeric,
  awaiting_review        integer,
  recovering             integer,
  liq_count              integer,
  liq_capital            numeric,
  liq_units              integer,
  liq_revenue            numeric,
  liq_profit             numeric,
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
    SELECT regexp_replace(oe.sku, '-Q[0-9]+$', '') AS base_sku, oe.order_date,
           oe.qty, (oe.qty * oe.price) AS revenue, oe.profit
    FROM order_economics_all oe
    WHERE oe.order_date >= (SELECT min(start_date) FROM active)
      AND regexp_replace(oe.sku, '-Q[0-9]+$', '') IN (SELECT sku FROM active)
  ),
  per_campaign AS (
    SELECT a.id, a.type, a.stage, a.discount_pct, a.baseline_stock, a.baseline_cost, a.baseline_velocity,
      COALESCE(SUM(s.qty)     FILTER (WHERE s.order_date >= a.start_date), 0)     AS units,
      round(COALESCE(SUM(s.revenue) FILTER (WHERE s.order_date >= a.start_date), 0), 2) AS revenue,
      round(COALESCE(SUM(s.profit)  FILTER (WHERE s.order_date >= a.start_date), 0), 2) AS profit,
      GREATEST(0, (current_date - a.start_date)) / 7.0 AS weeks_live
    FROM active a
    LEFT JOIN sales s ON s.base_sku = a.sku
    GROUP BY a.id, a.type, a.stage, a.discount_pct, a.baseline_stock, a.baseline_cost, a.baseline_velocity, a.start_date
  )
  SELECT
    count(*) FILTER (WHERE type = 'sale')::integer,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE type = 'sale'), 0), 2),
    COALESCE(sum(units) FILTER (WHERE type = 'sale'), 0)::integer,
    round(COALESCE(sum(revenue) FILTER (WHERE type = 'sale'), 0), 2),
    round(COALESCE(sum(profit)  FILTER (WHERE type = 'sale'), 0), 2),
    round(COALESCE(sum(COALESCE(baseline_velocity, 0) * weeks_live) FILTER (WHERE type = 'sale'), 0), 1),
    round(COALESCE(avg(discount_pct) FILTER (WHERE type = 'sale'), 0), 0),
    count(*) FILTER (WHERE type = 'sale' AND stage = 'review')::integer,
    count(*) FILTER (WHERE type = 'sale' AND stage = 'recovering')::integer,
    count(*) FILTER (WHERE type = 'liquidation')::integer,
    round(COALESCE(sum(baseline_stock * baseline_cost) FILTER (WHERE type = 'liquidation'), 0), 2),
    COALESCE(sum(units) FILTER (WHERE type = 'liquidation'), 0)::integer,
    round(COALESCE(sum(revenue) FILTER (WHERE type = 'liquidation'), 0), 2),
    round(COALESCE(sum(profit)  FILTER (WHERE type = 'liquidation'), 0), 2),
    round(COALESCE(avg(discount_pct) FILTER (WHERE type = 'liquidation'), 0), 0)
  FROM per_campaign;
$$;
GRANT EXECUTE ON FUNCTION public.get_clearance_performance() TO authenticated;

-- ── 2. Cumulative programme payoff (ALL campaigns ever) ─────────────────────
-- Realized units / revenue / net profit / capital cleared (units × baseline_cost)
-- attributable to every sale/liquidation, across its live window. Gross figures —
-- for dead stock (baseline velocity ~0) effectively all incremental.
CREATE OR REPLACE FUNCTION public.get_clearance_payoff()
RETURNS TABLE(
  campaigns_total        integer,
  sale_units             integer, sale_revenue numeric, sale_profit numeric, sale_capital_cleared numeric,
  liq_units              integer, liq_revenue numeric, liq_profit numeric, liq_capital_cleared numeric,
  total_units            integer, total_revenue numeric, total_profit numeric, total_capital_cleared numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH camp AS (
    SELECT id, sku, type, start_date, COALESCE(end_date, current_date) AS end_d, baseline_cost
    FROM price_campaigns
    WHERE type IN ('sale','liquidation')
  ),
  s AS (
    SELECT c.type, c.baseline_cost, oe.qty, (oe.qty * oe.price) AS revenue, oe.profit
    FROM camp c
    JOIN order_economics_all oe
      ON regexp_replace(oe.sku, '-Q[0-9]+$', '') = c.sku
     AND oe.order_date >= c.start_date
     AND oe.order_date < (c.end_d + 1)
    WHERE oe.order_date >= (SELECT min(start_date) FROM camp)
  )
  SELECT
    (SELECT count(*) FROM camp)::integer,
    COALESCE(sum(qty) FILTER (WHERE type='sale'),0)::integer,
    round(COALESCE(sum(revenue) FILTER (WHERE type='sale'),0),2),
    round(COALESCE(sum(profit)  FILTER (WHERE type='sale'),0),2),
    round(COALESCE(sum(qty*baseline_cost) FILTER (WHERE type='sale'),0),2),
    COALESCE(sum(qty) FILTER (WHERE type='liquidation'),0)::integer,
    round(COALESCE(sum(revenue) FILTER (WHERE type='liquidation'),0),2),
    round(COALESCE(sum(profit)  FILTER (WHERE type='liquidation'),0),2),
    round(COALESCE(sum(qty*baseline_cost) FILTER (WHERE type='liquidation'),0),2),
    COALESCE(sum(qty),0)::integer,
    round(COALESCE(sum(revenue),0),2),
    round(COALESCE(sum(profit),0),2),
    round(COALESCE(sum(qty*baseline_cost),0),2)
  FROM s;
$$;
GRANT EXECUTE ON FUNCTION public.get_clearance_payoff() TO authenticated;

-- ── 3. Persist realized payoff into the daily snapshot (trend for the report) ─
ALTER TABLE public.liquidation_snapshots
  ADD COLUMN IF NOT EXISTS realized_revenue numeric,
  ADD COLUMN IF NOT EXISTS realized_profit  numeric,
  ADD COLUMN IF NOT EXISTS capital_cleared  numeric;

CREATE OR REPLACE FUNCTION public.capture_liquidation_snapshot()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.liquidation_snapshots (
    snapshot_date, total_candidates, total_capital, dead_count,
    capital_under_clearance, on_sale_capital, liquidation_capital,
    realized_revenue, realized_profit, capital_cleared)
  SELECT current_date, t.total, t.total_capital, t.dead_count,
         b.on_sale_capital + b.liquidation_capital, b.on_sale_capital, b.liquidation_capital,
         p.total_revenue, p.total_profit, p.total_capital_cleared
  FROM get_liquidation_candidate_count(0.5, 25, NULL) t, get_clearance_breakdown() b, get_clearance_payoff() p
  ON CONFLICT (snapshot_date) DO UPDATE
    SET total_candidates        = EXCLUDED.total_candidates,
        total_capital           = EXCLUDED.total_capital,
        dead_count              = EXCLUDED.dead_count,
        capital_under_clearance = EXCLUDED.capital_under_clearance,
        on_sale_capital         = EXCLUDED.on_sale_capital,
        liquidation_capital     = EXCLUDED.liquidation_capital,
        realized_revenue        = EXCLUDED.realized_revenue,
        realized_profit         = EXCLUDED.realized_profit,
        capital_cleared         = EXCLUDED.capital_cleared;
$$;
