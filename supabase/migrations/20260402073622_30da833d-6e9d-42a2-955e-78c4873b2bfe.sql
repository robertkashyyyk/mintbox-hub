
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
  -- Use archived snapshots for historical backorder/AP counts (AM slot preferred)
  snapshot_data AS (
    SELECT DISTINCT ON (capture_date_uk)
      capture_date_uk AS day,
      onbackorder_count,
      awaitingpicking_count
    FROM order_status_snapshots
    WHERE run_ok = true
      AND capture_date_uk >= from_date
      AND capture_date_uk <= to_date
    ORDER BY capture_date_uk, 
      CASE WHEN slot = 'PM' THEN 0 ELSE 1 END  -- prefer PM as end-of-day snapshot
  ),
  -- For today/recent days without snapshots, use live order_lines
  live_queue AS (
    SELECT 
      last_seen_at::date AS day,
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'ONBACKORDER') AS bo,
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'AWAITINGPICKING') AS ap
    FROM order_lines
    WHERE order_date >= '2026-01-01'::timestamptz
      AND last_seen_at::date >= from_date
      AND last_seen_at::date <= to_date
      AND last_seen_at > now() - interval '48 hours'
      AND order_status IN ('ONBACKORDER', 'AWAITINGPICKING')
    GROUP BY last_seen_at::date
  )
  SELECT
    ds.day,
    COALESCE(dn.cnt, 0) as new_orders,
    COALESCE(dd.cnt, 0) as despatched,
    COALESCE(sd.onbackorder_count::bigint, lq.bo, 0) as backorders,
    COALESCE(sd.awaitingpicking_count::bigint, lq.ap, 0) as awaiting_picking
  FROM date_series ds
  LEFT JOIN daily_new dn ON dn.day = ds.day
  LEFT JOIN daily_despatched dd ON dd.day = ds.day
  LEFT JOIN snapshot_data sd ON sd.day = ds.day
  LEFT JOIN live_queue lq ON lq.day = ds.day
  ORDER BY ds.day;
$function$;
