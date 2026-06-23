-- ============================================================================
-- Phase B.1 — resumable cursor for the server-side eBay coverage sync.
-- The sync edge function (sync-ebay-coverage) pages 3D Sellers in time-budgeted
-- chunks; pg_cron kicks it off weekly and advances it through the small hours.
-- This holds where to resume (which account + page) so each ~110s invocation
-- picks up exactly where the last left off.
-- ============================================================================
ALTER TABLE public.listing_coverage_sync
  ADD COLUMN IF NOT EXISTS phase         text    NOT NULL DEFAULT 'idle',  -- idle | running | done
  ADD COLUMN IF NOT EXISTS cursor_acct   integer NOT NULL DEFAULT 0,       -- index into the UK account list
  ADD COLUMN IF NOT EXISTS cursor_page   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS run_token     timestamptz,                      -- stamps last_seen_at for the whole run
  ADD COLUMN IF NOT EXISTS rows_this_run integer NOT NULL DEFAULT 0;

INSERT INTO public.listing_coverage_sync (channel, phase)
VALUES ('ebay', 'idle')
ON CONFLICT (channel) DO NOTHING;
