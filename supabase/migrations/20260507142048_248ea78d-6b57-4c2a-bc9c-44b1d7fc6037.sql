
CREATE TABLE IF NOT EXISTS public.mintsoft_status_snapshots (
  id bigserial PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  count bigint NOT NULL,
  source text NOT NULL DEFAULT 'OrderStatusSummaryAll'
);

CREATE INDEX IF NOT EXISTS mintsoft_status_snapshots_captured_idx
  ON public.mintsoft_status_snapshots (captured_at DESC);
CREATE INDEX IF NOT EXISTS mintsoft_status_snapshots_status_captured_idx
  ON public.mintsoft_status_snapshots (status, captured_at DESC);

ALTER TABLE public.mintsoft_status_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read mintsoft_status_snapshots"
  ON public.mintsoft_status_snapshots FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "service write mintsoft_status_snapshots"
  ON public.mintsoft_status_snapshots FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- Latest snapshot per status (one row each)
CREATE OR REPLACE FUNCTION public.get_mintsoft_status_latest()
RETURNS TABLE(status text, count bigint, captured_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT ON (status) status, count, captured_at
  FROM public.mintsoft_status_snapshots
  ORDER BY status, captured_at DESC;
$$;

-- Hourly despatched-today derived from cumulative DESPATCHED diffs (UK time)
CREATE OR REPLACE FUNCTION public.get_mintsoft_despatch_hourly_today()
RETURNS TABLE(hr timestamptz, despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH today_uk AS (
    SELECT ((now() AT TIME ZONE 'Europe/London')::date) AT TIME ZONE 'Europe/London' AS day_start
  ),
  snaps AS (
    SELECT captured_at, count
    FROM public.mintsoft_status_snapshots, today_uk
    WHERE status = 'DESPATCHED'
      AND captured_at >= (today_uk.day_start - interval '1 hour')
    ORDER BY captured_at
  ),
  bucketed AS (
    SELECT date_trunc('hour', captured_at AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London' AS hr,
           MIN(count) AS first_count,
           MAX(count) AS last_count
    FROM snaps
    GROUP BY 1
  )
  SELECT hr, GREATEST(last_count - first_count, 0)::bigint AS despatched
  FROM bucketed
  WHERE hr >= (SELECT day_start FROM today_uk)
  ORDER BY hr;
$$;
