
-- 1. Backfill NULL last_status_change_at
UPDATE order_lines
SET last_status_change_at = COALESCE(first_seen_at, created_at)
WHERE last_status_change_at IS NULL;

-- 2. Rewrite get_ops_daily_trend to use order_lines instead of snapshots
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
  -- Derive backorder/AP counts from order_lines directly
  -- For each day, count orders that were last seen on that day in that status
  daily_backorders AS (
    SELECT last_seen_at::date AS day, count(DISTINCT mintsoft_order_id) AS cnt
    FROM order_lines
    WHERE order_status = 'ONBACKORDER'
      AND order_date >= '2026-01-01'::timestamptz
      AND last_seen_at::date >= from_date
      AND last_seen_at::date <= to_date
    GROUP BY last_seen_at::date
  ),
  daily_awaiting AS (
    SELECT last_seen_at::date AS day, count(DISTINCT mintsoft_order_id) AS cnt
    FROM order_lines
    WHERE order_status = 'AWAITINGPICKING'
      AND order_date >= '2026-01-01'::timestamptz
      AND last_seen_at::date >= from_date
      AND last_seen_at::date <= to_date
    GROUP BY last_seen_at::date
  )
  SELECT
    ds.day,
    COALESCE(dn.cnt, 0) as new_orders,
    COALESCE(dd.cnt, 0) as despatched,
    COALESCE(db.cnt, 0) as backorders,
    COALESCE(da.cnt, 0) as awaiting_picking
  FROM date_series ds
  LEFT JOIN daily_new dn ON dn.day = ds.day
  LEFT JOIN daily_despatched dd ON dd.day = ds.day
  LEFT JOIN daily_backorders db ON db.day = ds.day
  LEFT JOIN daily_awaiting da ON da.day = ds.day
  ORDER BY ds.day;
$function$;
