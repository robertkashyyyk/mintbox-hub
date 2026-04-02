
CREATE OR REPLACE FUNCTION public.get_ops_queue_counts()
 RETURNS TABLE(new_count bigint, awaiting_picking_count bigint, onbackorder_count bigint, despatched_today_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'NEW' AND last_seen_at > now() - interval '3 hours') as new_count,
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'AWAITINGPICKING' AND last_seen_at > now() - interval '3 hours') as awaiting_picking_count,
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'ONBACKORDER' AND last_seen_at > now() - interval '3 hours') as onbackorder_count,
    count(DISTINCT mintsoft_order_id) FILTER (WHERE order_status = 'DESPATCHED' AND last_status_change_at::date = CURRENT_DATE) as despatched_today_count
  FROM order_lines
  WHERE order_date >= '2026-01-01'::timestamptz;
$function$;

CREATE OR REPLACE FUNCTION public.get_despatch_performance(from_date date, to_date date)
 RETURNS TABLE(within_24h bigint, within_48h bigint, within_72h bigint, total_despatched bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH despatched_orders AS (
    SELECT DISTINCT ON (mintsoft_order_id)
      mintsoft_order_id,
      order_date,
      last_status_change_at
    FROM order_lines
    WHERE order_status = 'DESPATCHED'
      AND last_status_change_at IS NOT NULL
      AND last_status_change_at::date >= from_date
      AND last_status_change_at::date <= to_date
      AND order_date >= '2026-01-01'::timestamptz
    ORDER BY mintsoft_order_id, line_index
  )
  SELECT
    count(*) FILTER (WHERE EXTRACT(EPOCH FROM (last_status_change_at - order_date))/3600 <= 24) as within_24h,
    count(*) FILTER (WHERE EXTRACT(EPOCH FROM (last_status_change_at - order_date))/3600 <= 48) as within_48h,
    count(*) FILTER (WHERE EXTRACT(EPOCH FROM (last_status_change_at - order_date))/3600 <= 72) as within_72h,
    count(*) as total_despatched
  FROM despatched_orders;
$function$;
