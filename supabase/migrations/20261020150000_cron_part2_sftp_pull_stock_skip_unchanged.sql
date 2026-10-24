-- 20261020150000_cron_part2_sftp_pull_stock_skip_unchanged.sql
--
-- Part 2 cron repair (job 26, sftp-pull-stock-daily).
--
-- The daily stock pull was 504-ing at the 150s edge wall-clock: every one of the
-- ~47k matched rows was rewritten each run, and because current_stock + last_stock_sync
-- are indexed those are non-HOT updates (full index maintenance per row), ~8.4s/chunk ×
-- ~32 chunks ≈ 269s. That also jammed pg_net's single worker at the top of the hour.
--
-- Fix: only write rows whose stock figures actually changed (most SKUs are unchanged day
-- to day), and keep a 120s function-local statement_timeout as a safety net. matched is
-- counted separately from updated so not_found_count stays correct. last_stock_sync now
-- advances only for changed rows; the enrich queue (cron 11/12) still refreshes it across
-- the catalogue. First run after this change completed in ~33s (1,426 changed of 119,559).

CREATE OR REPLACE FUNCTION public.bulk_update_stock_from_sftp(_payload jsonb)
 RETURNS TABLE(updated_count bigint, not_found_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE
  _now timestamptz := now();
  _input_count bigint;
  _matched bigint;
  _updated bigint;
BEGIN
  CREATE TEMP TABLE _stock_in (
    sku text PRIMARY KEY,
    stock_level numeric,
    on_order numeric,
    mintsoft_back_orders numeric
  ) ON COMMIT DROP;

  INSERT INTO _stock_in (sku, stock_level, on_order, mintsoft_back_orders)
  SELECT DISTINCT ON (x.sku)
    x.sku, x.stock_level, x.on_order, x.mintsoft_back_orders
  FROM jsonb_to_recordset(_payload) AS x(
    sku text,
    stock_level numeric,
    on_order numeric,
    mintsoft_back_orders numeric
  )
  WHERE x.sku IS NOT NULL;

  SELECT COUNT(*) INTO _input_count FROM _stock_in;

  SELECT COUNT(*) INTO _matched
  FROM _stock_in s JOIN public.products_cache p ON p.sku = s.sku;

  WITH upd AS (
    UPDATE public.products_cache p
    SET
      current_stock        = COALESCE(s.stock_level, p.current_stock),
      on_order             = COALESCE(s.on_order, p.on_order),
      mintsoft_back_orders = COALESCE(s.mintsoft_back_orders, p.mintsoft_back_orders),
      last_stock_sync      = _now
    FROM _stock_in s
    WHERE p.sku = s.sku
      AND (
        p.current_stock           IS DISTINCT FROM COALESCE(s.stock_level, p.current_stock)
        OR p.on_order             IS DISTINCT FROM COALESCE(s.on_order, p.on_order)
        OR p.mintsoft_back_orders IS DISTINCT FROM COALESCE(s.mintsoft_back_orders, p.mintsoft_back_orders)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO _updated FROM upd;

  RETURN QUERY SELECT _updated, GREATEST(_input_count - _matched, 0);
END;
$function$;
