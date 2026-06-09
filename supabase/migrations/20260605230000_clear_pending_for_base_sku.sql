-- Phase 3: when a campaign launches, clear any stale repricer-queued prices for
-- that SKU's listings (across all stores) so a previously-queued reprice can't
-- still go out and undo the sale. Matches base + pack-size (-Qnn) variants.
CREATE OR REPLACE FUNCTION public.clear_pending_for_base_sku(p_base_sku text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  DELETE FROM public.threeds_reprice_pending
  WHERE regexp_replace(sku, '(?i)-Q[0-9]+$', '') = p_base_sku;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
