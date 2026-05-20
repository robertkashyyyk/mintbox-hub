-- Trustworthy weekly/daily despatch metrics: switch to despatch_ledger as the
-- canonical source of "when was this order first despatched".
-- 
-- Previous behaviour read last_status_change_at on DESPATCHED order_lines,
-- which (1) re-counted orders every time they bounced back into DESPATCHED
-- after a status flip, and (2) clustered spurious despatches at whatever
-- minute a re-sync touched them. despatch_ledger captures the first
-- despatched_at per mintsoft_order_id and never moves, so day/hour buckets
-- are stable.

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
  -- Canonical despatch source: one stable row per order per UK day
  daily_despatched AS (
    SELECT uk_date AS day, count(DISTINCT mintsoft_order_id) AS cnt
    FROM despatch_ledger
    WHERE uk_date >= from_date AND uk_date <= to_date
    GROUP BY uk_date
  ),
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
      CASE WHEN slot = 'PM' THEN 0 ELSE 1 END
  ),
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

CREATE OR REPLACE FUNCTION public.get_despatch_performance(from_date date, to_date date)
RETURNS TABLE(within_24h bigint, within_48h bigint, within_72h bigint, total_despatched bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Pair each ledger despatch with that order's earliest order_date from
  -- order_lines (first_seen_at fallback). One row per mintsoft_order_id.
  WITH ledger AS (
    SELECT mintsoft_order_id, min(despatched_at) AS despatched_at, min(uk_date) AS uk_date
    FROM despatch_ledger
    WHERE uk_date >= from_date AND uk_date <= to_date
    GROUP BY mintsoft_order_id
  ),
  order_origin AS (
    SELECT mintsoft_order_id,
           min(COALESCE(order_date, first_seen_at)) AS placed_at
    FROM order_lines
    WHERE mintsoft_order_id IN (SELECT mintsoft_order_id FROM ledger)
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY mintsoft_order_id
  ),
  paired AS (
    SELECT l.mintsoft_order_id,
           EXTRACT(EPOCH FROM (l.despatched_at - o.placed_at))/3600 AS hours
    FROM ledger l
    JOIN order_origin o USING (mintsoft_order_id)
    WHERE o.placed_at IS NOT NULL
      AND l.despatched_at >= o.placed_at
  )
  SELECT
    count(*) FILTER (WHERE hours <= 24) AS within_24h,
    count(*) FILTER (WHERE hours <= 48) AS within_48h,
    count(*) FILTER (WHERE hours <= 72) AS within_72h,
    count(*) AS total_despatched
  FROM paired;
$function$;