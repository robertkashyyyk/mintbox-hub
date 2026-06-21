-- FG7 (and any "table-mapped" supplier): persisted part-number → Hub SKU mapping.
-- NGK maps algorithmically (NGK- + zero-pad-5); FG7 is a multi-brand distributor whose
-- part numbers map to various brand SKUs via a learned prefix, so the mapping must be
-- stored. TRUE SKU is stored EXPLICITLY (not recomputed) — some are not a clean
-- prefix+partnumber (e.g. numeric GSG codes), so the literal SKU is authoritative.

CREATE TABLE IF NOT EXISTS public.supplier_feed_mappings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier      text NOT NULL,                 -- 'FG7'
  part_number   text NOT NULL,                 -- the supplier's code as it appears in the feed
  prefix        text,                          -- brand prefix (MAH-, SKF-, DVR-, …) — for grouping/suggestion
  true_sku      text NOT NULL,                 -- the Hub/Mintsoft SKU to equalise
  active        boolean NOT NULL DEFAULT true,
  source        text NOT NULL DEFAULT 'seed',  -- 'seed' | 'manual' | 'auto'
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier, part_number)
);
CREATE INDEX IF NOT EXISTS idx_sfm_supplier ON public.supplier_feed_mappings (supplier);

CREATE OR REPLACE FUNCTION public.touch_supplier_feed_mappings() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_touch_sfm ON public.supplier_feed_mappings;
CREATE TRIGGER trg_touch_sfm BEFORE UPDATE ON public.supplier_feed_mappings
  FOR EACH ROW EXECUTE FUNCTION public.touch_supplier_feed_mappings();

-- Register the FG7 feed (its file lands on our own SFTP at /Stock).
INSERT INTO public.supplier_feeds (supplier, display_name, mapping_kind, sftp_remote_path)
VALUES ('FG7', 'FG7 (multi-brand)', 'table', '/Stock/433FTP.csv')
ON CONFLICT (supplier) DO NOTHING;

-- RLS: internal staff tool — authenticated read + manage (mapping UI), service_role full.
ALTER TABLE public.supplier_feed_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sfm_read   ON public.supplier_feed_mappings;
DROP POLICY IF EXISTS sfm_write  ON public.supplier_feed_mappings;
CREATE POLICY sfm_read  ON public.supplier_feed_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY sfm_write ON public.supplier_feed_mappings FOR ALL    TO authenticated USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_feed_mappings TO authenticated;
GRANT ALL ON public.supplier_feed_mappings TO service_role;
