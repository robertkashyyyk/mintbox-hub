-- ============================================================================
-- 20260629120000_profit_stellar_band.sql
-- Add a new top profitability tier "Stellar" for POR % >= 50%.
--
-- Why: the "Amazing" band was doing two jobs — it captured everything above
-- 30% POR, so ~31% of lines piled into one bucket. Splitting at 50% gives:
--   Great    : great_max   (29.99) < POR <= amazing_max
--   Amazing  : 30%        < POR <= 50%   (new amazing_max = 49.99)
--   Stellar  : POR > 50%                 (the new tier)
--
-- amazing_max is a NEW, user-editable threshold (Profit Rules → Profitability
-- bands). Touches the two SQL band classifiers that mirror the dashboard:
--   * get_profit_week_breakdown()  — the segmentation cards (reads app_settings)
--   * get_profit_band_history()    — the trend graph (hardcoded thresholds)
-- ============================================================================

-- 1. Seed the new threshold into app_settings without clobbering any values the
--    user may have already customised. Only adds amazing_max if it's missing.
UPDATE public.app_settings
SET value = value || jsonb_build_object('amazing_max', 49.99::numeric)
WHERE key = 'profit.loss_bands'
  AND NOT (value ? 'amazing_max');

INSERT INTO public.app_settings (key, value)
SELECT 'profit.loss_bands', jsonb_build_object(
  'mode', 'pct',
  'loss_max', -1.0, 'breakeven_max', 1.0, 'poor_max', 9.99,
  'average_max', 19.99, 'good_max', 24.99, 'great_max', 29.99, 'amazing_max', 49.99
)
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'profit.loss_bands');

-- 2. Segmentation cards: add the amazing_max split + 'stellar' band.
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

-- 3. Trend graph: add stellar_count and the 50% split. (Thresholds here are
--    hardcoded to mirror the dashboard defaults, as before.)
-- Adding an OUT column changes the return type, so the old function must be
-- dropped first (CREATE OR REPLACE can't change the return signature).
DROP FUNCTION IF EXISTS public.get_profit_band_history();
CREATE OR REPLACE FUNCTION public.get_profit_band_history()
RETURNS TABLE(
  iso_year int, iso_week int, week_start date,
  unknown_count bigint, loss_count bigint, breakeven_count bigint, poor_count bigint,
  average_count bigint, good_count bigint, great_count bigint, amazing_count bigint,
  stellar_count bigint, total_lines bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH banded AS (
    SELECT ole.iso_year, ole.iso_week, ole.week_start,
      CASE
        WHEN ole.cost_each IS NULL OR ole.cost_each = 0 THEN 'unknown'
        WHEN ole.order_value IS NULL OR ole.order_value <= 0 THEN NULL
        WHEN ole.profit / (ole.order_value * 1.2) * 100 < -1     THEN 'loss'
        WHEN ole.profit / (ole.order_value * 1.2) * 100 <= 1     THEN 'breakeven'
        WHEN ole.profit / (ole.order_value * 1.2) * 100 <= 9.99  THEN 'poor'
        WHEN ole.profit / (ole.order_value * 1.2) * 100 <= 19.99 THEN 'average'
        WHEN ole.profit / (ole.order_value * 1.2) * 100 <= 24.99 THEN 'good'
        WHEN ole.profit / (ole.order_value * 1.2) * 100 <= 29.99 THEN 'great'
        WHEN ole.profit / (ole.order_value * 1.2) * 100 <= 49.99 THEN 'amazing'
        ELSE 'stellar'
      END AS band
    FROM public.order_line_economics ole
  )
  SELECT iso_year, iso_week, MIN(week_start) AS week_start,
    COUNT(*) FILTER (WHERE band = 'unknown')   AS unknown_count,
    COUNT(*) FILTER (WHERE band = 'loss')       AS loss_count,
    COUNT(*) FILTER (WHERE band = 'breakeven')  AS breakeven_count,
    COUNT(*) FILTER (WHERE band = 'poor')       AS poor_count,
    COUNT(*) FILTER (WHERE band = 'average')    AS average_count,
    COUNT(*) FILTER (WHERE band = 'good')       AS good_count,
    COUNT(*) FILTER (WHERE band = 'great')      AS great_count,
    COUNT(*) FILTER (WHERE band = 'amazing')    AS amazing_count,
    COUNT(*) FILTER (WHERE band = 'stellar')    AS stellar_count,
    COUNT(*) FILTER (WHERE band IS NOT NULL)    AS total_lines
  FROM banded
  GROUP BY iso_year, iso_week
  ORDER BY iso_year, iso_week;
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_band_history() TO anon, authenticated, service_role;
