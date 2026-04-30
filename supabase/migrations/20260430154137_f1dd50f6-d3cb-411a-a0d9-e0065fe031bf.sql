-- Drop the 3-hour staleness filter so dashboard counters reflect real queue state.
-- The live-tail sync rotates through ~11.8k non-terminal orders and cannot touch every row inside 3h.

CREATE OR REPLACE FUNCTION public.get_ops_queue_counts()
 RETURNS TABLE(new_count bigint, awaiting_picking_count bigint, onbackorder_count bigint, despatched_today_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'NEW') as new_count,
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'AWAITINGPICKING') as awaiting_picking_count,
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'ONBACKORDER') as onbackorder_count,
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'DESPATCHED' AND last_status_change_at::date = CURRENT_DATE) as despatched_today_count
  FROM order_lines
  WHERE order_date >= '2026-01-01'::timestamptz;
$function$;

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