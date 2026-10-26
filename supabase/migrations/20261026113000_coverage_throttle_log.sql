-- 26 Oct 2026 — observability for the coverage 429 retry work. One row per throttled listings page,
-- written best-effort by sync-ebay-coverage (v23), so we can report how many pages hit a 429/5xx and
-- whether the in-call retries ABSORBED it (a later attempt returned ok) or it RESUMED (fell through to
-- the save-and-resume path, picked up by the 10-min continue tick). Never blocks the sync.
CREATE TABLE IF NOT EXISTS public.coverage_throttle_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_token    text,
  seller_id    bigint,
  page         integer,
  http_status  integer,
  retries_used integer,
  resolved     text,          -- 'absorbed' | 'resumed'
  logged_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coverage_throttle_log_run_idx ON public.coverage_throttle_log (run_token, logged_at);

GRANT SELECT, INSERT ON public.coverage_throttle_log TO service_role;

-- Lock down: a public table with RLS off is reachable via PostgREST with the anon key. The edge fn
-- writes with the service role (BYPASSRLS), so no policy is needed — enable RLS and revoke API roles.
ALTER TABLE public.coverage_throttle_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coverage_throttle_log FROM anon, authenticated;
