-- ============================================================
-- Web Searcher — "Dims & Weights" (and future tools)
-- ------------------------------------------------------------
-- Automated web lookup of product dimensions / weights, keyed on
-- EAN barcode (best), brand + manufacturer part number, or name.
-- Results land in web_search_proposals for HUMAN REVIEW, then on
-- approval are written into products_cache (height/length/depth/weight)
-- and flagged for push back to Mintsoft by a LOCAL script
-- (Mintsoft blocks Supabase server IPs, so the push cannot run here).
--
-- Units match products_cache: dimensions in CM, weight in GRAMS.
-- Note: Mintsoft "Width" maps to products_cache.length (existing sync quirk).
-- ============================================================

-- 1. Proposals ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.web_search_proposals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool          text NOT NULL DEFAULT 'dims_weights'
                  CHECK (tool IN ('dims_weights','images','prices','titles','products')),
  sku           text NOT NULL,
  mintsoft_id   integer,
  -- proposed values (cm + grams)
  proposed_length_cm  numeric,
  proposed_depth_cm   numeric,
  proposed_height_cm  numeric,
  proposed_weight_g   integer,
  is_packaged   boolean,                 -- true = shipping box dims, false = bare part
  padded        boolean NOT NULL DEFAULT false,  -- bare dims padded to a box estimate
  -- provenance / quality
  match_key     text CHECK (match_key IN ('ean','brand_partno','name')),
  confidence    text CHECK (confidence IN ('high','medium','low')),
  source_count  integer NOT NULL DEFAULT 0,
  source_url    text,
  sources       jsonb,
  raw_snippets  text,
  -- review workflow
  status        text NOT NULL DEFAULT 'pending_review'
                  CHECK (status IN ('pending_review','approved','rejected','applied','no_data')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  applied_at    timestamptz,
  pushed_to_mintsoft_at timestamptz,
  run_id        uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_search_proposals_sku    ON public.web_search_proposals(sku);
CREATE INDEX IF NOT EXISTS idx_web_search_proposals_status ON public.web_search_proposals(status);
CREATE INDEX IF NOT EXISTS idx_web_search_proposals_tool   ON public.web_search_proposals(tool);
-- at most one open proposal per (sku, tool)
CREATE UNIQUE INDEX IF NOT EXISTS uq_web_search_open_proposal
  ON public.web_search_proposals(sku, tool)
  WHERE status IN ('pending_review','approved');

-- 2. Run audit ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.web_search_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool          text NOT NULL DEFAULT 'dims_weights',
  status        text NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','complete','error')),
  criteria      jsonb,
  queued        integer NOT NULL DEFAULT 0,
  processed     integer NOT NULL DEFAULT 0,
  found         integer NOT NULL DEFAULT 0,
  no_data       integer NOT NULL DEFAULT 0,
  errors        integer NOT NULL DEFAULT 0,
  error_message text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

-- 3. Settings (one config row per tool) -----------------------
CREATE TABLE IF NOT EXISTS public.web_search_settings (
  tool          text PRIMARY KEY,
  enabled       boolean NOT NULL DEFAULT true,
  batch_size    integer NOT NULL DEFAULT 50,
  recheck_after_days integer NOT NULL DEFAULT 90,
  -- auto-approve gate (default OFF — everything goes to review first)
  auto_approve  boolean NOT NULL DEFAULT false,
  auto_approve_min_sources integer NOT NULL DEFAULT 2,
  auto_approve_require_packaged boolean NOT NULL DEFAULT true,
  -- padding applied when only bare-part dims are found
  padding_length_cm numeric NOT NULL DEFAULT 2,
  padding_girth_cm  numeric NOT NULL DEFAULT 0.6,
  -- candidate selection criteria
  criteria      jsonb NOT NULL DEFAULT
                  '{"require_barcode": true, "only_missing_dims": true, "brands": [], "min_velocity": 0}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.web_search_settings (tool) VALUES ('dims_weights')
ON CONFLICT (tool) DO NOTHING;

-- 4. products_cache tracking columns (additive, safe) ---------
ALTER TABLE public.products_cache
  ADD COLUMN IF NOT EXISTS dim_search_status     text,
  ADD COLUMN IF NOT EXISTS dim_search_checked_at timestamptz;

-- 5. updated_at triggers --------------------------------------
DROP TRIGGER IF EXISTS trg_web_search_proposals_updated_at ON public.web_search_proposals;
CREATE TRIGGER trg_web_search_proposals_updated_at
  BEFORE UPDATE ON public.web_search_proposals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS trg_web_search_settings_updated_at ON public.web_search_settings;
CREATE TRIGGER trg_web_search_settings_updated_at
  BEFORE UPDATE ON public.web_search_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 6. RLS ------------------------------------------------------
ALTER TABLE public.web_search_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_search_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web_search_settings  ENABLE ROW LEVEL SECURITY;

-- read: any authenticated user
CREATE POLICY "read web_search_proposals" ON public.web_search_proposals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read web_search_runs" ON public.web_search_runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "read web_search_settings" ON public.web_search_settings
  FOR SELECT TO authenticated USING (true);

-- write: senior / super users (reviewers)
CREATE POLICY "senior write web_search_proposals" ON public.web_search_proposals
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));
CREATE POLICY "senior write web_search_settings" ON public.web_search_settings
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

-- service role: full access (background worker + local push script)
CREATE POLICY "service all web_search_proposals" ON public.web_search_proposals
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all web_search_runs" ON public.web_search_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all web_search_settings" ON public.web_search_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
