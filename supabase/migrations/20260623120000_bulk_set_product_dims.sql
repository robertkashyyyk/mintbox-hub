-- Bulk-correct product dimensions/weight from Mintsoft (one statement per chunk).
-- Used by the backfill-product-dims edge function to fix the historical mis-mapping:
--   length came from Mintsoft 'Length' (empty) instead of 'Width'; weight stored in kg not g.
-- COALESCE: only overwrite where the incoming (Mintsoft) value is present — never null out a
-- local-only value (e.g. a web-searched dim not yet in Mintsoft).
CREATE OR REPLACE FUNCTION public.bulk_set_product_dims(p jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  WITH x AS (
    SELECT (e->>'sku') AS sku,
           NULLIF(e->>'length','')::numeric AS length,
           NULLIF(e->>'depth','')::numeric  AS depth,
           NULLIF(e->>'height','')::numeric AS height,
           NULLIF(e->>'weight','')::numeric AS weight
    FROM jsonb_array_elements(p) e
  ),
  upd AS (
    UPDATE products_cache pc SET
      length = COALESCE(x.length, pc.length),
      depth  = COALESCE(x.depth,  pc.depth),
      height = COALESCE(x.height, pc.height),
      weight = COALESCE(x.weight, pc.weight),
      updated_at = now()
    FROM x WHERE pc.sku = x.sku
    RETURNING 1
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.bulk_set_product_dims(jsonb) TO service_role;
