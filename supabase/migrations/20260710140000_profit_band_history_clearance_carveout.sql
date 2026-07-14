-- The band-history graph (get_profit_band_history) folded deliberate-clearance losses into the
-- Loss band, so it read higher than the table's band panel (get_profit_week_breakdown), which
-- carves clearance into its own bucket. Mirror the table exactly: clearance-first classification,
-- cfg thresholds from app_settings, and a clearance_count column. Uses a hash join (clearance
-- line-ids resolved once) instead of a per-line EXISTS across all weeks, so it stays fast.
-- (Applied to prod 2026-07-10 via MCP; file added for repo parity.)
DROP FUNCTION IF EXISTS public.get_profit_band_history();
CREATE OR REPLACE FUNCTION public.get_profit_band_history()
 RETURNS TABLE(iso_year integer, iso_week integer, week_start date, unknown_count bigint, loss_count bigint, breakeven_count bigint, poor_count bigint, average_count bigint, good_count bigint, great_count bigint, amazing_count bigint, stellar_count bigint, clearance_count bigint, total_lines bigint)
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
  clearance AS (
    SELECT DISTINCT
      regexp_replace(sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      start_date, COALESCE(end_date, CURRENT_DATE) AS end_date
    FROM public.price_campaigns
    WHERE status = 'active' AND type IN ('sale', 'liquidation')
  ),
  src AS MATERIALIZED (
    SELECT ole.id, ole.iso_year, ole.iso_week, ole.week_start, ole.cost_each, ole.profit, ole.order_value,
           ole.order_date::date AS od,
           regexp_replace(ole.sku, '(?i)-Q[0-9]+$', '') AS base_sku
    FROM public.order_economics_all ole
    WHERE ole.week_start >= '2026-03-16'::date
      AND ole.profit IS NOT NULL AND ole.order_value IS NOT NULL AND ole.order_value > 0
  ),
  cl_lines AS (
    SELECT DISTINCT s.id
    FROM src s JOIN clearance c ON c.base_sku = s.base_sku AND s.od BETWEEN c.start_date AND c.end_date
  ),
  banded AS (
    SELECT s.iso_year, s.iso_week, s.week_start,
      CASE
        WHEN cl.id IS NOT NULL                             THEN 'clearance'
        WHEN s.cost_each IS NULL OR s.cost_each = 0        THEN 'unknown'
        WHEN s.profit / (s.order_value * 1.2) * 100 <  c.loss_max      THEN 'loss'
        WHEN s.profit / (s.order_value * 1.2) * 100 <= c.breakeven_max THEN 'breakeven'
        WHEN s.profit / (s.order_value * 1.2) * 100 <= c.poor_max      THEN 'poor'
        WHEN s.profit / (s.order_value * 1.2) * 100 <= c.average_max   THEN 'average'
        WHEN s.profit / (s.order_value * 1.2) * 100 <= c.good_max      THEN 'good'
        WHEN s.profit / (s.order_value * 1.2) * 100 <= c.great_max     THEN 'great'
        WHEN s.profit / (s.order_value * 1.2) * 100 <= c.amazing_max   THEN 'amazing'
        ELSE 'stellar'
      END AS band
    FROM src s CROSS JOIN cfg c
    LEFT JOIN cl_lines cl ON cl.id = s.id
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
    COUNT(*) FILTER (WHERE band = 'clearance')  AS clearance_count,
    COUNT(*)                                    AS total_lines
  FROM banded
  GROUP BY iso_year, iso_week
  ORDER BY iso_year, iso_week;
$function$;
