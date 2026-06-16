-- Distinguish profit-repricer pushes from liquidation/clearance pushes.
--
-- Both the repricer and the Liquidation page push through threeds-reprice-push
-- into threeds_reprice_pending, with no marker. The Repricing Payoff report reads
-- that table, so deliberate clearance price-cuts were being counted as repricing
-- value (inflating or dragging the number). Tag the source and let payoff filter.

ALTER TABLE public.threeds_reprice_pending
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'repricer';

-- Reclassify any existing pending/applied rows that came from a clearance campaign
-- (matched by store + listing SKU) so historical clearance stops polluting payoff.
UPDATE public.threeds_reprice_pending p
SET source = 'liquidation'
FROM public.price_campaign_listings l
WHERE p.store_id = l.store_id
  AND p.sku = l.listing_sku
  AND p.source <> 'liquidation';
