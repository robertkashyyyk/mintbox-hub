-- Despatch KPI helper RPCs:
--  1. get_queue_health_daily  — daily New/Backorder/AwaitingPicking + despatched
--     + drift (New - Despatched) and cumulative drift.
--  2. get_late_despatch_skus  — SKUs most frequently in orders that took >48h
--     to despatch, for stock-level remediation.

-- ── 1. Queue health daily ────────────────────────────────────────
-- Combines order_status_snapshots (queue counts, prefer PM slot for
-- end-of-day reading) with despatch volume from order_status_history.
CREATE OR REPLACE FUNCTION public.get_queue_health_daily(
  from_date date,
  to_date date
)
RETURNS TABLE(
  day date,
  new_count integer,
  onbackorder_count integer,
  awaitingpicking_count integer,
  despatched integer,
  drift integer,
  drift_cumulative bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH snap AS (
    -- one row per day, prefer PM slot, else AM
    SELECT DISTINCT ON (capture_date_uk)
      capture_date_uk AS day,
      new_count, onbackorder_count, awaitingpicking_count
    FROM order_status_snapshots
    WHERE run_ok = true
      AND capture_date_uk >= from_date
      AND capture_date_uk <= to_date
    ORDER BY capture_date_uk, (slot = 'PM') DESC, captured_at DESC
  ),
  desp AS (
    SELECT
      (h.changed_at AT TIME ZONE 'Europe/London')::date AS day,
      count(DISTINCT h.mintsoft_order_id)::int AS despatched
    FROM order_status_history h
    WHERE h.to_status = 'DESPATCHED'
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date >= from_date
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date <= to_date
    GROUP BY 1
  ),
  joined AS (
    SELECT
      COALESCE(s.day, d.day) AS day,
      COALESCE(s.new_count, 0) AS new_count,
      COALESCE(s.onbackorder_count, 0) AS onbackorder_count,
      COALESCE(s.awaitingpicking_count, 0) AS awaitingpicking_count,
      COALESCE(d.despatched, 0) AS despatched,
      COALESCE(s.new_count, 0) - COALESCE(d.despatched, 0) AS drift
    FROM snap s
    FULL OUTER JOIN desp d ON d.day = s.day
  )
  SELECT
    day, new_count, onbackorder_count, awaitingpicking_count, despatched, drift,
    sum(drift) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING)::bigint AS drift_cumulative
  FROM joined
  WHERE day IS NOT NULL
  ORDER BY day;
$$;

-- ── 2. Late despatch SKUs ────────────────────────────────────────
-- SKUs appearing in orders that breached a given SLA hour threshold.
CREATE OR REPLACE FUNCTION public.get_late_despatch_skus(
  from_date date,
  to_date date,
  sla_hours numeric DEFAULT 48,
  limit_n integer DEFAULT 50
)
RETURNS TABLE(
  sku text,
  product_name text,
  brand_name text,
  late_orders bigint,
  avg_hours numeric,
  worst_hours numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH despatched AS (
    SELECT DISTINCT ON (h.mintsoft_order_id)
      h.mintsoft_order_id,
      EXTRACT(EPOCH FROM (h.changed_at - ol.order_date)) / 3600.0 AS hours
    FROM order_status_history h
    JOIN order_lines ol ON ol.mintsoft_order_id = h.mintsoft_order_id
    WHERE h.to_status = 'DESPATCHED'
      AND ol.order_date IS NOT NULL
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date >= from_date
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date <= to_date
    ORDER BY h.mintsoft_order_id, h.changed_at ASC
  ),
  late AS (
    SELECT mintsoft_order_id, hours
    FROM despatched
    WHERE hours > sla_hours
  ),
  late_lines AS (
    SELECT ol.sku, l.hours
    FROM late l
    JOIN order_lines ol ON ol.mintsoft_order_id = l.mintsoft_order_id
    WHERE ol.sku IS NOT NULL
  )
  SELECT
    ll.sku,
    pc.name AS product_name,
    b.name AS brand_name,
    count(*)::bigint AS late_orders,
    round(avg(ll.hours)::numeric, 1) AS avg_hours,
    round(max(ll.hours)::numeric, 1) AS worst_hours
  FROM late_lines ll
  LEFT JOIN products_cache pc ON pc.sku = ll.sku
  LEFT JOIN brands b ON b.id = pc.brand_id
  GROUP BY ll.sku, pc.name, b.name
  ORDER BY late_orders DESC, avg_hours DESC
  LIMIT GREATEST(limit_n, 1);
$$;
