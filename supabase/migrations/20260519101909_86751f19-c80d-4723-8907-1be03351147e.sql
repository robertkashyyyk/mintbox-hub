CREATE OR REPLACE FUNCTION public.preview_sku_map_apply(_payload jsonb)
RETURNS TABLE(
  payload_rows integer,
  would_resolve integer,
  would_create integer,
  payload_true_format integer,
  payload_already_linked integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload_rows integer;
  v_would_resolve integer;
  v_would_create integer;
  v_true_format integer;
  v_already_linked integer;
BEGIN
  CREATE TEMP TABLE _pm ON COMMIT DROP AS
  SELECT
    (elem->>'sku')::text AS sku,
    (elem->>'mintsoft_product_id')::bigint AS mintsoft_product_id
  FROM jsonb_array_elements(_payload) AS elem
  WHERE elem->>'sku' IS NOT NULL
    AND elem->>'mintsoft_product_id' IS NOT NULL;

  SELECT count(*) INTO v_payload_rows FROM _pm;

  SELECT count(*) INTO v_true_format
  FROM _pm WHERE sku ~ '^[A-Z0-9]{3}[-/]';

  SELECT count(*) INTO v_would_resolve
  FROM _pm p
  JOIN products_cache pc ON pc.sku = p.sku
  WHERE pc.mintsoft_product_id IS NULL;

  SELECT count(*) INTO v_already_linked
  FROM _pm p
  JOIN products_cache pc ON pc.sku = p.sku
  WHERE pc.mintsoft_product_id IS NOT NULL;

  SELECT count(*) INTO v_would_create
  FROM _pm p
  LEFT JOIN products_cache pc ON pc.sku = p.sku
  WHERE pc.sku IS NULL
    AND p.sku ~ '^[A-Z0-9]{3}[-/]';

  RETURN QUERY SELECT v_payload_rows, v_would_resolve, v_would_create, v_true_format, v_already_linked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.preview_sku_map_apply(jsonb) TO authenticated, service_role;