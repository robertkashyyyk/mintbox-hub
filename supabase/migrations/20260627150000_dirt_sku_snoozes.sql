-- Persist the Dirt SKUs "Resolve" action as a timed snooze.
-- It was client-only (useState) so it reset on every refresh — users re-checked
-- the same SKUs. Jon's ask: hide a resolved SKU for a window (7 days) to let the
-- fix (SKU rename in Mintsoft / brand prefix add) propagate; if it's STILL a dirt
-- SKU after that, it comes back. Mirrors liquidation_exclusions' RLS.

CREATE TABLE IF NOT EXISTS public.dirt_sku_snoozes (
  sku           text PRIMARY KEY,
  snoozed_until timestamptz NOT NULL,
  snoozed_by    uuid,
  snoozed_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dirt_sku_snoozes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read dirt_snoozes"  ON public.dirt_sku_snoozes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write dirt_snoozes" ON public.dirt_sku_snoozes FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_dirt_snoozes_until ON public.dirt_sku_snoozes (snoozed_until);
