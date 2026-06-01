-- Auto-quarantine "dirt" SKUs based on the 4th-character rule.
--
-- A valid SKU has a 3-character brand prefix followed by a separator:
--   NGK-B6HS  FEB-12345  KKH/12345  MAY-MP2870B
-- If the 4th character is neither '-' nor '/', the SKU is malformed (dirt).
-- Examples: _1787_5461847B00  _CARCOVER_1002_  1006 x2_2  1002//
--
-- Part A: Backfill — mark the ~482 existing dirt SKUs as quarantined.
-- Part B: Trigger — auto-quarantine any new/updated SKU that matches the rule.

-- ── Part A: Backfill ────────────────────────────────────────────────────────────
UPDATE public.products_cache
SET quarantined = true
WHERE SUBSTRING(sku, 4, 1) NOT IN ('-', '/')
  AND COALESCE(quarantined, false) = false;

-- ── Part B: Trigger function ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_auto_quarantine_dirt_sku()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If the 4th character of the SKU is not a brand/catalogue separator,
  -- the SKU is malformed. Mark it quarantined automatically.
  IF SUBSTRING(NEW.sku, 4, 1) NOT IN ('-', '/') THEN
    NEW.quarantined := true;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Part C: Attach trigger to products_cache ────────────────────────────────────
DROP TRIGGER IF EXISTS trg_auto_quarantine_dirt_sku ON public.products_cache;

CREATE TRIGGER trg_auto_quarantine_dirt_sku
BEFORE INSERT OR UPDATE OF sku
ON public.products_cache
FOR EACH ROW
EXECUTE FUNCTION public.fn_auto_quarantine_dirt_sku();
