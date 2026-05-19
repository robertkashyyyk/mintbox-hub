
-- 1. Mapping table
CREATE TABLE IF NOT EXISTS public.mintsoft_sku_map (
  sku text PRIMARY KEY,
  mintsoft_product_id bigint NOT NULL,
  name text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mintsoft_sku_map_pid ON public.mintsoft_sku_map(mintsoft_product_id);

ALTER TABLE public.mintsoft_sku_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super users can view sku map"
ON public.mintsoft_sku_map
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'super_user'::app_role));

-- 2. Bulk upsert RPC
CREATE OR REPLACE FUNCTION public.bulk_upsert_sku_map(_payload jsonb)
RETURNS TABLE(upserted_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _now timestamptz := now();
  _count bigint;
BEGIN
  WITH ins AS (
    INSERT INTO public.mintsoft_sku_map (sku, mintsoft_product_id, name, last_seen_at)
    SELECT DISTINCT ON (x.sku) x.sku, x.mintsoft_product_id, x.name, _now
    FROM jsonb_to_recordset(_payload) AS x(
      sku text,
      mintsoft_product_id bigint,
      name text
    )
    WHERE x.sku IS NOT NULL AND x.mintsoft_product_id IS NOT NULL
    ON CONFLICT (sku) DO UPDATE
      SET mintsoft_product_id = EXCLUDED.mintsoft_product_id,
          name = COALESCE(EXCLUDED.name, public.mintsoft_sku_map.name),
          last_seen_at = _now
    RETURNING 1
  )
  SELECT count(*) INTO _count FROM ins;

  RETURN QUERY SELECT _count;
END;
$$;

-- 3. Apply map to products_cache
CREATE OR REPLACE FUNCTION public.apply_sku_map_to_cache()
RETURNS TABLE(resolved_count bigint, created_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _resolved bigint;
  _created bigint;
BEGIN
  -- Backfill mintsoft_product_id on orphan cache rows
  WITH upd AS (
    UPDATE public.products_cache p
    SET mintsoft_product_id = m.mintsoft_product_id,
        updated_at = now()
    FROM public.mintsoft_sku_map m
    WHERE p.sku = m.sku
      AND p.mintsoft_product_id IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO _resolved FROM upd;

  -- Auto-create minimal cache rows for TRUE-SKU mapped products we don't have yet
  WITH ins AS (
    INSERT INTO public.products_cache (sku, name, mintsoft_product_id, created_at, updated_at)
    SELECT m.sku, m.name, m.mintsoft_product_id, now(), now()
    FROM public.mintsoft_sku_map m
    LEFT JOIN public.products_cache p ON p.sku = m.sku
    WHERE p.sku IS NULL
      AND m.sku ~ '^[A-Z0-9]{3}[-/]'
    RETURNING 1
  )
  SELECT count(*) INTO _created FROM ins;

  RETURN QUERY SELECT _resolved, _created;
END;
$$;
