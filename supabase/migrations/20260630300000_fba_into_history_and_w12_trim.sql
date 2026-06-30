-- ============================================================================
-- 20260630300000_fba_into_history_and_w12_trim.sql
-- Phase 4b: fold Amazon FBA into the HISTORICAL profit surfaces + trim graphs to W12.
--
-- Repoint the reporting RPCs from order_line_economics (FBM/eBay matview) to
-- public.order_economics_all (FBM/eBay + FBA). Surgical, per-function — the
-- matview itself stays untouched so the repricer's courier median + get_target_pace
-- (the "Hub/FBM lane" targets) keep their FBM/eBay-only basis.
--   get_profit_history      -> combined + W12 floor (the main graph)
--   get_profit_band_history -> combined + W12 floor (band-mix graph; feeds Scorecard)
--   get_profit_day          -> combined (Orin daily)
-- get_profit_week / get_profit_week_breakdown already repointed (Dashboard).
-- snapshot_profit_current_week composes get_profit_week, so re-backfilling
-- refreshes the audit snapshots with FBA included.
--
-- W12 floor = 2026-03-16 (start of the Finance horizon; pre-W12 is noise).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_profit_history()
RETURNS TABLE (
  iso_year integer, iso_week integer, week_start date, week_end date,
  revenue numeric, qty bigint, order_count bigint, line_count bigint,
  courier_cost_total numeric, channel_fees_total numeric, cost_total numeric,
  profit numeric, por_pct numeric, aov numeric,
  good_count bigint, dirt_count bigint, missing_cost_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    ole.iso_year, ole.iso_week,
    MIN(ole.week_start), (MIN(ole.week_start) + INTERVAL '6 days')::date,
    COALESCE(SUM(ole.order_value), 0),
    COALESCE(SUM(ole.qty), 0)::bigint,
    COUNT(DISTINCT ole.mintsoft_order_id)::bigint,
    COUNT(*)::bigint,
    COALESCE(SUM(ole.courier_cost), 0),
    COALESCE(SUM(ole.channel_fee), 0),
    COALESCE(SUM(ole.cost_each * ole.qty), 0),
    COALESCE(SUM(ole.profit), 0),
    CASE WHEN SUM(ole.order_value * 1.2) > 0
      THEN ROUND((SUM(ole.profit) / SUM(ole.order_value * 1.2))::numeric, 6) ELSE NULL END,
    CASE WHEN COUNT(DISTINCT ole.mintsoft_order_id) > 0
      THEN ROUND((SUM(ole.order_value) / COUNT(DISTINCT ole.mintsoft_order_id))::numeric, 4) ELSE NULL END,
    COUNT(*) FILTER (WHERE ole.good_dirt = 'Good')::bigint,
    COUNT(*) FILTER (WHERE ole.good_dirt = 'Dirt')::bigint,
    COUNT(*) FILTER (WHERE ole.missing_cost)::bigint
  FROM public.order_economics_all ole
  WHERE ole.week_start >= '2026-03-16'::date
  GROUP BY ole.iso_year, ole.iso_week
  ORDER BY ole.iso_year, ole.iso_week;
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_history() TO anon, authenticated, service_role;

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
    FROM public.order_economics_all ole
    WHERE ole.week_start >= '2026-03-16'::date
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

CREATE OR REPLACE FUNCTION public.get_profit_day(
  p_date date DEFAULT ((now() AT TIME ZONE 'Europe/London')::date - 1)
)
RETURNS TABLE(day date, revenue numeric, orders bigint, profit numeric, por_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    p_date,
    COALESCE(SUM(order_value), 0)::numeric,
    COUNT(DISTINCT mintsoft_order_id)::bigint,
    COALESCE(SUM(profit), 0)::numeric,
    CASE WHEN SUM(order_value * 1.2) > 0
      THEN ROUND((SUM(profit) / SUM(order_value * 1.2))::numeric, 4) ELSE NULL END
  FROM public.order_economics_all
  WHERE order_date >= ((p_date::timestamp)       AT TIME ZONE 'Europe/London')
    AND order_date <  (((p_date + 1)::timestamp) AT TIME ZONE 'Europe/London');
$$;
GRANT EXECUTE ON FUNCTION public.get_profit_day(date) TO authenticated, anon, service_role;

-- Refresh the audit snapshots so past weeks include FBA (via get_profit_week).
SELECT public.backfill_profit_weekly_snapshots();
