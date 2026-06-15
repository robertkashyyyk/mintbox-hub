-- Profitability-band segmentation per ISO week, for the Profit Intelligence graphs.
-- Lets us watch the mix shift over time as repricing takes effect (loss/poor
-- shrinking, good/great/amazing growing).
--
-- Bands mirror the per-line POR% classifier on the Profit Intelligence page
-- (classifyBand): unknown = no/zero cost; otherwise POR = profit / (order_value * 1.2)
-- * 100, banded loss < -1, breakeven <= 1, poor <= 9.99, average <= 19.99,
-- good <= 24.99, great <= 29.99, amazing > 29.99. Computed live from
-- order_line_economics (same source the page already uses).

CREATE OR REPLACE FUNCTION public.get_profit_band_history()
RETURNS TABLE(
  iso_year int, iso_week int, week_start date,
  unknown_count bigint, loss_count bigint, breakeven_count bigint, poor_count bigint,
  average_count bigint, good_count bigint, great_count bigint, amazing_count bigint,
  total_lines bigint
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
        ELSE 'amazing'
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
    COUNT(*) FILTER (WHERE band IS NOT NULL)    AS total_lines
  FROM banded
  GROUP BY iso_year, iso_week
  ORDER BY iso_year, iso_week;
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_band_history() TO anon, authenticated, service_role;
