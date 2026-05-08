
CREATE OR REPLACE FUNCTION public.get_despatch_hourly_today()
RETURNS TABLE(hr timestamp with time zone, despatched bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH today_start AS (
    SELECT ((now() AT TIME ZONE 'Europe/London')::date) AT TIME ZONE 'Europe/London' AS d
  ),
  hist AS (
    SELECT mintsoft_order_id, MIN(changed_at) AS dispatched_at
    FROM order_status_history, today_start
    WHERE to_status = 'DESPATCHED' AND changed_at >= d
    GROUP BY mintsoft_order_id
  ),
  ghost AS (
    SELECT ol.mintsoft_order_id, MIN(ol.last_status_change_at) AS dispatched_at
    FROM order_lines ol, today_start
    WHERE ol.order_status = 'DESPATCHED'
      AND ol.last_status_change_at >= d
      AND NOT EXISTS (SELECT 1 FROM hist h WHERE h.mintsoft_order_id = ol.mintsoft_order_id)
    GROUP BY ol.mintsoft_order_id
  ),
  combined AS (
    SELECT mintsoft_order_id, dispatched_at FROM hist
    UNION ALL
    SELECT mintsoft_order_id, dispatched_at FROM ghost
  )
  SELECT date_trunc('hour', dispatched_at AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AS hr,
         COUNT(*)::bigint AS despatched
  FROM combined
  GROUP BY 1
  ORDER BY 1;
$function$;
