-- Live current-week AOV for Orin. Applied live via MCP apply_migration 2026-07-09; kept for VC.
--
-- The scorecard's aov_gbp only carries COMPLETED weeks (weekly snapshot cron), so mid-week the
-- reported AOV lags a week (e.g. showed W27 £19.00 while W28 was live at £20.54). AOV is a
-- per-order average, so a partial week IS representative — this returns the live current-week
-- figure + the WoW move so Orin can lead the AOV story with where it is RIGHT NOW.
CREATE OR REPLACE FUNCTION public.get_aov_now()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '10s'
AS $$
  WITH wk AS (
    SELECT EXTRACT(ISOYEAR FROM (now() AT TIME ZONE 'Europe/London'))::int AS y,
           EXTRACT(WEEK    FROM (now() AT TIME ZONE 'Europe/London'))::int AS w
  ),
  cur AS (
    SELECT COALESCE(SUM(order_value),0) AS rev, COUNT(DISTINCT mintsoft_order_id) AS ord
    FROM order_economics_all, wk
    WHERE EXTRACT(ISOYEAR FROM order_date)::int = wk.y
      AND EXTRACT(WEEK    FROM order_date)::int = wk.w
  ),
  prev AS (
    SELECT aov, iso_year, iso_week FROM profit_weekly_snapshots
    ORDER BY iso_year DESC, iso_week DESC LIMIT 1
  )
  SELECT jsonb_build_object(
    'current_week',        (SELECT wk.y||'-W'||lpad(wk.w::text,2,'0') FROM wk),
    'partial',             true,
    'current_week_aov',    (SELECT round((rev/NULLIF(ord,0))::numeric,2) FROM cur),
    'orders_so_far',       (SELECT ord FROM cur),
    'last_completed_week', (SELECT iso_year||'-W'||lpad(iso_week::text,2,'0') FROM prev),
    'last_completed_aov',  (SELECT round(aov::numeric,2) FROM prev),
    'wow_delta',           (SELECT round(((SELECT rev/NULLIF(ord,0) FROM cur) - (SELECT aov FROM prev))::numeric,2))
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_aov_now() TO authenticated, anon, service_role;
