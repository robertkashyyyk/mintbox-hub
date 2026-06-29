-- ============================================================================
-- 20260630270000_amazon_unmapped_and_manual.sql
-- The Housekeeping "Amazon SKUs to map" queue: a view of demand ASINs with no
-- catalogue mapping (the ~23% own-brand residue), and an RPC to set a manual
-- mapping (pinned with is_manual=true so the nightly rebuild never overwrites it).
-- ============================================================================

CREATE OR REPLACE VIEW amazon.v_fba_unmapped AS
WITH demand AS (
    SELECT marketplace_id, child_asin AS asin,
           SUM(units_ordered) AS units, SUM(ordered_product_sales) AS revenue
    FROM amazon.sales_traffic_daily
    WHERE metric_date >= CURRENT_DATE - 56 AND units_ordered > 0
    GROUP BY 1, 2
),
lst AS (
    SELECT DISTINCT ON (marketplace_id, asin) marketplace_id, asin, seller_sku, item_name, ean
    FROM amazon.listings WHERE asin IS NOT NULL
    ORDER BY marketplace_id, asin, seller_sku
)
SELECT
    d.marketplace_id, d.asin, d.units, d.revenue,
    COALESCE(l.seller_sku, x.resolved_sku) AS amazon_sku,
    l.item_name AS title,
    l.ean
FROM demand d
LEFT JOIN amazon.asin_sku_map m ON m.marketplace_id = d.marketplace_id AND m.asin = d.asin
LEFT JOIN lst l                 ON l.marketplace_id = d.marketplace_id AND l.asin = d.asin
LEFT JOIN amazon.v_asin_sku x   ON x.marketplace_id = d.marketplace_id AND x.asin = d.asin
WHERE m.asin IS NULL;   -- no mapping (auto or manual) yet

DROP VIEW IF EXISTS public.v_fba_unmapped;
CREATE VIEW public.v_fba_unmapped AS SELECT * FROM amazon.v_fba_unmapped;
REVOKE ALL ON public.v_fba_unmapped FROM anon;
GRANT SELECT ON public.v_fba_unmapped TO authenticated;

-- Set (or clear) a manual ASIN -> catalogue SKU mapping. NULL catalogue_sku
-- removes the manual row (lets auto-mapping reclaim it on next rebuild).
CREATE OR REPLACE FUNCTION public.amazon_set_manual_map(
    p_marketplace_id TEXT,
    p_asin           TEXT,
    p_catalogue_sku  TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, amazon
AS $$
BEGIN
    IF p_catalogue_sku IS NULL OR btrim(p_catalogue_sku) = '' THEN
        DELETE FROM amazon.asin_sku_map
        WHERE marketplace_id = p_marketplace_id AND asin = p_asin AND is_manual;
        RETURN jsonb_build_object('cleared', TRUE, 'asin', p_asin);
    END IF;

    INSERT INTO amazon.asin_sku_map (marketplace_id, asin, catalogue_sku, match_method, confidence, is_manual, resolved_at)
    VALUES (p_marketplace_id, p_asin, btrim(p_catalogue_sku), 'manual', NULL, TRUE, NOW())
    ON CONFLICT (marketplace_id, asin) DO UPDATE
        SET catalogue_sku = btrim(p_catalogue_sku), match_method = 'manual', is_manual = TRUE, resolved_at = NOW();
    RETURN jsonb_build_object('mapped', TRUE, 'asin', p_asin, 'catalogue_sku', btrim(p_catalogue_sku));
END;
$$;
REVOKE ALL ON FUNCTION public.amazon_set_manual_map(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_set_manual_map(TEXT, TEXT, TEXT) TO authenticated, service_role;
