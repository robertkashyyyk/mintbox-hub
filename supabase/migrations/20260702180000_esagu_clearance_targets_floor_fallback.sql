-- Floor fallback: campaign_price is derived from the cheapest eBay listing, so an
-- Amazon-only SKU (or one launched before its listings loaded) can have a null
-- campaign_price. Fall back to the eSagu item's cached min × (1 - discount) so the
-- Amazon clearance still has a floor to lower to. campaign_price wins when present.
CREATE OR REPLACE FUNCTION public.amazon_esagu_clearance_targets(p_campaign_ids uuid[])
RETURNS TABLE(
  campaign_id   uuid,
  sku           text,
  type          text,
  floor_gbp     numeric,
  esagu_item_id bigint,
  cached_min    numeric,
  cached_max    numeric,
  fba           boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public, amazon'
AS $$
  SELECT c.id, c.sku, c.type,
         COALESCE(c.campaign_price,
                  round(e.min_price * (1 - COALESCE(c.discount_pct, 0) / 100.0), 2)) AS floor_gbp,
         e.esagu_item_id, e.min_price, e.max_price, e.fba
  FROM public.price_campaigns c
  JOIN amazon.esagu_item e ON e.catalogue_sku = c.sku
  WHERE c.id = ANY(p_campaign_ids);
$$;
REVOKE ALL ON FUNCTION public.amazon_esagu_clearance_targets(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_esagu_clearance_targets(uuid[]) TO authenticated, service_role;
