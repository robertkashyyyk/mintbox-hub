CREATE TABLE public.despatch_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uk_date date NOT NULL,
  mintsoft_order_id bigint NOT NULL,
  despatched_at timestamptz NOT NULL,
  channel text,
  order_number text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uk_date, mintsoft_order_id)
);

CREATE INDEX idx_despatch_ledger_uk_date ON public.despatch_ledger (uk_date);
CREATE INDEX idx_despatch_ledger_despatched_at ON public.despatch_ledger (despatched_at DESC);

ALTER TABLE public.despatch_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read despatch ledger"
  ON public.despatch_ledger FOR SELECT
  TO authenticated
  USING (true);

-- Authoritative count for the dashboard
CREATE OR REPLACE FUNCTION public.get_despatched_today_authoritative()
RETURNS TABLE (
  uk_date date,
  despatched_count bigint,
  last_despatched_at timestamptz,
  last_poll_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH today AS (
    SELECT (now() AT TIME ZONE 'Europe/London')::date AS d
  )
  SELECT
    today.d AS uk_date,
    COUNT(*)::bigint AS despatched_count,
    MAX(dl.despatched_at) AS last_despatched_at,
    (SELECT MAX(ended_at) FROM edge_function_runs
       WHERE function_name = 'poll-despatched-today' AND status IN ('succeeded','partial')) AS last_poll_at
  FROM today
  LEFT JOIN despatch_ledger dl ON dl.uk_date = today.d
  GROUP BY today.d;
$$;