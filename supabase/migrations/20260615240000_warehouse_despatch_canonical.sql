-- Repoint the Warehouse Performance despatch RPCs onto the canonical despatch source
-- (v_despatch_events = despatch_ledger truth ∪ order_status_history backstop), so
-- Warehouse "Despatched Today" / hourly / on-time agree with the Ops Dashboard (~708)
-- instead of the order_status_history undercount (~431).

-- Hourly despatched today (Warehouse "Despatched Today" card = sum of these buckets).
CREATE OR REPLACE FUNCTION public.get_despatch_hourly_today()
RETURNS TABLE(hr timestamp with time zone, despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT date_trunc('hour', despatched_at AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AS hr,
         COUNT(*)::bigint AS despatched
  FROM public.v_despatch_events
  WHERE uk_date = (now() AT TIME ZONE 'Europe/London')::date
  GROUP BY 1 ORDER BY 1;
$function$;

-- Half-hourly despatched today.
CREATE OR REPLACE FUNCTION public.get_despatch_halfhourly_today()
RETURNS TABLE(slot timestamp with time zone, despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH lt AS (
    SELECT (despatched_at AT TIME ZONE 'Europe/London') AS t
    FROM public.v_despatch_events
    WHERE uk_date = (now() AT TIME ZONE 'Europe/London')::date
  )
  SELECT ((date_trunc('hour', t) + make_interval(mins => (EXTRACT(MINUTE FROM t)::int / 30) * 30))
            AT TIME ZONE 'Europe/London') AS slot,
         COUNT(*)::bigint AS despatched
  FROM lt GROUP BY 1 ORDER BY 1;
$function$;

-- On-time % today vs prior-7-day average. today_total = raw despatch count (708);
-- on_time = despatches whose placement→despatch was ≤24h (needs a known placement).
CREATE OR REPLACE FUNCTION public.get_despatch_today_vs_7d()
RETURNS TABLE(today_pct numeric, today_total bigint, today_on_time bigint, avg7_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ev AS (
    SELECT mintsoft_order_id, despatched_at, uk_date
    FROM public.v_despatch_events
    WHERE uk_date >= (now() AT TIME ZONE 'Europe/London')::date - 7
  ),
  oo AS (
    SELECT mintsoft_order_id, min(COALESCE(order_date, first_seen_at)) AS placed_at
    FROM order_lines
    WHERE mintsoft_order_id IN (SELECT mintsoft_order_id FROM ev)
      AND order_date >= '2026-01-01'::timestamptz
    GROUP BY mintsoft_order_id
  ),
  scored AS (
    SELECT ev.uk_date AS d_date,
           EXTRACT(EPOCH FROM (ev.despatched_at - oo.placed_at)) / 3600.0 AS hours
    FROM ev LEFT JOIN oo USING (mintsoft_order_id)
  ),
  today AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE hours IS NOT NULL AND hours <= 24)::bigint AS on_time
    FROM scored WHERE d_date = (now() AT TIME ZONE 'Europe/London')::date
  ),
  prior7 AS (
    SELECT COUNT(*)::bigint AS total,
           COUNT(*) FILTER (WHERE hours IS NOT NULL AND hours <= 24)::bigint AS on_time
    FROM scored
    WHERE d_date >= (now() AT TIME ZONE 'Europe/London')::date - 7
      AND d_date <  (now() AT TIME ZONE 'Europe/London')::date
  )
  SELECT
    CASE WHEN today.total > 0 THEN ROUND(100.0 * today.on_time / today.total, 1) ELSE NULL END,
    today.total, today.on_time,
    CASE WHEN prior7.total > 0 THEN ROUND(100.0 * prior7.on_time / prior7.total, 1) ELSE NULL END
  FROM today, prior7;
$$;
