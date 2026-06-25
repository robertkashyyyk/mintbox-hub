-- ============================================================================
-- Clearance Build 2 — drive listing detection from listing_coverage (every
-- ACTIVE eBay listing) instead of threeds_listings (order-history only, so it
-- misses listed-but-not-recently-sold SKUs → false "record only"). Same output
-- shape as get_campaign_listings_for_sku so it's a drop-in for the launch push.
-- store_id comes from threeds_stores via ebay_store_slug = coverage.store_name.
-- Base-SKU match (folds -Q pack variants) for parity with the old RPC.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_coverage_listings_for_sku(p_base_sku text)
RETURNS TABLE(listing_sku text, store_id uuid, store_name text, current_price numeric, external_item_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT lc.listing_sku, s.id, lc.store_name, lc.price, lc.item_id
  FROM listing_coverage lc
  JOIN threeds_stores s ON s.ebay_store_slug = lc.store_name AND s.enabled = true
  WHERE lc.channel = 'ebay' AND lc.status = 'Active'
    AND COALESCE(lc.price, 0) > 0
    AND regexp_replace(lc.sku, '(?i)-Q[0-9]+$', '') = p_base_sku
  ORDER BY lc.listing_sku;
$$;

GRANT EXECUTE ON FUNCTION public.get_coverage_listings_for_sku(text) TO authenticated;
