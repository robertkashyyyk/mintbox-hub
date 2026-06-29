-- ============================================================================
-- 20260629160000_get_profit_history_live.sql
-- Live per-week profit history for the Profit — Graphs page, so the chart +
-- KPI tiles can never drift from the live week page / segmentation cards.
--
-- Previously the graph read frozen profit_weekly_snapshots, which only
-- auto-refresh the CURRENT week — so once a week passed, later cost corrections
-- (missing-cost backfill, suspect-cost fixes, fee/courier recalcs) left the
-- snapshot stale and disagreeing with get_profit_week. (e.g. 2026-W26 snapshot
-- froze cost £2,800 high → profit £15,231 vs live £18,031.)
--
-- get_profit_history() runs the EXACT same aggregation as get_profit_week,
-- grouped by ISO week across all of order_line_economics. Same column shape as
-- get_profit_week so the page is a drop-in. The band-mix chart already computes
-- live via get_profit_band_history; this brings revenue/profit/POR into line.
--
-- profit_weekly_snapshots + snapshot_profit_week/backfill are kept for audit
-- (a frozen record of what each week looked like at snapshot time) but no
-- longer drive the display.
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
    ole.iso_year,
    ole.iso_week,
    MIN(ole.week_start),
    (MIN(ole.week_start) + INTERVAL '6 days')::date,
    COALESCE(SUM(ole.order_value), 0),
    COALESCE(SUM(ole.qty), 0)::bigint,
    COUNT(DISTINCT ole.mintsoft_order_id)::bigint,
    COUNT(*)::bigint,
    COALESCE(SUM(ole.courier_cost), 0),
    COALESCE(SUM(ole.channel_fee), 0),
    COALESCE(SUM(ole.cost_each * ole.qty), 0),
    COALESCE(SUM(ole.profit), 0),
    CASE WHEN SUM(ole.order_value * 1.2) > 0
      THEN ROUND((SUM(ole.profit) / SUM(ole.order_value * 1.2))::numeric, 6)
      ELSE NULL END,
    CASE WHEN COUNT(DISTINCT ole.mintsoft_order_id) > 0
      THEN ROUND((SUM(ole.order_value) / COUNT(DISTINCT ole.mintsoft_order_id))::numeric, 4)
      ELSE NULL END,
    COUNT(*) FILTER (WHERE ole.good_dirt = 'Good')::bigint,
    COUNT(*) FILTER (WHERE ole.good_dirt = 'Dirt')::bigint,
    COUNT(*) FILTER (WHERE ole.missing_cost)::bigint
  FROM public.order_line_economics ole
  GROUP BY ole.iso_year, ole.iso_week
  ORDER BY ole.iso_year, ole.iso_week;
$$;

GRANT EXECUTE ON FUNCTION public.get_profit_history() TO anon, authenticated, service_role;
