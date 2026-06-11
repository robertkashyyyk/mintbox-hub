-- "Ignore / error" flags for the 3D repricer.
--
-- When a row's suggested price is wrong because the COST is wrong, the user flags
-- it so it leaves the list (no accidental push) — but it must come back if the
-- cost is never corrected. Mechanism (a "cost-aware snooze"):
--   - cost_at_flag records the (wrong) cost at flag time.
--   - The row stays hidden WHILE its current cost == cost_at_flag (uncorrected)
--     AND it's within snooze_days.
--   - It RETURNS when the cost changes (corrected → re-evaluate) OR snooze_days
--     elapse and it's still wrong (nag). The daily snapshot job prunes resolved/
--     expired flags; the UI also hides active flags live and lets you un-flag.

CREATE TABLE IF NOT EXISTS public.threeds_reprice_ignored (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.threeds_stores(id) ON DELETE CASCADE,
  sku text NOT NULL,
  base_sku text,
  reason text,
  cost_at_flag numeric,                 -- fingerprint: the cost when flagged
  snooze_days integer NOT NULL DEFAULT 14,
  flagged_at timestamptz NOT NULL DEFAULT now(),
  flagged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (store_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_threeds_reprice_ignored_store ON public.threeds_reprice_ignored (store_id);

ALTER TABLE public.threeds_reprice_ignored ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read threeds_reprice_ignored" ON public.threeds_reprice_ignored;
CREATE POLICY "auth read threeds_reprice_ignored" ON public.threeds_reprice_ignored
  FOR SELECT TO authenticated USING (true);

-- Any signed-in user can flag / un-flag (it's an operational review flag).
DROP POLICY IF EXISTS "auth manage threeds_reprice_ignored" ON public.threeds_reprice_ignored;
CREATE POLICY "auth manage threeds_reprice_ignored" ON public.threeds_reprice_ignored
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service write threeds_reprice_ignored" ON public.threeds_reprice_ignored;
CREATE POLICY "service write threeds_reprice_ignored" ON public.threeds_reprice_ignored
  FOR ALL TO service_role USING (true) WITH CHECK (true);
