
-- Stage ageing: median and average age by status
CREATE OR REPLACE FUNCTION public.get_ops_stage_ageing()
RETURNS TABLE(status text, order_count bigint, avg_age_hours numeric, median_age_hours numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ages AS (
    SELECT DISTINCT ON (mintsoft_order_id)
      order_status,
      EXTRACT(EPOCH FROM (now() - last_status_change_at)) / 3600.0 AS age_hours
    FROM order_lines
    WHERE order_status IN ('NEW', 'AWAITINGPICKING', 'ONBACKORDER')
      AND last_seen_at > now() - interval '3 hours'
      AND order_date >= '2026-01-01'::timestamptz
    ORDER BY mintsoft_order_id, line_index
  )
  SELECT
    order_status as status,
    count(*) as order_count,
    round(avg(age_hours)::numeric, 1) as avg_age_hours,
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY age_hours)::numeric, 1) as median_age_hours
  FROM ages
  GROUP BY order_status;
$function$;

-- Daily trend data for charts
CREATE OR REPLACE FUNCTION public.get_ops_daily_trend(from_date date, to_date date)
RETURNS TABLE(day date, new_orders bigint, despatched bigint, backorders bigint, awaiting_picking bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH date_series AS (
    SELECT generate_series(from_date, to_date, '1 day'::interval)::date AS day
  ),
  daily_new AS (
    SELECT order_date::date AS day, count(DISTINCT mintsoft_order_id) AS cnt
    FROM order_lines
    WHERE order_date::date >= from_date AND order_date::date <= to_date
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY order_date::date
  ),
  daily_despatched AS (
    SELECT last_status_change_at::date AS day, count(DISTINCT mintsoft_order_id) AS cnt
    FROM order_lines
    WHERE order_status = 'DESPATCHED'
      AND last_status_change_at IS NOT NULL
      AND last_status_change_at::date >= from_date
      AND last_status_change_at::date <= to_date
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY last_status_change_at::date
  ),
  -- For backorders/awaiting picking we use snapshot data if available, otherwise 0
  daily_snapshot AS (
    SELECT capture_date_uk AS day, onbackorder_count, awaitingpicking_count
    FROM order_status_snapshots
    WHERE run_ok = true
      AND capture_date_uk >= from_date
      AND capture_date_uk <= to_date
      AND slot = 'AM'
  )
  SELECT
    ds.day,
    COALESCE(dn.cnt, 0) as new_orders,
    COALESCE(dd.cnt, 0) as despatched,
    COALESCE(dsn.onbackorder_count::bigint, 0) as backorders,
    COALESCE(dsn.awaitingpicking_count::bigint, 0) as awaiting_picking
  FROM date_series ds
  LEFT JOIN daily_new dn ON dn.day = ds.day
  LEFT JOIN daily_despatched dd ON dd.day = ds.day
  LEFT JOIN daily_snapshot dsn ON dsn.day = ds.day
  ORDER BY ds.day;
$function$;

-- Hourly flow for today
CREATE OR REPLACE FUNCTION public.get_ops_hourly_flow()
RETURNS TABLE(hour_of_day int, new_orders bigint, despatched bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH hours AS (
    SELECT generate_series(0, 23) AS hour_of_day
  ),
  hourly_new AS (
    SELECT EXTRACT(HOUR FROM order_date)::int AS hr, count(DISTINCT mintsoft_order_id) AS cnt
    FROM order_lines
    WHERE order_date::date = CURRENT_DATE
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY EXTRACT(HOUR FROM order_date)::int
  ),
  hourly_despatched AS (
    SELECT EXTRACT(HOUR FROM last_status_change_at)::int AS hr, count(DISTINCT mintsoft_order_id) AS cnt
    FROM order_lines
    WHERE order_status = 'DESPATCHED'
      AND last_status_change_at::date = CURRENT_DATE
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY EXTRACT(HOUR FROM last_status_change_at)::int
  )
  SELECT
    h.hour_of_day,
    COALESCE(hn.cnt, 0) as new_orders,
    COALESCE(hd.cnt, 0) as despatched
  FROM hours h
  LEFT JOIN hourly_new hn ON hn.hr = h.hour_of_day
  LEFT JOIN hourly_despatched hd ON hd.hr = h.hour_of_day
  WHERE h.hour_of_day <= EXTRACT(HOUR FROM now())::int
  ORDER BY h.hour_of_day;
$function$;

-- Top problem SKUs
CREATE OR REPLACE FUNCTION public.get_ops_sku_issues(lim int DEFAULT 20)
RETURNS TABLE(sku text, brand_id uuid, total_issues bigint, critical_count bigint, problem_types text[], latest_issue timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    oi.sku,
    oi.brand_id,
    count(*) as total_issues,
    count(*) FILTER (WHERE severity = 'critical') as critical_count,
    array_agg(DISTINCT problem_type) as problem_types,
    max(last_problem_seen_at) as latest_issue
  FROM order_issues oi
  WHERE issue_status NOT IN ('resolved', 'ignored', 'auto_resolved')
    AND is_suppressed = false
  GROUP BY oi.sku, oi.brand_id
  ORDER BY count(*) DESC
  LIMIT lim;
$function$;
