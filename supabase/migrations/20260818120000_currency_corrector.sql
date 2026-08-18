-- Currency corrector: single chokepoint so cost_price stays GBP-canonical no matter
-- which of the ~6 Mintsoft writers touches it, plus a one-time fix for the rows a
-- sync already reverted, plus RLS on the map table.
--
-- Convention this enforces: for a foreign-prefix SKU, ANY value written to cost_price
-- is the NATIVE (supplier-currency) figure; the trigger derives canonical GBP.

-- 1) Trigger function -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_cost_currency()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sc public.supplier_currency%ROWTYPE;
BEGIN
  IF NEW.cost_price IS NULL THEN RETURN NEW; END IF;
  -- Unchanged cost on UPDATE = echo write (e.g. full-row upsert re-stating the same
  -- GBP value) → leave as-is so we never double-convert.
  IF TG_OP = 'UPDATE' AND NEW.cost_price IS NOT DISTINCT FROM OLD.cost_price THEN
    RETURN NEW;
  END IF;
  -- Resolve currency by prefix (prefixes are distinct 3-char tokens → ≤1 match).
  SELECT * INTO sc FROM public.supplier_currency
    WHERE NEW.sku LIKE prefix || '-%' LIMIT 1;
  IF NOT FOUND OR sc.currency = 'GBP' THEN RETURN NEW; END IF;
  -- Treat the incoming value as native; derive GBP + stamp native/currency/fx.
  NEW.cost_price_native   := NEW.cost_price;
  NEW.cost_price_currency := sc.currency;
  NEW.cost_fx_rate        := sc.fx_rate;
  NEW.cost_price          := round(NEW.cost_price * sc.fx_rate, 4);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_apply_cost_currency ON public.products_cache;
CREATE TRIGGER trg_apply_cost_currency
  BEFORE INSERT OR UPDATE OF cost_price ON public.products_cache
  FOR EACH ROW EXECUTE FUNCTION public.apply_cost_currency();

-- 2) One-time corrector for the rows already reverted to native ---------------------
-- Disable the trigger for this statement only, so setting the GBP result is not
-- re-interpreted as native.
ALTER TABLE public.products_cache DISABLE TRIGGER trg_apply_cost_currency;
UPDATE public.products_cache
  SET cost_price = round(cost_price_native * cost_fx_rate, 4)
  WHERE cost_price_native IS NOT NULL
    AND round(cost_price_native * cost_fx_rate, 4) <> round(cost_price, 4);
ALTER TABLE public.products_cache ENABLE TRIGGER trg_apply_cost_currency;

-- 3) RLS on the reference map (you flagged it) -------------------------------------
ALTER TABLE public.supplier_currency ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_currency_read ON public.supplier_currency;
CREATE POLICY supplier_currency_read ON public.supplier_currency
  FOR SELECT TO authenticated USING (true);
-- No write policy → only service_role (which bypasses RLS) can modify the map.
