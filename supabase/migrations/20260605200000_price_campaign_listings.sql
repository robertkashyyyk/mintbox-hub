-- Price Campaigns Phase 2: per-listing snapshots so a campaign can push and
-- revert real channel prices. A base SKU has multiple 3DS listings (pack-size
-- Q-code variants) at different prices, so a clearance is applied as a % off
-- each listing's current price and snapshotted per listing for exact revert.

ALTER TABLE public.price_campaigns
  ADD COLUMN IF NOT EXISTS discount_pct numeric,
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.price_campaign_listings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     uuid NOT NULL REFERENCES public.price_campaigns(id) ON DELETE CASCADE,
  listing_sku     text NOT NULL,           -- the Q-coded listing SKU actually pushed
  store_id        uuid,
  store_name      text,
  original_price  numeric,                 -- snapshot at launch (revert target)
  sale_price      numeric,                 -- pushed price
  pushed_at       timestamptz,
  reverted_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcl_campaign ON public.price_campaign_listings(campaign_id);

ALTER TABLE public.price_campaign_listings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read pcl"  ON public.price_campaign_listings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write pcl" ON public.price_campaign_listings FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- Helper: a base SKU's 3DS listings across enabled stores, with current price.
CREATE OR REPLACE FUNCTION public.get_campaign_listings_for_sku(p_base_sku text)
RETURNS TABLE(listing_sku text, store_id uuid, store_name text, current_price numeric, external_item_id text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.sku, s.id, l.store_name, l.last_unit_price, l.external_item_id
  FROM threeds_listings l
  JOIN threeds_stores s ON s.store_name = l.store_name AND s.enabled = true
  WHERE l.base_sku = p_base_sku
    AND l.last_unit_price > 0
  ORDER BY l.sku;
$$;
