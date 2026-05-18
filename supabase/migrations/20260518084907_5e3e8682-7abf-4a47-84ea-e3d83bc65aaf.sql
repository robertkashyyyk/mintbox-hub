CREATE OR REPLACE FUNCTION public.bulk_update_lsa_from_sftp(_payload jsonb)
RETURNS TABLE(updated_count bigint, not_found_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _input_count bigint;
  _updated bigint;
BEGIN
  CREATE TEMP TABLE _lsa_in (
    sku text PRIMARY KEY,
    lsa numeric
  ) ON COMMIT DROP;

  INSERT INTO _lsa_in (sku, lsa)
  SELECT DISTINCT ON (x.sku) x.sku, x.lsa
  FROM jsonb_to_recordset(_payload) AS x(sku text, lsa numeric)
  WHERE x.sku IS NOT NULL AND x.lsa IS NOT NULL;

  SELECT COUNT(*) INTO _input_count FROM _lsa_in;

  WITH upd AS (
    UPDATE public.products_cache p
    SET low_stock_alert_level = s.lsa,
        updated_at = _now
    FROM _lsa_in s
    WHERE p.sku = s.sku
    RETURNING 1
  )
  SELECT COUNT(*) INTO _updated FROM upd;

  RETURN QUERY SELECT _updated, GREATEST(_input_count - _updated, 0);
END;
$function$;