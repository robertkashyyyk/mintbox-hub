-- ============================================================================
-- 20260630360000_fba_switch_foundation.sql
-- Foundation for the "FBA Switch" decision (FBM items worth moving to FBA):
--   amazon.fba_fee_estimate      <- Product Fees API (Amazon's own FBA-fee estimate per ASIN)
--   amazon_ingest_fee_estimates()   thin upsert
--   amazon.fba_switch_exclusions  + amazon_set_fba_exclusion()  -- dismiss-with-reason
-- The candidates view + page come next (once estimates are pulled).
-- ============================================================================

-- Amazon's fee estimate per ASIN at a given price (IsAmazonFulfilled=true). -----
CREATE TABLE IF NOT EXISTS amazon.fba_fee_estimate (
    marketplace_id   TEXT NOT NULL,
    asin             TEXT NOT NULL,
    price_used       NUMERIC(18,2),          -- price the estimate was computed at
    fba_fee          NUMERIC(18,2),          -- FBA fulfilment fee (the unlock)
    referral_fee     NUMERIC(18,2),
    total_fees       NUMERIC(18,2),
    currency_code    CHAR(3) DEFAULT 'GBP',
    status           TEXT,                   -- Success | ClientError | ServiceError
    error_message    TEXT,
    estimated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (marketplace_id, asin)
);

CREATE OR REPLACE FUNCTION public.amazon_ingest_fee_estimates(
    p_marketplace_id TEXT,
    p_rows           JSONB   -- [{asin, price_used, fba_fee, referral_fee, total_fees, status, error_message}]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, amazon
AS $$
DECLARE v_n INTEGER := 0;
BEGIN
    INSERT INTO amazon.fba_fee_estimate
        (marketplace_id, asin, price_used, fba_fee, referral_fee, total_fees, currency_code, status, error_message, estimated_at)
    SELECT DISTINCT ON (r ->> 'asin')
        p_marketplace_id, r ->> 'asin',
        NULLIF(r ->> 'price_used','')::numeric,
        NULLIF(r ->> 'fba_fee','')::numeric,
        NULLIF(r ->> 'referral_fee','')::numeric,
        NULLIF(r ->> 'total_fees','')::numeric,
        COALESCE(NULLIF(r ->> 'currency_code',''), 'GBP'),
        NULLIF(r ->> 'status',''), NULLIF(r ->> 'error_message',''), NOW()
    FROM jsonb_array_elements(COALESCE(p_rows,'[]'::jsonb)) AS r
    WHERE COALESCE(r ->> 'asin','') <> ''
    ORDER BY r ->> 'asin'
    ON CONFLICT (marketplace_id, asin) DO UPDATE SET
        price_used = EXCLUDED.price_used, fba_fee = EXCLUDED.fba_fee, referral_fee = EXCLUDED.referral_fee,
        total_fees = EXCLUDED.total_fees, currency_code = EXCLUDED.currency_code,
        status = EXCLUDED.status, error_message = EXCLUDED.error_message, estimated_at = NOW();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('rows_upserted', v_n);
END;
$$;
REVOKE ALL ON FUNCTION public.amazon_ingest_fee_estimates(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_ingest_fee_estimates(TEXT, JSONB) TO service_role;

-- Dismiss-with-reason: items that can't go FBA (hazmat, packaging, etc.). -------
CREATE TABLE IF NOT EXISTS amazon.fba_switch_exclusions (
    sku          TEXT PRIMARY KEY,
    reason       TEXT NOT NULL,             -- hazmat | packaging | oversize | low_value | other
    note         TEXT,
    excluded_by  UUID,
    excluded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.amazon_set_fba_exclusion(
    p_sku TEXT, p_reason TEXT, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, amazon
AS $$
BEGIN
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        DELETE FROM amazon.fba_switch_exclusions WHERE sku = p_sku;
        RETURN jsonb_build_object('cleared', TRUE, 'sku', p_sku);
    END IF;
    INSERT INTO amazon.fba_switch_exclusions (sku, reason, note, excluded_by)
    VALUES (p_sku, p_reason, NULLIF(btrim(COALESCE(p_note,'')),''), auth.uid())
    ON CONFLICT (sku) DO UPDATE
        SET reason = EXCLUDED.reason, note = EXCLUDED.note, excluded_by = auth.uid(), excluded_at = NOW();
    RETURN jsonb_build_object('excluded', TRUE, 'sku', p_sku, 'reason', p_reason);
END;
$$;
REVOKE ALL ON FUNCTION public.amazon_set_fba_exclusion(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.amazon_set_fba_exclusion(TEXT, TEXT, TEXT) TO authenticated, service_role;
