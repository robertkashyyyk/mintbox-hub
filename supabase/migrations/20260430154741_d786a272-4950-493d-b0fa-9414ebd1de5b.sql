
CREATE TABLE public.edge_function_runs (
  id BIGSERIAL PRIMARY KEY,
  function_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'running', -- running | succeeded | failed | partial
  message TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_efr_function_started ON public.edge_function_runs (function_name, started_at DESC);
CREATE INDEX idx_efr_started_at ON public.edge_function_runs (started_at DESC);

ALTER TABLE public.edge_function_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read run log"
  ON public.edge_function_runs
  FOR SELECT
  TO authenticated
  USING (true);

-- Service role bypasses RLS automatically; no insert policy needed for users.

-- RPC: list recent runs for a function name
CREATE OR REPLACE FUNCTION public.get_edge_function_runs(_function_name TEXT, _limit INT DEFAULT 30)
RETURNS TABLE(
  id BIGINT,
  function_name TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT,
  message TEXT,
  details JSONB
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, function_name, started_at, ended_at, duration_ms, status, message, details
  FROM public.edge_function_runs
  WHERE function_name = _function_name
  ORDER BY started_at DESC
  LIMIT GREATEST(_limit, 1);
$$;
