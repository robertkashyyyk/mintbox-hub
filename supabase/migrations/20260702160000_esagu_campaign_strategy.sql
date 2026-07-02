-- ============================================================================
-- eSagu clearance snapshot + revert store (Phase C of Clearance→Amazon).
--
-- When a Clearance campaign lowers an eSagu item's min-price floor (via edge fn
-- esagu-set-strategy), we must be able to put the ORIGINAL strategy back on
-- revert/end — the same one-click revert eBay already has. This records the
-- pre-clearance strategy per (campaign, eSagu item), once, so re-applying or
-- deepening a Sale never clobbers the true original.
--
-- Table lives in the sealed `amazon` schema; the Hub (authenticated) drives it
-- only through the SECURITY DEFINER public RPCs below (record / read-for-revert /
-- mark-reverted). Prices stored in PENNIES, exactly as eSagu returns them, so a
-- restore is lossless.
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon.esagu_campaign_strategy (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id       uuid   NOT NULL REFERENCES public.price_campaigns(id) ON DELETE CASCADE,
  esagu_item_id     bigint NOT NULL,          -- loose ref (survives esagu_item resync deletes)
  catalogue_sku     text,
  -- original (pre-clearance) strategy, pennies
  orig_min_price    numeric,
  orig_max_price    numeric,
  orig_fixed_price  numeric,
  orig_mode         text,
  -- what the campaign applied, pennies
  applied_min_price numeric,
  applied_max_price numeric,
  status            text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','reverted')),
  applied_at        timestamptz NOT NULL DEFAULT now(),
  reverted_at       timestamptz,
  UNIQUE (campaign_id, esagu_item_id)
);
CREATE INDEX IF NOT EXISTS idx_esagu_camp_strategy_campaign ON amazon.esagu_campaign_strategy (campaign_id);
REVOKE ALL ON amazon.esagu_campaign_strategy FROM PUBLIC, anon, authenticated;

-- ── record snapshot ─────────────────────────────────────────────────────────
-- p_items: [{ esagu_item_id, catalogue_sku, orig_min, orig_max, orig_fixed,
--             orig_mode, applied_min, applied_max }]  (all prices in pennies)
-- Inserts the ORIGINAL once; on conflict updates only the applied_* / status
-- (so a deepen keeps the true pre-clearance original for revert).
CREATE OR REPLACE FUNCTION public.amazon_record_esagu_snapshot(p_campaign_id uuid, p_items jsonb)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public, amazon'
AS $$
  WITH ins AS (
    INSERT INTO amazon.esagu_campaign_strategy AS s (
      campaign_id, esagu_item_id, catalogue_sku,
      orig_min_price, orig_max_price, orig_fixed_price, orig_mode,
      applied_min_price, applied_max_price, status, applied_at)
    SELECT
      p_campaign_id,
      (r->>'esagu_item_id')::bigint,
      NULLIF(r->>'catalogue_sku',''),
      NULLIF(r->>'orig_min','')::numeric,  NULLIF(r->>'orig_max','')::numeric,
      NULLIF(r->>'orig_fixed','')::numeric, NULLIF(r->>'orig_mode',''),
      NULLIF(r->>'applied_min','')::numeric, NULLIF(r->>'applied_max','')::numeric,
      'applied', now()
    FROM jsonb_array_elements(p_items) AS r
    WHERE (r->>'esagu_item_id') IS NOT NULL
    ON CONFLICT (campaign_id, esagu_item_id) DO UPDATE SET
      applied_min_price = EXCLUDED.applied_min_price,
      applied_max_price = EXCLUDED.applied_max_price,
      catalogue_sku     = COALESCE(EXCLUDED.catalogue_sku, s.catalogue_sku),
      status            = 'applied',
      applied_at        = now(),
      reverted_at       = NULL
    RETURNING 1)
  SELECT COALESCE(count(*),0)::integer FROM ins;
$$;
REVOKE ALL ON FUNCTION public.amazon_record_esagu_snapshot(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_record_esagu_snapshot(uuid, jsonb) TO authenticated, service_role;

-- ── read what to restore on revert (pennies → £ for the executor) ────────────
CREATE OR REPLACE FUNCTION public.amazon_esagu_snapshots_for_revert(p_campaign_id uuid)
RETURNS TABLE(esagu_item_id bigint, orig_min_price numeric, orig_max_price numeric,
              orig_min_gbp numeric, orig_max_gbp numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public, amazon'
AS $$
  SELECT s.esagu_item_id, s.orig_min_price, s.orig_max_price,
         round(s.orig_min_price/100.0, 2), round(s.orig_max_price/100.0, 2)
  FROM amazon.esagu_campaign_strategy s
  WHERE s.campaign_id = p_campaign_id AND s.status = 'applied';
$$;
REVOKE ALL ON FUNCTION public.amazon_esagu_snapshots_for_revert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_esagu_snapshots_for_revert(uuid) TO authenticated, service_role;

-- ── mark reverted (after the executor has restored the originals) ────────────
CREATE OR REPLACE FUNCTION public.amazon_mark_esagu_reverted(p_campaign_id uuid)
RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public, amazon'
AS $$
  WITH upd AS (
    UPDATE amazon.esagu_campaign_strategy
    SET status = 'reverted', reverted_at = now()
    WHERE campaign_id = p_campaign_id AND status = 'applied'
    RETURNING 1)
  SELECT COALESCE(count(*),0)::integer FROM upd;
$$;
REVOKE ALL ON FUNCTION public.amazon_mark_esagu_reverted(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.amazon_mark_esagu_reverted(uuid) TO authenticated, service_role;
