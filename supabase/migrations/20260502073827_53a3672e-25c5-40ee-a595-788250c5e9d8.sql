
CREATE OR REPLACE FUNCTION public.bulk_update_stock_from_sftp(_payload jsonb)
RETURNS TABLE(updated_count bigint, not_found_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _now timestamptz := now();
  _input_count bigint;
  _updated bigint;
BEGIN
  CREATE TEMP TABLE _stock_in (
    sku text PRIMARY KEY,
    stock_level numeric
  ) ON COMMIT DROP;

  INSERT INTO _stock_in (sku, stock_level)
  SELECT DISTINCT ON (x.sku) x.sku, x.stock_level
  FROM jsonb_to_recordset(_payload) AS x(sku text, stock_level numeric)
  WHERE x.sku IS NOT NULL AND x.stock_level IS NOT NULL;

  SELECT COUNT(*) INTO _input_count FROM _stock_in;

  WITH upd AS (
    UPDATE public.products_cache p
    SET current_stock = s.stock_level,
        last_stock_sync = _now
    FROM _stock_in s
    WHERE p.sku = s.sku
    RETURNING 1
  )
  SELECT COUNT(*) INTO _updated FROM upd;

  RETURN QUERY SELECT _updated, GREATEST(_input_count - _updated, 0);
END;
$$;
