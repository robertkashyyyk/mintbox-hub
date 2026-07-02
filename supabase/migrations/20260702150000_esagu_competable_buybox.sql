-- ============================================================================
-- 20260702150000_esagu_competable_buybox.sql
-- Refine amazon.esagu_item with the "competable" competitor: the cheapest offer
-- eSagu will actually compete with (excludes ships-from-abroad / excluded
-- sellers via offer.exclusionReasons). buy_box_price may be held by an excluded
-- seller (buy_box_excluded=true) — in which case competable_price is the real
-- target, not the featured-offer price.
-- ============================================================================

ALTER TABLE amazon.esagu_item
  ADD COLUMN IF NOT EXISTS competable_price  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS competable_seller TEXT,
  ADD COLUMN IF NOT EXISTS buy_box_excluded  BOOLEAN;

CREATE OR REPLACE FUNCTION public.amazon_ingest_esagu_items(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, amazon
SET statement_timeout = '180s'
AS $$
DECLARE
    v_conn UUID := amazon._ensure_connection('A1F83G8C2ARO7P');
    v_run  UUID;
    v_n    INTEGER;
BEGIN
    INSERT INTO amazon.sync_run (connection_id, object, mode, status)
    VALUES (v_conn, 'esagu_items', 'incremental', 'running') RETURNING sync_run_id INTO v_run;

    INSERT INTO amazon.esagu_item AS e (
        esagu_item_id, marketplace_id, esagu_sku, asin, catalogue_sku, title, fba, prime, quantity,
        merchant_shipping_group, amazon_price, min_price, max_price, fixed_price, mode,
        buy_box_seller, buy_box_price, buy_box_excluded, competable_price, competable_seller,
        is_our_buybox, offer_count, strategy, offers,
        esagu_inserted, esagu_updated, offers_updated, synced_at)
    SELECT
        (r->>'id')::bigint, 'A1F83G8C2ARO7P', NULLIF(r->>'sku',''), NULLIF(r->>'asin',''), m.catalogue_sku,
        NULLIF(r->>'title',''), (r->>'fba')::boolean, (r->>'prime')::boolean, NULLIF(r->>'quantity','')::int,
        NULLIF(r->>'merchantShippingGroup',''),
        NULLIF(r->>'amazonPrice','')::numeric, NULLIF(r->>'minPrice','')::numeric,
        NULLIF(r->>'maxPrice','')::numeric, NULLIF(r->>'fixedPrice','')::numeric, NULLIF(r->>'mode',''),
        NULLIF(r->>'buyBoxSeller',''), NULLIF(r->>'buyBoxPrice','')::numeric,
        CASE WHEN r ? 'buyBoxExcluded' THEN (r->>'buyBoxExcluded')::boolean ELSE NULL END,
        NULLIF(r->>'competablePrice','')::numeric, NULLIF(r->>'competableSeller',''),
        CASE WHEN r ? 'isOurBuybox' THEN (r->>'isOurBuybox')::boolean ELSE NULL END,
        NULLIF(r->>'offerCount','')::int, r->'strategy', r->'offers',
        NULLIF(r->>'esaguInserted','')::timestamptz, NULLIF(r->>'esaguUpdated','')::timestamptz,
        NULLIF(r->>'offersUpdated','')::timestamptz, NOW()
    FROM jsonb_array_elements(p_items) r
    LEFT JOIN amazon.asin_sku_map m
      ON m.marketplace_id = 'A1F83G8C2ARO7P' AND m.asin = NULLIF(r->>'asin','')
    ON CONFLICT (esagu_item_id) DO UPDATE SET
        esagu_sku = EXCLUDED.esagu_sku, asin = EXCLUDED.asin, catalogue_sku = EXCLUDED.catalogue_sku,
        title = EXCLUDED.title, fba = EXCLUDED.fba, prime = EXCLUDED.prime, quantity = EXCLUDED.quantity,
        merchant_shipping_group = EXCLUDED.merchant_shipping_group, amazon_price = EXCLUDED.amazon_price,
        min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price, fixed_price = EXCLUDED.fixed_price,
        mode = EXCLUDED.mode, buy_box_seller = EXCLUDED.buy_box_seller, buy_box_price = EXCLUDED.buy_box_price,
        buy_box_excluded = EXCLUDED.buy_box_excluded, competable_price = EXCLUDED.competable_price,
        competable_seller = EXCLUDED.competable_seller, is_our_buybox = EXCLUDED.is_our_buybox,
        offer_count = EXCLUDED.offer_count, strategy = EXCLUDED.strategy, offers = EXCLUDED.offers,
        esagu_inserted = EXCLUDED.esagu_inserted, esagu_updated = EXCLUDED.esagu_updated,
        offers_updated = EXCLUDED.offers_updated, synced_at = NOW();

    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE amazon.sync_run SET status = 'success', rows_upserted = v_n, finished_at = NOW()
    WHERE sync_run_id = v_run;
    RETURN jsonb_build_object('rows_upserted', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.amazon_ingest_esagu_items(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_esagu_items(JSONB) TO service_role;

DROP VIEW IF EXISTS public.v_esagu_buybox;
CREATE VIEW public.v_esagu_buybox AS
SELECT
    e.esagu_item_id, e.catalogue_sku, e.esagu_sku, e.asin, e.title,
    CASE WHEN e.fba THEN 'FBA' ELSE 'FBM' END AS fulfilment,
    e.quantity, e.amazon_price, e.min_price, e.max_price, e.mode,
    e.buy_box_price, e.buy_box_seller, e.buy_box_excluded,
    e.competable_price, e.competable_seller, e.is_our_buybox, e.offer_count,
    ROUND(e.amazon_price - e.competable_price, 2)                         AS price_vs_competable,   -- +ve = above a beatable rival
    (e.competable_price IS NOT NULL AND e.min_price IS NOT NULL AND e.competable_price < e.min_price) AS competable_below_floor,
    e.synced_at
FROM amazon.esagu_item e;

REVOKE ALL ON public.v_esagu_buybox FROM anon;
GRANT SELECT ON public.v_esagu_buybox TO authenticated;
