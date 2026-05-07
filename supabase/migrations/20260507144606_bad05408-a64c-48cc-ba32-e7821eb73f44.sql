CREATE OR REPLACE FUNCTION public.get_status_snapshots_hourly_today()
RETURNS TABLE(hr timestamptz, new_count bigint, awaiting_count bigint, backorder_count bigint, picked_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH bucketed AS (
    SELECT
      date_trunc('hour', captured_at AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AS hr,
      status,
      count,
      captured_at,
      ROW_NUMBER() OVER (
        PARTITION BY date_trunc('hour', captured_at AT TIME ZONE 'Europe/London'), status
        ORDER BY captured_at DESC
      ) AS rn
    FROM mintsoft_status_snapshots
    WHERE captured_at >= ((now() AT TIME ZONE 'Europe/London')::date) AT TIME ZONE 'Europe/London'
  )
  SELECT
    hr,
    COALESCE(SUM(count) FILTER (WHERE status = 'NEW'), 0)::bigint AS new_count,
    COALESCE(SUM(count) FILTER (WHERE status = 'AWAITINGPICKING'), 0)::bigint AS awaiting_count,
    COALESCE(SUM(count) FILTER (WHERE status = 'ONBACKORDER'), 0)::bigint AS backorder_count,
    COALESCE(SUM(count) FILTER (WHERE status = 'PICKED'), 0)::bigint AS picked_count
  FROM bucketed
  WHERE rn = 1
  GROUP BY hr
  ORDER BY hr;
$$;

GRANT EXECUTE ON FUNCTION public.get_status_snapshots_hourly_today() TO authenticated, service_role;