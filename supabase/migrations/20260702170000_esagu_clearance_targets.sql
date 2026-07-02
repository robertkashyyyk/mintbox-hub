-- Resolver for the Clearance→Amazon orchestrator (Phase B/D). Given campaign ids,
-- return each campaign's SKU + its clearance floor (= campaign_price, the discounted
-- price) joined to the eSagu repricing item(s) for that SKU. A SKU can map to more
-- than one Amazon offer → multiple rows (apply to all). Campaigns whose SKU isn't on
-- Amazon simply return no row (correct no-op). cached_min/max are from the daily
-- mirror (£) for display/pre-filter; the edge fn GETs the LIVE strategy for the
-- authoritative reduction check + snapshot.
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
  SELECT c.id, c.sku, c.type, c.campaign_price, e.esagu_item_id, e.min_price, e.max_price, e.fba
  FROM public.price_campaigns c
  JOIN amazon.esagu_item e ON e.catalogue_sku = c.sku
  WHERE c.id = ANY(p_campaign_ids);
$$;
REVOKE ALL ON FUNCTION public.amazon_esagu_clearance_targets(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_esagu_clearance_targets(uuid[]) TO authenticated, service_role;
