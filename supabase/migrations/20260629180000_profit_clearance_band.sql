-- ============================================================================
-- 20260629180000_profit_clearance_band.sql
-- Add a "clearance" bucket to the profit segmentation: order lines sold while
-- their SKU was on an active Sale or Liquidation campaign (price_campaigns).
-- These lose money ON PURPOSE (demand stimulus / capital release), so lumping
-- them into LOSS is misleading. They're pulled OUT of the POR bands into their
-- own Clearance bucket, leaving Loss = genuine, unintended loss.
--
-- This also makes get_profit_week_breakdown the SINGLE source for every bucket:
--   precedence: clearance > unknown (missing cost) > POR band (loss..stellar)
-- so the frontend no longer has to stitch Unknown in from missing_cost_count
-- (which double-counted). Denominator = sum of all band counts.
--
-- Clearance attribution: line.sku base (-Qnn stripped) matches an active
-- price_campaigns row (type sale|liquidation), AND the order_date falls within
-- [start_date, COALESCE(end_date, today)] — i.e. it was actually on clearance
-- when it sold.
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
  -- Active clearance campaigns, keyed by base SKU (so -Qnn packs match too).
  clearance AS (
    SELECT DISTINCT
      regexp_replace(sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      start_date,
      COALESCE(end_date, CURRENT_DATE) AS end_date
    FROM public.price_campaigns
    WHERE status = 'active' AND type IN ('sale', 'liquidation')
  ),
  src AS (
    SELECT
      ole.profit,
      ole.cost_each,
      CASE WHEN ole.order_value IS NOT NULL AND ole.order_value > 0
        THEN (ole.profit / (ole.order_value * 1.2)) * 100.0
        ELSE NULL END AS por_pct_line,
      EXISTS (
        SELECT 1 FROM clearance c
        WHERE c.base_sku = regexp_replace(ole.sku, '(?i)-Q[0-9]+$', '')
          AND ole.order_date::date BETWEEN c.start_date AND c.end_date
      ) AS is_clearance
    FROM public.order_line_economics ole
    WHERE ole.iso_year = p_iso_year AND ole.iso_week = p_iso_week
      AND ole.profit IS NOT NULL
      AND ole.order_value IS NOT NULL AND ole.order_value > 0
  ),
  banded AS (
    SELECT
      CASE
        WHEN s.is_clearance                              THEN 'clearance'
        WHEN s.cost_each IS NULL OR s.cost_each = 0      THEN 'unknown'
        WHEN s.por_pct_line <  c.loss_max               THEN 'loss'
        WHEN s.por_pct_line <= c.breakeven_max          THEN 'breakeven'
        WHEN s.por_pct_line <= c.poor_max               THEN 'poor'
        WHEN s.por_pct_line <= c.average_max            THEN 'average'
        WHEN s.por_pct_line <= c.good_max               THEN 'good'
        WHEN s.por_pct_line <= c.great_max              THEN 'great'
        WHEN s.por_pct_line <= c.amazing_max            THEN 'amazing'
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
    -- Unknown profit is unreliable (no cost) so we hide it; everything else real.
    CASE WHEN b.band = 'unknown' THEN NULL ELSE ROUND(SUM(b.profit)::numeric, 2) END AS profit_total
  FROM banded b CROSS JOIN totals t
  GROUP BY b.band, t.n
  ORDER BY array_position(
    ARRAY['clearance','unknown','loss','breakeven','poor','average','good','great','amazing','stellar'], b.band);
$function$;
