-- Pace + banding engine (scorecard-banding spec §3–§5). Compares PartsDocHub actuals
-- (order_line_economics, Hub/FBM lane) against the pace-adjusted target lines for a grain,
-- and emits the tier/variance the scorecard exposes and Orin narrates (Orin never recomputes).
--
-- actual_to_date vs expected_to_date over the SAME days [start, asof]. Banding b=0.025.
-- Single days are NOT tiered (volatile) — raw variance only (spec §4 grain rule).
--
-- VERIFY banding (spec §8) after applying — feed synthetic actuals or check a live grain:
--   SELECT grain, metric, actual, exp_primary, exp_stretch, exp_ultimate, tier
--   FROM get_target_pace('mtd');

CREATE OR REPLACE FUNCTION public.get_target_pace(
  p_grain text DEFAULT 'mtd',
  p_asof  date DEFAULT (now() AT TIME ZONE 'Europe/London')::date
)
RETURNS TABLE(
  grain text, period_label text, metric text,
  actual numeric, exp_primary numeric, exp_stretch numeric, exp_ultimate numeric,
  tier text, tier_label text, nearest_line text,
  variance_vs_primary_pct numeric, variance_abs numeric, volatile boolean, partial_cost boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH params AS (
    SELECT p_grain AS grain, p_asof AS asof, 0.025::numeric AS b,
      CASE p_grain
        WHEN 'day'     THEN p_asof
        WHEN 'week'    THEN p_asof - 6
        WHEN 'mtd'     THEN date_trunc('month',   p_asof)::date
        WHEN 'quarter' THEN date_trunc('quarter', p_asof)::date
        WHEN 'ytd'     THEN date_trunc('year',    p_asof)::date
        ELSE date_trunc('month', p_asof)::date
      END AS start
  ),
  act AS (
    SELECT
      COALESCE(SUM(ole.order_value), 0)::numeric        AS revenue,
      COUNT(DISTINCT ole.mintsoft_order_id)::numeric    AS orders,
      COALESCE(SUM(ole.profit), 0)::numeric             AS gross,
      COALESCE(bool_or(ole.missing_cost), false)        AS partial_cost
    FROM order_line_economics ole, params p
    WHERE ole.order_date >= (p.start::timestamp        AT TIME ZONE 'Europe/London')
      AND ole.order_date <  ((p.asof + 1)::timestamp   AT TIME ZONE 'Europe/London')
  ),
  exp AS (
    SELECT st.metric,
      SUM(st.target_value) FILTER (WHERE st.goal='primary')  AS p,
      SUM(st.target_value) FILTER (WHERE st.goal='stretch')  AS s,
      SUM(st.target_value) FILTER (WHERE st.goal='ultimate') AS u
    FROM scorecard_targets st, params pr
    WHERE st.target_date BETWEEN pr.start AND pr.asof
    GROUP BY st.metric
  ),
  rows AS (
    SELECT m.metric,
      CASE m.metric WHEN 'revenue' THEN act.revenue WHEN 'gross' THEN act.gross ELSE act.orders END AS actual,
      e.p, e.s, e.u, act.partial_cost
    FROM (VALUES ('revenue'),('gross'),('orders')) m(metric)
    CROSS JOIN act
    LEFT JOIN exp e ON e.metric = m.metric
  )
  SELECT
    pr.grain,
    CASE pr.grain
      WHEN 'day'     THEN to_char(pr.asof,'DD Mon')
      WHEN 'week'    THEN '7 days to '||to_char(pr.asof,'DD Mon')
      WHEN 'mtd'     THEN to_char(pr.asof,'Mon')||' MTD'
      WHEN 'quarter' THEN 'Q'||to_char(pr.asof,'Q')||' to date'
      WHEN 'ytd'     THEN to_char(pr.asof,'YYYY')||' YTD'
      ELSE pr.grain END AS period_label,
    r.metric, r.actual, r.p, r.s, r.u,
    CASE WHEN pr.grain='day' OR r.p IS NULL THEN NULL
      WHEN r.actual <  r.p*(1-pr.b) THEN 'below_primary'
      WHEN r.actual <= r.p*(1+pr.b) THEN 'on_primary'
      WHEN r.actual <  r.s*(1-pr.b) THEN 'firmly_primary'
      WHEN r.actual <= r.s*(1+pr.b) THEN 'on_stretch'
      WHEN r.actual <  r.u*(1-pr.b) THEN 'firmly_stretch'
      WHEN r.actual <= r.u*(1+pr.b) THEN 'on_ultimate'
      ELSE 'above_ultimate' END AS tier,
    CASE WHEN pr.grain='day' OR r.p IS NULL THEN NULL
      WHEN r.actual <  r.p*(1-pr.b) THEN 'Behind Primary pace'
      WHEN r.actual <= r.p*(1+pr.b) THEN 'Primary met, on the line'
      WHEN r.actual <  r.s*(1-pr.b) THEN 'Primary secured, building toward Stretch'
      WHEN r.actual <= r.s*(1+pr.b) THEN 'Stretch met'
      WHEN r.actual <  r.u*(1-pr.b) THEN 'Stretch secured, building toward Ultimate'
      WHEN r.actual <= r.u*(1+pr.b) THEN 'Ultimate met'
      ELSE 'Beyond Ultimate' END AS tier_label,
    CASE WHEN r.p IS NULL THEN NULL
      WHEN r.actual >= r.u THEN 'ultimate'
      WHEN r.actual >= r.s THEN 'stretch'
      ELSE 'primary' END AS nearest_line,
    CASE WHEN r.p IS NULL OR r.p = 0 THEN NULL ELSE ROUND(((r.actual - r.p)/r.p)::numeric, 4) END AS variance_vs_primary_pct,
    CASE WHEN r.p IS NULL THEN NULL ELSE ROUND((r.actual - r.p)::numeric, 2) END AS variance_abs,
    (pr.grain = 'day') AS volatile,
    (r.metric = 'gross' AND r.partial_cost) AS partial_cost
  FROM rows r CROSS JOIN params pr;
$$;
GRANT EXECUTE ON FUNCTION public.get_target_pace(text, date) TO authenticated, anon, service_role;
