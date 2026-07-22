-- Managed do-not-sell registry for supplier feeds (Klokkerholm Step 4, built to
-- generalise). A "block" entry FORCES that SKU's feed target to 0 — the equaliser
-- actively StockOuts any positive stock to zero and holds it there (a live on/off
-- switch, not a passive filter). A per-SKU "allow" overrides any block (escape hatch
-- for one SKU inside a blocked family; also the seam for a future pattern-rule layer).
-- Editable in the Hub; every add/remove is audited.

CREATE TABLE IF NOT EXISTS public.supplier_do_not_sell (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier   text NOT NULL,                         -- 'KKH' (Klokkerholm) now; generalises later
  sku        text NOT NULL,
  mode       text NOT NULL DEFAULT 'block'          -- 'block' (force target 0) | 'allow' (override a block)
             CHECK (mode IN ('block','allow')),
  reason     text,
  active     boolean NOT NULL DEFAULT true,
  added_by   uuid,
  added_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier, sku, mode)
);
CREATE INDEX IF NOT EXISTS idx_sdns_supplier_active ON public.supplier_do_not_sell (supplier, active);

-- Append-only audit of every change (matches the Hub write-audit rule).
CREATE TABLE IF NOT EXISTS public.supplier_do_not_sell_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      uuid,
  action     text NOT NULL,                         -- 'add' | 'remove' | 'update'
  supplier   text NOT NULL,
  sku        text NOT NULL,
  mode       text,
  reason     text,
  old_row    jsonb,
  new_row    jsonb
);

CREATE OR REPLACE FUNCTION public.audit_supplier_do_not_sell() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.supplier_do_not_sell_audit(actor, action, supplier, sku, mode, reason, old_row, new_row)
  VALUES (
    COALESCE(auth.uid(), NEW.added_by, OLD.added_by),
    lower(TG_OP),
    COALESCE(NEW.supplier, OLD.supplier),
    COALESCE(NEW.sku, OLD.sku),
    COALESCE(NEW.mode, OLD.mode),
    COALESCE(NEW.reason, OLD.reason),
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
  );
  IF TG_OP = 'UPDATE' THEN NEW.updated_at = now(); RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_audit_sdns ON public.supplier_do_not_sell;
CREATE TRIGGER trg_audit_sdns
  AFTER INSERT OR UPDATE OR DELETE ON public.supplier_do_not_sell
  FOR EACH ROW EXECUTE FUNCTION public.audit_supplier_do_not_sell();

-- Convenience view: effective do-not-sell SKUs (block wins unless an active allow exists).
CREATE OR REPLACE VIEW public.v_supplier_do_not_sell AS
SELECT b.supplier, b.sku
FROM public.supplier_do_not_sell b
WHERE b.active AND b.mode = 'block'
  AND NOT EXISTS (
    SELECT 1 FROM public.supplier_do_not_sell a
    WHERE a.active AND a.mode = 'allow' AND a.supplier = b.supplier AND a.sku = b.sku
  );

ALTER TABLE public.supplier_do_not_sell       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_do_not_sell_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sdns_read  ON public.supplier_do_not_sell;
DROP POLICY IF EXISTS sdns_write ON public.supplier_do_not_sell;
DROP POLICY IF EXISTS sdns_audit_read ON public.supplier_do_not_sell_audit;
CREATE POLICY sdns_read  ON public.supplier_do_not_sell FOR SELECT TO authenticated USING (true);
CREATE POLICY sdns_write ON public.supplier_do_not_sell FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY sdns_audit_read ON public.supplier_do_not_sell_audit FOR SELECT TO authenticated USING (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_do_not_sell TO authenticated;
GRANT SELECT ON public.supplier_do_not_sell_audit, public.v_supplier_do_not_sell TO authenticated;
GRANT ALL ON public.supplier_do_not_sell, public.supplier_do_not_sell_audit TO service_role;
