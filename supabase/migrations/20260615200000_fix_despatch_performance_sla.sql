-- Fix get_despatch_performance — the Ops Dashboard SLA "Within 24/48/72h" buckets.
--
-- BUG: it sourced despatches from despatch_ledger, which is EMPTY (a dead feed), so
-- total_despatched was always 0 → every SLA bucket rendered 0.0%. (Warehouse's
-- On-Time % works because it uses order_status_history.)
--
-- FIX: source despatches from order_status_history (the canonical event log) — the
-- earliest DESPATCHED transition per order — and keep the same pairing with the
-- order's placement time and the same return shape (frontend untouched).
CREATE OR REPLACE FUNCTION public.get_despatch_performance(from_date date, to_date date)
RETURNS TABLE(within_24h bigint, within_48h bigint, within_72h bigint, total_despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH ledger AS (
    -- one despatch event per order: the earliest DESPATCHED transition in window (UK date)
    SELECT mintsoft_order_id, min(changed_at) AS despatched_at
    FROM order_status_history
    WHERE to_status = 'DESPATCHED'
      AND (changed_at AT TIME ZONE 'Europe/London')::date >= from_date
      AND (changed_at AT TIME ZONE 'Europe/London')::date <= to_date
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
