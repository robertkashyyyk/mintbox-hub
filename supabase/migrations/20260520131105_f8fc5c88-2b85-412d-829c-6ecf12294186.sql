
-- ============================================================
-- Phase 1: Multi-layer inventory foundation (additive only)
-- ============================================================

-- 1. Enum
DO $$ BEGIN
  CREATE TYPE public.sku_type AS ENUM ('BASE', 'PROCUREMENT_PACK', 'MULTIPLIER', 'BUNDLE', 'ALT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. sku_master
CREATE TABLE IF NOT EXISTS public.sku_master (
  sku                     text PRIMARY KEY,
  sku_type                public.sku_type NOT NULL DEFAULT 'BASE',
  base_sku                text,                       -- target BASE sku for PROCUREMENT/MULTIPLIER/ALT
  supplier_order_sku      text,                       -- optional: code we send to supplier/Mintsoft PO
  internal_alias_sku      text,                       -- optional: cleaner internal label
  allow_marketplace_sale  boolean NOT NULL DEFAULT true,
  allow_picking           boolean NOT NULL DEFAULT true,
  allow_stock_holding     boolean NOT NULL DEFAULT true,
  auto_convert_on_receipt boolean NOT NULL DEFAULT false,
  conversion_multiplier   numeric,                    -- procurement pack qty per base unit
  procurement_pack_size   integer,                    -- preferred pack size when buying this BASE
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sku_master_type ON public.sku_master(sku_type);
CREATE INDEX IF NOT EXISTS idx_sku_master_base_sku ON public.sku_master(base_sku);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_master_supplier_order_sku
  ON public.sku_master(supplier_order_sku) WHERE supplier_order_sku IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_master_internal_alias_sku
  ON public.sku_master(internal_alias_sku) WHERE internal_alias_sku IS NOT NULL;

-- Validation trigger (no CHECK constraints, per project rules)
CREATE OR REPLACE FUNCTION public.validate_sku_master()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sku_type IN ('PROCUREMENT_PACK','MULTIPLIER','ALT') AND NEW.base_sku IS NULL THEN
    RAISE EXCEPTION 'sku_type % requires base_sku', NEW.sku_type;
  END IF;
  IF NEW.sku_type = 'BASE' AND NEW.base_sku IS NOT NULL AND NEW.base_sku <> NEW.sku THEN
    RAISE EXCEPTION 'BASE sku cannot point base_sku to a different sku';
  END IF;
  IF NEW.conversion_multiplier IS NOT NULL AND NEW.conversion_multiplier <= 0 THEN
    RAISE EXCEPTION 'conversion_multiplier must be > 0';
  END IF;
  IF NEW.procurement_pack_size IS NOT NULL AND NEW.procurement_pack_size <= 0 THEN
    RAISE EXCEPTION 'procurement_pack_size must be > 0';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_sku_master ON public.sku_master;
CREATE TRIGGER trg_validate_sku_master
  BEFORE INSERT OR UPDATE ON public.sku_master
  FOR EACH ROW EXECUTE FUNCTION public.validate_sku_master();

-- Derived booleans as a view (source of truth = sku_type)
CREATE OR REPLACE VIEW public.sku_master_v AS
SELECT
  m.*,
  (m.sku_type = 'BASE')              AS is_base_sku,
  (m.sku_type = 'PROCUREMENT_PACK')  AS is_procurement_pack,
  (m.sku_type = 'MULTIPLIER')        AS is_multiplier_sku,
  (m.sku_type = 'BUNDLE')            AS is_bundle
FROM public.sku_master m;

-- 3. sku_conversion_rules  (procurement pack -> base)
CREATE TABLE IF NOT EXISTS public.sku_conversion_rules (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  procurement_sku         text NOT NULL,
  base_sku                text NOT NULL,
  conversion_multiplier   numeric NOT NULL,
  auto_convert_on_receipt boolean NOT NULL DEFAULT true,
  is_active               boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_conversion_rules_active
  ON public.sku_conversion_rules(procurement_sku) WHERE is_active;

CREATE OR REPLACE FUNCTION public.validate_sku_conversion_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.conversion_multiplier <= 0 THEN
    RAISE EXCEPTION 'conversion_multiplier must be > 0';
  END IF;
  IF NEW.procurement_sku = NEW.base_sku THEN
    RAISE EXCEPTION 'procurement_sku and base_sku must differ';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_sku_conversion_rule ON public.sku_conversion_rules;
CREATE TRIGGER trg_validate_sku_conversion_rule
  BEFORE INSERT OR UPDATE ON public.sku_conversion_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_sku_conversion_rule();

-- 4. sku_multiplier_rules  (sellable multiplier -> base)
CREATE TABLE IF NOT EXISTS public.sku_multiplier_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  multiplier_sku  text NOT NULL,
  base_sku        text NOT NULL,
  multiplier_qty  numeric NOT NULL,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_multiplier_rules_active
  ON public.sku_multiplier_rules(multiplier_sku) WHERE is_active;

CREATE OR REPLACE FUNCTION public.validate_sku_multiplier_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.multiplier_qty <= 0 THEN
    RAISE EXCEPTION 'multiplier_qty must be > 0';
  END IF;
  IF NEW.multiplier_sku = NEW.base_sku THEN
    RAISE EXCEPTION 'multiplier_sku and base_sku must differ';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_sku_multiplier_rule ON public.sku_multiplier_rules;
CREATE TRIGGER trg_validate_sku_multiplier_rule
  BEFORE INSERT OR UPDATE ON public.sku_multiplier_rules
  FOR EACH ROW EXECUTE FUNCTION public.validate_sku_multiplier_rule();

-- 5. sku_conversion_logs
CREATE TABLE IF NOT EXISTS public.sku_conversion_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversion_rule_id  uuid REFERENCES public.sku_conversion_rules(id) ON DELETE SET NULL,
  procurement_sku     text NOT NULL,
  base_sku            text NOT NULL,
  procurement_qty     numeric NOT NULL,
  base_qty_created    numeric NOT NULL,
  mintsoft_reference  text,
  status              text NOT NULL DEFAULT 'pending',  -- pending | success | failed | manual
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid
);

CREATE INDEX IF NOT EXISTS idx_sku_conversion_logs_proc ON public.sku_conversion_logs(procurement_sku);
CREATE INDEX IF NOT EXISTS idx_sku_conversion_logs_status ON public.sku_conversion_logs(status);
-- Idempotency: don't double-book the same successful Mintsoft adjustment
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_conversion_logs_success_ref
  ON public.sku_conversion_logs(procurement_sku, mintsoft_reference)
  WHERE status = 'success' AND mintsoft_reference IS NOT NULL;

-- 6. Backfill: every existing product becomes a BASE row
INSERT INTO public.sku_master (sku, sku_type)
SELECT pc.sku, 'BASE'::public.sku_type
FROM public.products_cache pc
LEFT JOIN public.sku_master m ON m.sku = pc.sku
WHERE m.sku IS NULL;

-- 7. RLS
ALTER TABLE public.sku_master            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_conversion_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_multiplier_rules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sku_conversion_logs   ENABLE ROW LEVEL SECURITY;

-- Read for any authenticated user
CREATE POLICY "auth read sku_master"           ON public.sku_master           FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sku_conversion_rules" ON public.sku_conversion_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sku_multiplier_rules" ON public.sku_multiplier_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth read sku_conversion_logs"  ON public.sku_conversion_logs  FOR SELECT TO authenticated USING (true);

-- Write restricted to super_user / senior_user
CREATE POLICY "senior write sku_master"
  ON public.sku_master FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE POLICY "senior write sku_conversion_rules"
  ON public.sku_conversion_rules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE POLICY "senior write sku_multiplier_rules"
  ON public.sku_multiplier_rules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

CREATE POLICY "senior write sku_conversion_logs"
  ON public.sku_conversion_logs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_user'::app_role,'senior_user'::app_role]));

-- Service role full access (background jobs)
CREATE POLICY "service all sku_master"           ON public.sku_master           FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all sku_conversion_rules" ON public.sku_conversion_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all sku_multiplier_rules" ON public.sku_multiplier_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service all sku_conversion_logs"  ON public.sku_conversion_logs  FOR ALL TO service_role USING (true) WITH CHECK (true);
