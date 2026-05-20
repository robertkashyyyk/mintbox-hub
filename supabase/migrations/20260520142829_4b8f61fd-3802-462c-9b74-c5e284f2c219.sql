
-- 1. Extend sku_multiplier_rules
ALTER TABLE public.sku_multiplier_rules
  ADD COLUMN IF NOT EXISTS relationship_type text NOT NULL DEFAULT 'q_pack',
  ADD COLUMN IF NOT EXISTS safety_buffer_units integer;

ALTER TABLE public.sku_multiplier_rules
  DROP CONSTRAINT IF EXISTS sku_multiplier_rules_relationship_type_chk;
ALTER TABLE public.sku_multiplier_rules
  ADD CONSTRAINT sku_multiplier_rules_relationship_type_chk
  CHECK (relationship_type IN ('q_pack','bundle','kit','promo_pack'));

ALTER TABLE public.sku_multiplier_rules
  DROP CONSTRAINT IF EXISTS sku_multiplier_rules_safety_buffer_chk;
ALTER TABLE public.sku_multiplier_rules
  ADD CONSTRAINT sku_multiplier_rules_safety_buffer_chk
  CHECK (safety_buffer_units IS NULL OR safety_buffer_units >= 0);

-- 2. Global safety buffer setting (default 0). Insert only if missing.
INSERT INTO public.app_settings (key, value, description)
SELECT 'virtual_sku.global_safety_buffer', '0'::jsonb,
       'Units to reserve on base SKU before deriving virtual SKU stock'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'virtual_sku.global_safety_buffer');

-- 3. Audit history table for multiplier rule changes
CREATE TABLE IF NOT EXISTS public.sku_multiplier_rules_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid,
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  old_row jsonb,
  new_row jsonb
);

CREATE INDEX IF NOT EXISTS sku_multiplier_rules_history_rule_id_idx
  ON public.sku_multiplier_rules_history (rule_id, changed_at DESC);

ALTER TABLE public.sku_multiplier_rules_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "history read for authenticated" ON public.sku_multiplier_rules_history;
CREATE POLICY "history read for authenticated"
  ON public.sku_multiplier_rules_history FOR SELECT
  TO authenticated USING (true);

-- No insert/update/delete policies → only service_role + trigger can write.

CREATE OR REPLACE FUNCTION public.log_sku_multiplier_rule_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.sku_multiplier_rules_history (rule_id, action, changed_by, new_row)
    VALUES (NEW.id, 'INSERT', auth.uid(), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
      INSERT INTO public.sku_multiplier_rules_history (rule_id, action, changed_by, old_row, new_row)
      VALUES (NEW.id, 'UPDATE', auth.uid(), to_jsonb(OLD), to_jsonb(NEW));
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.sku_multiplier_rules_history (rule_id, action, changed_by, old_row)
    VALUES (OLD.id, 'DELETE', auth.uid(), to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_log_sku_multiplier_rule_change ON public.sku_multiplier_rules;
CREATE TRIGGER trg_log_sku_multiplier_rule_change
AFTER INSERT OR UPDATE OR DELETE ON public.sku_multiplier_rules
FOR EACH ROW EXECUTE FUNCTION public.log_sku_multiplier_rule_change();

-- 4. Compatibility view: sku_relationships
DROP VIEW IF EXISTS public.sku_relationships;
CREATE VIEW public.sku_relationships AS
SELECT id,
       multiplier_sku AS parent_sku,
       base_sku       AS child_sku,
       multiplier_qty AS qty,
       relationship_type,
       safety_buffer_units,
       is_active,
       notes,
       created_at,
       updated_at
FROM public.sku_multiplier_rules;

-- 5. Derived stock helpers
CREATE OR REPLACE FUNCTION public.get_virtual_sku_stock(p_sku text)
RETURNS TABLE (
  virtual_sku text,
  base_sku text,
  relationship_type text,
  pack_qty numeric,
  base_on_hand numeric,
  safety_buffer numeric,
  derived_qty numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH g AS (
    SELECT COALESCE((value)::numeric, 0) AS global_buf
    FROM public.app_settings
    WHERE key = 'virtual_sku.global_safety_buffer'
  )
  SELECT
    r.multiplier_sku AS virtual_sku,
    r.base_sku,
    r.relationship_type,
    r.multiplier_qty::numeric AS pack_qty,
    COALESCE(pc.current_stock, 0)::numeric AS base_on_hand,
    COALESCE(r.safety_buffer_units, (SELECT global_buf FROM g), 0)::numeric AS safety_buffer,
    GREATEST(
      FLOOR(
        (COALESCE(pc.current_stock, 0)::numeric
         - COALESCE(r.safety_buffer_units, (SELECT global_buf FROM g), 0)::numeric)
        / NULLIF(r.multiplier_qty, 0)::numeric
      ),
      0
    )::numeric AS derived_qty
  FROM public.sku_multiplier_rules r
  LEFT JOIN public.products_cache pc ON pc.sku = r.base_sku
  WHERE r.multiplier_sku = p_sku
    AND r.is_active = true;
$$;

CREATE OR REPLACE FUNCTION public.list_virtual_sku_stock(
  p_base_sku text DEFAULT NULL,
  p_brand_id uuid DEFAULT NULL
)
RETURNS TABLE (
  virtual_sku text,
  base_sku text,
  relationship_type text,
  pack_qty numeric,
  base_on_hand numeric,
  safety_buffer numeric,
  derived_qty numeric,
  brand_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH g AS (
    SELECT COALESCE((value)::numeric, 0) AS global_buf
    FROM public.app_settings
    WHERE key = 'virtual_sku.global_safety_buffer'
  )
  SELECT
    r.multiplier_sku AS virtual_sku,
    r.base_sku,
    r.relationship_type,
    r.multiplier_qty::numeric AS pack_qty,
    COALESCE(pc.current_stock, 0)::numeric AS base_on_hand,
    COALESCE(r.safety_buffer_units, (SELECT global_buf FROM g), 0)::numeric AS safety_buffer,
    GREATEST(
      FLOOR(
        (COALESCE(pc.current_stock, 0)::numeric
         - COALESCE(r.safety_buffer_units, (SELECT global_buf FROM g), 0)::numeric)
        / NULLIF(r.multiplier_qty, 0)::numeric
      ),
      0
    )::numeric AS derived_qty,
    pc.brand_id
  FROM public.sku_multiplier_rules r
  LEFT JOIN public.products_cache pc ON pc.sku = r.base_sku
  WHERE r.is_active = true
    AND (p_base_sku IS NULL OR r.base_sku = p_base_sku)
    AND (p_brand_id IS NULL OR pc.brand_id = p_brand_id);
$$;
