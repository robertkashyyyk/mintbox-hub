-- ============================================================================
-- Interface contract with the eSagu chat: add `channels text[]` to price_campaigns.
-- This is THE shared signal — the Sale/Liquidation side owns it; the eSagu side
-- keys enactment + the price-lever ring-fence off it.  (Option A from the contract:
-- explicit array, models "both" natively, future-proof.)
--
-- Every existing row → '{ebay}' (today's behaviour). Campaigns we've already
-- backfilled onto Amazon (they have an applied eSagu clearance snapshot) → add
-- 'amazon' so the signal reflects reality.
-- ============================================================================
ALTER TABLE public.price_campaigns
  ADD COLUMN IF NOT EXISTS channels text[] NOT NULL DEFAULT '{ebay}';

-- reflect the Amazon backfill in the signal
UPDATE public.price_campaigns pc
SET channels = ARRAY(SELECT DISTINCT unnest(pc.channels || '{amazon}'::text[]))
WHERE 'amazon' <> ALL(pc.channels)
  AND EXISTS (
    SELECT 1 FROM amazon.esagu_campaign_strategy s
    WHERE s.campaign_id = pc.id AND s.status = 'applied'
  );

COMMENT ON COLUMN public.price_campaigns.channels IS
  'Channels this clearance applies to: ebay, amazon. eSagu enacts + ring-fences any campaign where ''amazon'' = ANY(channels) and status is active.';
