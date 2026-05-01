-- Update profit.loss_bands to percentage-based (POR %) thresholds with 7 bands
UPDATE public.app_settings
SET value = jsonb_build_object(
  'mode', 'pct',
  'loss_max', -1.0,
  'breakeven_max', 1.0,
  'poor_max', 9.99,
  'average_max', 19.99,
  'good_max', 24.99,
  'great_max', 29.99
)
WHERE key = 'profit.loss_bands';

INSERT INTO public.app_settings (key, value)
SELECT 'profit.loss_bands', jsonb_build_object(
  'mode', 'pct',
  'loss_max', -1.0,
  'breakeven_max', 1.0,
  'poor_max', 9.99,
  'average_max', 19.99,
  'good_max', 24.99,
  'great_max', 29.99
)
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'profit.loss_bands');

-- Replace breakdown function with 7-band POR % logic
-- POR % per line = profit / (order_value * 1.2) * 100  (matches dashboard POR definition)
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
      COALESCE((value->>'great_max')::numeric,     29.99) AS great_max
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
        ELSE 'amazing'
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
  ORDER BY array_position(ARRAY['loss','breakeven','poor','average','good','great','amazing'], b.band);
$function$;