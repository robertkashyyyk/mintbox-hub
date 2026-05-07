
CREATE OR REPLACE FUNCTION public.get_despatch_hourly_today()
RETURNS TABLE(hr timestamptz, despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH first_dispatch AS (
    SELECT mintsoft_order_id, MIN(changed_at) AS dispatched_at
    FROM order_status_history
    WHERE to_status = 'DESPATCHED'
      AND changed_at >= ((now() AT TIME ZONE 'Europe/London')::date) AT TIME ZONE 'Europe/London'
    GROUP BY mintsoft_order_id
  )
  SELECT date_trunc('hour', dispatched_at AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AS hr,
         COUNT(*)::bigint AS despatched
  FROM first_dispatch
  GROUP BY 1
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_despatch_hourly_today() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_despatch_today_vs_7d()
RETURNS TABLE(today_pct numeric, today_total bigint, today_on_time bigint, avg7_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH dispatched AS (
    SELECT DISTINCT ON (ol.mintsoft_order_id)
      ol.mintsoft_order_id,
      ol.order_date,
      h.changed_at AS dispatched_at
    FROM order_status_history h
    JOIN order_lines ol ON ol.mintsoft_order_id = h.mintsoft_order_id
    WHERE h.to_status = 'DESPATCHED'
      AND h.changed_at >= ((now() AT TIME ZONE 'Europe/London')::date - INTERVAL '7 days') AT TIME ZONE 'Europe/London'
    ORDER BY ol.mintsoft_order_id, h.changed_at ASC
  ),
  scored AS (
    SELECT
      (dispatched_at AT TIME ZONE 'Europe/London')::date AS d_date,
      EXTRACT(EPOCH FROM (dispatched_at - order_date)) / 3600.0 AS hours
    FROM dispatched
    WHERE order_date IS NOT NULL
  ),
  today AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE hours <= 24)::bigint AS on_time
    FROM scored
    WHERE d_date = (now() AT TIME ZONE 'Europe/London')::date
  ),
  prior7 AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE hours <= 24)::bigint AS on_time
    FROM scored
    WHERE d_date >= (now() AT TIME ZONE 'Europe/London')::date - 7
      AND d_date <  (now() AT TIME ZONE 'Europe/London')::date
  )
  SELECT
    CASE WHEN today.total > 0 THEN ROUND(100.0 * today.on_time / today.total, 1) ELSE NULL END AS today_pct,
    today.total AS today_total,
    today.on_time AS today_on_time,
    CASE WHEN prior7.total > 0 THEN ROUND(100.0 * prior7.on_time / prior7.total, 1) ELSE NULL END AS avg7_pct
  FROM today, prior7;
$$;

GRANT EXECUTE ON FUNCTION public.get_despatch_today_vs_7d() TO authenticated, anon;
