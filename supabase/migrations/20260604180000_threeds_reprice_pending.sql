-- Cumulative pending-prices queue for the 3D repricer.
--
-- PROBLEM: threeds-reprice-push overwrote the SFTP file with only the latest
-- batch. 3D Sellers leaves the file and imports on its own schedule, so a 10am
-- push followed by an 11am push LOST the 10am prices if 3D hadn't read the file
-- in between.
--
-- FIX: this table is the source of truth for "prices we want 3D to set but that
-- haven't been confirmed applied yet". Every push upserts into it (latest price
-- per SKU wins) and the SFTP file is rewritten from the FULL pending set, so
-- intra-day pushes accumulate. A nightly reconcile reads prices back from the 3D
-- API and flips confirmed rows to 'applied' (dropping them from the file).
--
-- status: 'pending'  — in the file, awaiting 3D import / confirmation
--         'applied'  — confirmed live by the reconcile; kept for history, not in file

CREATE TABLE IF NOT EXISTS public.threeds_reprice_pending (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.threeds_stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  price numeric NOT NULL,                 -- GROSS inc-VAT price we want set
  status text NOT NULL DEFAULT 'pending', -- pending | applied
  queued_at timestamptz NOT NULL DEFAULT now(),
  queued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_pushed_at timestamptz,             -- last time written into the SFTP file
  applied_at timestamptz,                 -- when reconcile confirmed it live
  verified_price numeric,                 -- price the 3D API reported at reconcile
  UNIQUE (store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_threeds_reprice_pending_store_status
  ON public.threeds_reprice_pending (store_id, status);

ALTER TABLE public.threeds_reprice_pending ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read threeds_reprice_pending" ON public.threeds_reprice_pending;
CREATE POLICY "auth read threeds_reprice_pending" ON public.threeds_reprice_pending
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "service write threeds_reprice_pending" ON public.threeds_reprice_pending;
CREATE POLICY "service write threeds_reprice_pending" ON public.threeds_reprice_pending
  FOR ALL TO service_role USING (true) WITH CHECK (true);
