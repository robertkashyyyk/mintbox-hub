
CREATE OR REPLACE FUNCTION public.get_despatch_performance_buckets(
  from_date date,
  to_date date,
  bucket text DEFAULT 'month'::text,
  channels text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  bucket_start date, channel text, total bigint,
  under_6h bigint, under_12h bigint, under_24h bigint,
  under_36h bigint, under_48h bigint, under_72h bigint, over_72h bigint,
  median_hours numeric, mean_hours numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH despatched AS (
    SELECT DISTINCT ON (h.mintsoft_order_id)
      h.mintsoft_order_id,
      COALESCE(ol.channel, '(unknown)') AS channel,
      h.changed_at AS despatched_at,
      ol.order_date,
      EXTRACT(EPOCH FROM (h.changed_at - ol.order_date)) / 3600.0 AS hours
    FROM order_status_history h
    JOIN order_lines ol ON ol.mintsoft_order_id = h.mintsoft_order_id
    WHERE h.to_status = 'DESPATCHED'
      AND ol.order_date IS NOT NULL
      AND ol.order_date >= '2026-01-01'::timestamptz
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date >= from_date
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date <= to_date
      AND (channels IS NULL OR COALESCE(ol.channel, '(unknown)') = ANY(channels))
    ORDER BY h.mintsoft_order_id, h.changed_at ASC
  ),
  bucketed AS (
    SELECT
      CASE bucket
        WHEN 'day'     THEN date_trunc('day',     despatched_at AT TIME ZONE 'Europe/London')::date
        WHEN 'week'    THEN date_trunc('week',    despatched_at AT TIME ZONE 'Europe/London')::date
        WHEN 'quarter' THEN date_trunc('quarter', despatched_at AT TIME ZONE 'Europe/London')::date
        ELSE                date_trunc('month',   despatched_at AT TIME ZONE 'Europe/London')::date
      END AS bucket_start,
      channel,
      hours
    FROM despatched
  ),
  per_channel AS (
    SELECT
      bucket_start, channel,
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
  totals AS (
    SELECT
      bucket_start, NULL::text AS channel,
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
$function$;
