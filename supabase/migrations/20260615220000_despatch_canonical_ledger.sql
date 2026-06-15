-- Canonical despatch source = despatch_ledger (poll-despatched-today, which queries
-- Mintsoft's despatched orders directly = ground truth ~704/day) with order_status_history
-- as the historical backstop (the ledger only holds today onward until it accrues history).
--
-- Background: poll-despatched-today had verify_jwt=true but the cron called it with only an
-- apikey header → 401 every run → it never populated despatch_ledger. With that fixed
-- (verify_jwt off), the ledger is accurate again. order_status_history undercounts despatches
-- (the sync only records transitions it observes), so prefer the ledger per order.

-- One despatch event per order, preferring the ledger (src=1) over history (src=2).
CREATE OR REPLACE VIEW public.v_despatch_events AS
  SELECT mintsoft_order_id, despatched_at, uk_date
  FROM (
    SELECT mintsoft_order_id, despatched_at, uk_date,
           row_number() OVER (PARTITION BY mintsoft_order_id ORDER BY src) AS rn
    FROM (
      SELECT mintsoft_order_id, MIN(despatched_at) AS despatched_at, MIN(uk_date) AS uk_date, 1 AS src
      FROM public.despatch_ledger GROUP BY mintsoft_order_id
      UNION ALL
      SELECT mintsoft_order_id, MIN(changed_at) AS despatched_at,
             MIN((changed_at AT TIME ZONE 'Europe/London')::date) AS uk_date, 2 AS src
      FROM public.order_status_history WHERE to_status = 'DESPATCHED' GROUP BY mintsoft_order_id
    ) u
  ) z WHERE rn = 1;
ALTER VIEW public.v_despatch_events SET (security_invoker = on);
GRANT SELECT ON public.v_despatch_events TO anon, authenticated, service_role;

-- ── Daily flow + cumulative drift (received in vs despatched out) ─────────────
CREATE OR REPLACE FUNCTION public.get_queue_health_daily(from_date date, to_date date)
RETURNS TABLE(
  day date, new_count integer, onbackorder_count integer,
  awaitingpicking_count integer, despatched integer, drift integer, drift_cumulative bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH bounds AS (
    SELECT GREATEST(from_date,
      COALESCE((SELECT MIN(uk_date) FROM public.v_despatch_events), from_date)) AS start_day
  ),
  days AS (SELECT generate_series((SELECT start_day FROM bounds), to_date, interval '1 day')::date AS dt),
  recv AS (
    SELECT order_date::date AS dt, COUNT(DISTINCT mintsoft_order_id) AS n
    FROM order_lines
    WHERE order_date::date >= (SELECT start_day FROM bounds) AND order_date::date <= to_date
    GROUP BY 1
  ),
  desp AS (
    SELECT uk_date AS dt, COUNT(*) AS d
    FROM public.v_despatch_events
    WHERE uk_date >= (SELECT start_day FROM bounds) AND uk_date <= to_date
    GROUP BY 1
  ),
  snap AS (
    SELECT DISTINCT ON (capture_date_uk) capture_date_uk AS dt, onbackorder_count, awaitingpicking_count
    FROM order_status_snapshots
    WHERE run_ok = true AND capture_date_uk >= (SELECT start_day FROM bounds) AND capture_date_uk <= to_date
    ORDER BY capture_date_uk, (slot = 'PM') DESC, captured_at DESC
  ),
  joined AS (
    SELECT days.dt AS day,
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
  SELECT day, new_count, onbackorder_count, awaitingpicking_count, despatched, drift,
    SUM(drift) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING)::bigint AS drift_cumulative
  FROM joined ORDER BY day;
$$;

-- ── Ops queue counts: despatched_today from the canonical despatch events ─────
CREATE OR REPLACE FUNCTION public.get_ops_queue_counts()
 RETURNS TABLE(new_count bigint, awaiting_picking_count bigint, onbackorder_count bigint, despatched_today_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH q AS (
    SELECT
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'NEW') AS new_count,
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'AWAITINGPICKING') AS awaiting_picking_count,
      count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'ONBACKORDER') AS onbackorder_count
    FROM order_lines WHERE order_date >= '2026-01-01'::timestamptz
  ),
  d AS (
    SELECT count(*) AS despatched_today_count
    FROM public.v_despatch_events
    WHERE uk_date = (now() AT TIME ZONE 'Europe/London')::date
  )
  SELECT q.new_count, q.awaiting_picking_count, q.onbackorder_count, d.despatched_today_count
  FROM q CROSS JOIN d;
$function$;

-- ── SLA buckets: pair canonical despatch events with order placement ─────────
CREATE OR REPLACE FUNCTION public.get_despatch_performance(from_date date, to_date date)
RETURNS TABLE(within_24h bigint, within_48h bigint, within_72h bigint, total_despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT mintsoft_order_id, despatched_at
    FROM public.v_despatch_events
    WHERE uk_date >= from_date AND uk_date <= to_date
  ),
  order_origin AS (
    SELECT mintsoft_order_id, min(COALESCE(order_date, first_seen_at)) AS placed_at
    FROM order_lines
    WHERE mintsoft_order_id IN (SELECT mintsoft_order_id FROM ev)
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY mintsoft_order_id
  ),
  paired AS (
    SELECT EXTRACT(EPOCH FROM (ev.despatched_at - o.placed_at))/3600 AS hours
    FROM ev JOIN order_origin o USING (mintsoft_order_id)
    WHERE o.placed_at IS NOT NULL AND ev.despatched_at >= o.placed_at
  )
  SELECT
    count(*) FILTER (WHERE hours <= 24) AS within_24h,
    count(*) FILTER (WHERE hours <= 48) AS within_48h,
    count(*) FILTER (WHERE hours <= 72) AS within_72h,
    count(*) AS total_despatched
  FROM paired;
$function$;
