-- Despatch performance reporting functions

CREATE OR REPLACE FUNCTION public.get_despatch_channels()
RETURNS TABLE(channel text, despatched_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(channel, '(unknown)') AS channel,
    count(DISTINCT mintsoft_order_id) AS despatched_count
  FROM order_lines
  WHERE order_status = 'DESPATCHED'
    AND order_date >= '2026-01-01'::timestamptz
  GROUP BY COALESCE(channel, '(unknown)')
  ORDER BY despatched_count DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_despatch_performance_buckets(
  from_date date,
  to_date date,
  bucket text DEFAULT 'month',
  channels text[] DEFAULT NULL
)
RETURNS TABLE(
  bucket_start date,
  channel text,
  total bigint,
  under_6h bigint,
  under_12h bigint,
  under_24h bigint,
  under_36h bigint,
  under_48h bigint,
  under_72h bigint,
  over_72h bigint,
  median_hours numeric,
  mean_hours numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH despatched AS (
    SELECT DISTINCT ON (mintsoft_order_id)
      mintsoft_order_id,
      COALESCE(channel, '(unknown)') AS channel,
      last_status_change_at,
      EXTRACT(EPOCH FROM (last_status_change_at - order_date)) / 3600.0 AS hours
    FROM order_lines
    WHERE order_status = 'DESPATCHED'
      AND last_status_change_at IS NOT NULL
      AND order_date >= '2026-01-01'::timestamptz
      AND last_status_change_at::date >= from_date
      AND last_status_change_at::date <= to_date
      AND (channels IS NULL OR COALESCE(channel, '(unknown)') = ANY(channels))
    ORDER BY mintsoft_order_id, line_index
  ),
  bucketed AS (
    SELECT
      CASE bucket
        WHEN 'day'     THEN date_trunc('day',     last_status_change_at)::date
        WHEN 'week'    THEN date_trunc('week',    last_status_change_at)::date
        WHEN 'quarter' THEN date_trunc('quarter', last_status_change_at)::date
        ELSE                date_trunc('month',   last_status_change_at)::date
      END AS bucket_start,
      channel,
      hours
    FROM despatched
  ),
  -- Per channel rows
  per_channel AS (
    SELECT
      bucket_start,
      channel,
      count(*) AS total,
      count(*) FILTER (WHERE hours <= 6)  AS under_6h,
      count(*) FILTER (WHERE hours <= 12) AS under_12h,
      count(*) FILTER (WHERE hours <= 24) AS under_24h,
      count(*) FILTER (WHERE hours <= 36) AS under_36h,
      count(*) FILTER (WHERE hours <= 48) AS under_48h,
      count(*) FILTER (WHERE hours <= 72) AS under_72h,
      count(*) FILTER (WHERE hours >  72) AS over_72h,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY hours)::numeric, 2) AS median_hours,
      round(avg(hours)::numeric, 2) AS mean_hours
    FROM bucketed
    GROUP BY bucket_start, channel
  ),
  -- Grand total per bucket (channel = NULL marker)
  totals AS (
    SELECT
      bucket_start,
      NULL::text AS channel,
      count(*) AS total,
      count(*) FILTER (WHERE hours <= 6)  AS under_6h,
      count(*) FILTER (WHERE hours <= 12) AS under_12h,
      count(*) FILTER (WHERE hours <= 24) AS under_24h,
      count(*) FILTER (WHERE hours <= 36) AS under_36h,
      count(*) FILTER (WHERE hours <= 48) AS under_48h,
      count(*) FILTER (WHERE hours <= 72) AS under_72h,
      count(*) FILTER (WHERE hours >  72) AS over_72h,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY hours)::numeric, 2) AS median_hours,
      round(avg(hours)::numeric, 2) AS mean_hours
    FROM bucketed
    GROUP BY bucket_start
  )
  SELECT * FROM per_channel
  UNION ALL
  SELECT * FROM totals
  ORDER BY 1, 2 NULLS LAST;
$$;