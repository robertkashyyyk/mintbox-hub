-- ============================================================================
-- 20260629140000_profit_breakdown_cost_guard.sql
-- Fix: get_profit_week_breakdown counted MISSING-COST lines into the priced
-- bands. A line with cost_each = 0 has its profit computed with no cost
-- deducted → a fake-high POR → it landed in Amazing/Stellar AND was also
-- counted in the Unknown card (missing_cost_count) — double-counted, and the
-- top bands inflated.
--
-- The frontend classifier (classifyBand) already routes cost_each null/0 to
-- "unknown". This makes the SQL match: only lines with a real cost are banded.
-- Pre-existing bug; the new Stellar tier just made it obvious (zero-cost lines
-- get the highest fake POR, so they piled into Stellar).
--
-- Verified on 2026-W27: Stellar 10→2, Amazing 30→28; the 12 cost_each=0 lines
-- now sit only in Unknown.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profit_week_breakdown(p_iso_year integer, p_iso_week integer)
RETURNS TABLE(band text, line_count bigint, pct numeric, profit_total numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT
      COALESCE((value->>'loss_max')::numeric,      -1.0)  AS loss_max,
      COALESCE((value->>'breakeven_max')::numeric,  1.0)  AS breakeven_max,
      COALESCE((value->>'poor_max')::numeric,       9.99) AS poor_max,
      COALESCE((value->>'average_max')::numeric,   19.99) AS average_max,
      COALESCE((value->>'good_max')::numeric,      24.99) AS good_max,
      COALESCE((value->>'great_max')::numeric,     29.99) AS great_max,
      COALESCE((value->>'amazing_max')::numeric,   49.99) AS amazing_max
    FROM public.app_settings WHERE key = 'profit.loss_bands'
  ),
  src AS (
    SELECT
      profit,
      CASE WHEN order_value IS NOT NULL AND order_value > 0
        THEN (profit / (order_value * 1.2)) * 100.0
        ELSE NULL END AS por_pct_line
    FROM public.order_line_economics
    WHERE iso_year = p_iso_year AND iso_week = p_iso_week
      AND profit IS NOT NULL
      AND order_value IS NOT NULL AND order_value > 0
      -- Missing-cost lines belong in Unknown (mirrors classifyBand), not the
      -- priced bands — their profit is computed with zero cost = fake-high POR.
      AND cost_each IS NOT NULL AND cost_each <> 0
  ),
  banded AS (
    SELECT
      CASE
        WHEN s.por_pct_line <  c.loss_max       THEN 'loss'
        WHEN s.por_pct_line <= c.breakeven_max  THEN 'breakeven'
        WHEN s.por_pct_line <= c.poor_max       THEN 'poor'
        WHEN s.por_pct_line <= c.average_max    THEN 'average'
        WHEN s.por_pct_line <= c.good_max       THEN 'good'
        WHEN s.por_pct_line <= c.great_max      THEN 'great'
        WHEN s.por_pct_line <= c.amazing_max    THEN 'amazing'
        ELSE 'stellar'
      END AS band,
      s.profit
    FROM src s, cfg c
  ),
  totals AS (SELECT COUNT(*)::bigint AS n FROM banded)
  SELECT
    b.band,
    COUNT(*)::bigint AS line_count,
    CASE WHEN t.n > 0 THEN ROUND((COUNT(*)::numeric / t.n) * 100, 2) ELSE 0 END AS pct,
    ROUND(SUM(b.profit)::numeric, 2) AS profit_total
  FROM banded b CROSS JOIN totals t
  GROUP BY b.band, t.n
  ORDER BY array_position(ARRAY['loss','breakeven','poor','average','good','great','amazing','stellar'], b.band);
$function$;
