-- Fix get_queue_health_daily — the Despatch-KPIs "Daily flow" + cumulative drift.
--
-- BUG: "New" (the inflow side of drift) was taken from order_status_snapshots.new_count,
-- which (a) is a QUEUE DEPTH (orders sitting in NEW status at snapshot time), not orders
-- received, and (b) only started ~2026-06-04. Despatched came from order_status_history
-- (back to 2026-05-28). So drift = New − Despatched was 0 − (big) on every pre-04-Jun day,
-- snowballing the cumulative to a meaningless ~-7,164 while the backlog actually grew.
--
-- FIX: "New" now means orders RECEIVED that day = distinct orders by placement date from
-- order_lines (true inflow, full history). Despatched stays as distinct orders reaching
-- DESPATCHED from order_status_history. Both series are clamped to start when despatch
-- history begins, so drift is only computed where both sides are real. Backorder /
-- awaiting-picking stay as point-in-time queue depths from the snapshot (correctly).
-- Signature + columns unchanged so the frontend is untouched (new_count = received).

CREATE OR REPLACE FUNCTION public.get_queue_health_daily(
  from_date date,
  to_date date
)
RETURNS TABLE(
  day date,
  new_count integer,
  onbackorder_count integer,
  awaitingpicking_count integer,
  despatched integer,
  drift integer,
  drift_cumulative bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH bounds AS (
    -- Drift is only valid once despatch history exists; clamp the start so we never
    -- show received-with-no-despatch (or vice-versa) artefacts in the cumulative.
    SELECT GREATEST(
      from_date,
      COALESCE(
        (SELECT MIN((changed_at AT TIME ZONE 'Europe/London')::date)
         FROM order_status_history WHERE to_status = 'DESPATCHED'),
        from_date)
    ) AS start_day
  ),
  days AS (
    SELECT generate_series((SELECT start_day FROM bounds), to_date, interval '1 day')::date AS dt
  ),
  recv AS (
    SELECT order_date::date AS dt, COUNT(DISTINCT mintsoft_order_id) AS n
    FROM order_lines
    WHERE order_date::date >= (SELECT start_day FROM bounds)
      AND order_date::date <= to_date
    GROUP BY 1
  ),
  desp AS (
    SELECT (changed_at AT TIME ZONE 'Europe/London')::date AS dt,
           COUNT(DISTINCT mintsoft_order_id) AS d
    FROM order_status_history
    WHERE to_status = 'DESPATCHED'
      AND (changed_at AT TIME ZONE 'Europe/London')::date >= (SELECT start_day FROM bounds)
      AND (changed_at AT TIME ZONE 'Europe/London')::date <= to_date
    GROUP BY 1
  ),
  snap AS (
    SELECT DISTINCT ON (capture_date_uk)
      capture_date_uk AS dt, onbackorder_count, awaitingpicking_count
    FROM order_status_snapshots
    WHERE run_ok = true
      AND capture_date_uk >= (SELECT start_day FROM bounds)
      AND capture_date_uk <= to_date
    ORDER BY capture_date_uk, (slot = 'PM') DESC, captured_at DESC
  ),
  joined AS (
    SELECT
      days.dt AS day,
      COALESCE(recv.n, 0)::int AS new_count,
      COALESCE(snap.onbackorder_count, 0)::int AS onbackorder_count,
      COALESCE(snap.awaitingpicking_count, 0)::int AS awaitingpicking_count,
      COALESCE(desp.d, 0)::int AS despatched,
      (COALESCE(recv.n, 0) - COALESCE(desp.d, 0))::int AS drift
    FROM days
    LEFT JOIN recv ON recv.dt = days.dt
    LEFT JOIN desp ON desp.dt = days.dt
    LEFT JOIN snap ON snap.dt = days.dt
  )
  SELECT
    day, new_count, onbackorder_count, awaitingpicking_count, despatched, drift,
    SUM(drift) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING)::bigint AS drift_cumulative
  FROM joined
  ORDER BY day;
$$;

-- ── Unify "despatched today" on the canonical event log ──────────────────────
-- get_ops_queue_counts.despatched_today_count read order_lines.order_status (the
-- CURRENT state, which lags because status updates are best-effort) → the Ops
-- Dashboard showed ~121 while Warehouse/Despatch-KPIs (order_status_history) showed
-- ~422-431. Repoint just the despatched count to order_status_history so every
-- dashboard agrees. Queue depths (NEW/AWAITING/BACKORDER) stay live from order_lines
-- — they're the most granular current-queue source.
CREATE OR REPLACE FUNCTION public.get_ops_queue_counts()
 RETURNS TABLE(new_count bigint, awaiting_picking_count bigint, onbackorder_count bigint, despatched_today_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'NEW') AS new_count,
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'AWAITINGPICKING') AS awaiting_picking_count,
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'ONBACKORDER') AS onbackorder_count
    FROM order_lines
    WHERE order_date >= '2026-01-01'::timestamptz
  ),
  d AS (
    SELECT count(DISTINCT mintsoft_order_id) AS despatched_today_count
    FROM order_status_history
    WHERE to_status = 'DESPATCHED'
      AND (changed_at AT TIME ZONE 'Europe/London')::date = (now() AT TIME ZONE 'Europe/London')::date
  )
  SELECT q.new_count, q.awaiting_picking_count, q.onbackorder_count, d.despatched_today_count
  FROM q CROSS JOIN d;
$function$;
