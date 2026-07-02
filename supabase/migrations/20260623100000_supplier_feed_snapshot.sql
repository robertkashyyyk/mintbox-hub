-- Supplier feed nightly automation support: a snapshot of the LAST feed per supplier
-- so the scheduled edge function can DIFF (only equalise SKUs whose feed qty changed
-- since last run) and stay well inside the 60s edge limit. There is no bulk WH6-read
-- endpoint, so reads are per-SKU — diffing keeps the steady-state run tiny.
--
-- Also adds the live/dry-run switch: the scheduled function logs its plan but does NOT
-- write to Mintsoft until ordering.supplier_feed_live = true (safe rollout).

CREATE TABLE IF NOT EXISTS public.supplier_feed_snapshot (
  supplier     text NOT NULL,
  part_number  text NOT NULL,
  qty          integer NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier, part_number)
);
ALTER TABLE public.supplier_feed_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sfs_read ON public.supplier_feed_snapshot;
CREATE POLICY sfs_read ON public.supplier_feed_snapshot FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.supplier_feed_snapshot TO authenticated;
GRANT ALL    ON public.supplier_feed_snapshot TO service_role;

-- Live switch + per-run write cap (app_settings is the key/value config table).
INSERT INTO public.app_settings (key, value) VALUES
  ('ordering.supplier_feed_live', 'false'::jsonb),
  ('ordering.supplier_feed_max_writes_per_run', '300'::jsonb)
ON CONFLICT (key) DO NOTHING;
