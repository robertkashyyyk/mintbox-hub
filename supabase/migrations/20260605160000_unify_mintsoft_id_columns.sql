-- Kill the mintsoft_id vs mintsoft_product_id "constant pain" for good.
-- products_cache has two columns for the same concept: mintsoft_id (populated by
-- the sync, ~220k rows) and mintsoft_product_id (set by some legacy/orphan flows,
-- mostly null). Code reads inconsistently from both, so half the app sees nulls.
--
-- Fix: backfill both directions, then a BEFORE trigger that mirrors a non-null
-- value into whichever column is null. Reading EITHER column now always works,
-- regardless of which flow wrote the value.

-- 1. Backfill existing rows both directions
UPDATE products_cache SET mintsoft_product_id = mintsoft_id
  WHERE mintsoft_product_id IS NULL AND mintsoft_id IS NOT NULL;
UPDATE products_cache SET mintsoft_id = mintsoft_product_id
  WHERE mintsoft_id IS NULL AND mintsoft_product_id IS NOT NULL;

-- 2. Keep them mirrored on every insert/update
CREATE OR REPLACE FUNCTION public.mirror_mintsoft_id_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mintsoft_id IS NULL AND NEW.mintsoft_product_id IS NOT NULL THEN
    NEW.mintsoft_id := NEW.mintsoft_product_id;
  ELSIF NEW.mintsoft_product_id IS NULL AND NEW.mintsoft_id IS NOT NULL THEN
    NEW.mintsoft_product_id := NEW.mintsoft_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_mintsoft_id ON public.products_cache;
CREATE TRIGGER trg_mirror_mintsoft_id
  BEFORE INSERT OR UPDATE ON public.products_cache
  FOR EACH ROW EXECUTE FUNCTION public.mirror_mintsoft_id_columns();
