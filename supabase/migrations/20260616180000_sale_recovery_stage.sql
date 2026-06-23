-- ============================================================================
-- Phase A.1 — `stage` model + stepped Sale recovery
-- ----------------------------------------------------------------------------
-- Problem fixed: the repricer ring-fence (and liquidation candidate filters) all
-- key on price_campaigns.status='active'. Phase A moved finished sales to
-- status='review', which DROPPED them out of the ring-fence — the nightly
-- repricer could move a price mid-review. A recovering sale would hit the same.
--
-- Fix (Option 2): the whole MANAGED lifecycle stays status='active'; a new
-- `stage` column carries the sub-state (selling → review → recovering). The
-- ring-fence already excludes status='active', so review + recovering are now
-- protected with ZERO changes to the repricer. Only ended/reverted release a SKU.
--
-- Recovery: a daily cron walks each listing's price from its sale price back to
-- the pre-sale original over N weekly steps by UPSERTING into threeds_reprice_pending
-- (source='liquidation'); the existing nightly reconcile flushes it to SFTP. On
-- completion the campaign ends → the SKU returns to the normal repricer, which
-- manages it to the proper band ongoing.
--
-- Idempotent. Depends on: 20260616170000 (Phase A), 20260604180000 (pending),
-- 20260605180000 (price_campaigns / listings).
-- ============================================================================

-- ── New columns ─────────────────────────────────────────────────────────────
ALTER TABLE public.price_campaigns
  ADD COLUMN IF NOT EXISTS stage                 text,
  ADD COLUMN IF NOT EXISTS recovery_weeks        integer,
  ADD COLUMN IF NOT EXISTS recovery_step         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_next_at      date,
  ADD COLUMN IF NOT EXISTS recovery_target_price numeric;

ALTER TABLE public.price_campaigns DROP CONSTRAINT IF EXISTS price_campaigns_stage_check;
ALTER TABLE public.price_campaigns ADD  CONSTRAINT price_campaigns_stage_check
  CHECK (stage IS NULL OR stage IN ('selling','review','recovering'));

-- ── Backfill into the stage model ───────────────────────────────────────────
-- Existing live sales → 'selling'; any Phase-A review rows → active + 'review'.
UPDATE public.price_campaigns SET stage = 'selling'
  WHERE status = 'active' AND type = 'sale' AND stage IS NULL;
UPDATE public.price_campaigns SET status = 'active', stage = 'review'
  WHERE status = 'review';

CREATE INDEX IF NOT EXISTS idx_price_campaigns_stage
  ON public.price_campaigns(stage) WHERE stage IS NOT NULL;

-- ============================================================================
-- process_due_sales() — now stage-based: a SELLING sale past end_date becomes
-- stage='review' (status STAYS 'active', so it stays ring-fenced) + raises a task.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_due_sales()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_owner   uuid;
  v_creator uuid;
  v_count   integer := 0;
  r         record;
BEGIN
  SELECT CASE WHEN (value #>> '{}') ~ '^[0-9a-fA-F-]{36}$'
              THEN (value #>> '{}')::uuid END
    INTO v_owner
  FROM app_settings WHERE key = 'sale_review_owner';

  FOR r IN
    SELECT * FROM price_campaigns
    WHERE type = 'sale' AND status = 'active' AND stage = 'selling'
      AND end_date IS NOT NULL AND end_date <= current_date
  LOOP
    UPDATE price_campaigns SET stage = 'review', updated_at = now() WHERE id = r.id;

    v_creator := COALESCE(v_owner, r.created_by);
    IF v_creator IS NOT NULL THEN
      INSERT INTO tasks (
        created_by, assigned_to, task_type, title, description,
        priority_level, due_date,
        linked_entity_type, linked_entity_id, linked_entity_label,
        source_module, source_rule, tags
      )
      SELECT
        v_creator, COALESCE(v_owner, r.created_by), 'system_generated',
        'Sale review: ' || r.sku,
        'A ' || COALESCE(r.discount_pct::text, '?') || '% sale on ' || r.sku ||
          ' has reached its end date. Review performance, then remove from sale ' ||
          '(restore price), hold, reduce further, or recover to band.',
        2, now() + interval '2 days',
        'price_campaign', r.id::text, r.sku,
        'commercial', 'sale_review_due', ARRAY['sale','review']
      WHERE NOT EXISTS (
        SELECT 1 FROM tasks t
        WHERE t.source_rule = 'sale_review_due'
          AND t.linked_entity_id = r.id::text
          AND t.status NOT IN ('done','cancelled')
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================================================
-- get_sale_reviews() — now stage-based (status='active' AND stage='review');
-- adds baseline_cost so the UI can show the normal-band reference.
-- DROP first: the Phase-A version returns a narrower row type, and CREATE OR
-- REPLACE cannot change a function's OUT columns.
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_sale_reviews();
CREATE OR REPLACE FUNCTION public.get_sale_reviews()
RETURNS TABLE(
  id                uuid,
  sku               text,
  discount_pct      numeric,
  original_price    numeric,
  campaign_price    numeric,
  baseline_velocity numeric,
  baseline_cost     numeric,
  start_date        date,
  end_date          date,
  notes             text,
  units_sold_window integer,
  revenue_window    numeric,
  days_live         integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH rv AS (
    SELECT * FROM price_campaigns WHERE status = 'active' AND stage = 'review' AND type = 'sale'
  ),
  sales AS (
    SELECT
      regexp_replace(ol.sku, '-Q[0-9]+$', '') AS base_sku,
      ol.order_date, ol.qty, ol.unit_price
    FROM order_lines ol
    WHERE ol.order_date >= (SELECT min(start_date) FROM rv)
      AND regexp_replace(ol.sku, '-Q[0-9]+$', '') IN (SELECT sku FROM rv)
  )
  SELECT
    rv.id, rv.sku, rv.discount_pct, rv.original_price, rv.campaign_price,
    rv.baseline_velocity, rv.baseline_cost, rv.start_date, rv.end_date, rv.notes,
    COALESCE(SUM(s.qty) FILTER (WHERE s.order_date >= rv.start_date), 0)::integer,
    round(COALESCE(SUM(s.qty * s.unit_price) FILTER (WHERE s.order_date >= rv.start_date), 0), 2),
    GREATEST(0, (current_date - rv.start_date))::integer
  FROM rv
  LEFT JOIN sales s ON s.base_sku = rv.sku
  GROUP BY rv.id, rv.sku, rv.discount_pct, rv.original_price, rv.campaign_price,
           rv.baseline_velocity, rv.baseline_cost, rv.start_date, rv.end_date, rv.notes
  ORDER BY rv.end_date NULLS LAST, rv.sku;
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_reviews() TO authenticated;

-- ============================================================================
-- process_sale_recovery() — one weekly step per recovering campaign. Queues
-- per-listing prices (sale → original, linear over recovery_weeks) into
-- threeds_reprice_pending; the nightly reconcile flushes them to SFTP. Ends the
-- campaign on the final step (releases the SKU back to the repricer). Returns
-- the number of campaigns stepped.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_sale_recovery()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  c       record;
  v_step  integer;
  v_frac  numeric;
  v_done  boolean;
BEGIN
  FOR c IN
    SELECT * FROM price_campaigns
    WHERE status = 'active' AND stage = 'recovering'
      AND recovery_weeks IS NOT NULL AND recovery_weeks > 0
      AND recovery_next_at IS NOT NULL AND recovery_next_at <= current_date
  LOOP
    v_step := COALESCE(c.recovery_step, 0) + 1;
    v_frac := LEAST(v_step::numeric / c.recovery_weeks::numeric, 1);
    v_done := v_step >= c.recovery_weeks;

    -- Step each listing's price from sale_price toward original_price.
    INSERT INTO threeds_reprice_pending (store_id, sku, price, status, source, queued_at, queued_by)
    SELECT
      l.store_id, l.listing_sku,
      round(l.sale_price + (l.original_price - l.sale_price) * v_frac, 2),
      'pending', 'liquidation', now(), c.created_by
    FROM price_campaign_listings l
    WHERE l.campaign_id = c.id AND l.store_id IS NOT NULL
      AND l.original_price IS NOT NULL AND l.sale_price IS NOT NULL
    ON CONFLICT (store_id, sku) DO UPDATE
      SET price = EXCLUDED.price, status = 'pending', source = 'liquidation',
          queued_at = now(), queued_by = EXCLUDED.queued_by;

    UPDATE price_campaigns SET
      recovery_step    = v_step,
      campaign_price   = (SELECT max(round(l.sale_price + (l.original_price - l.sale_price) * v_frac, 2))
                          FROM price_campaign_listings l WHERE l.campaign_id = c.id),
      recovery_next_at = current_date + 7,
      status   = CASE WHEN v_done THEN 'ended'  ELSE 'active'     END,
      stage    = CASE WHEN v_done THEN NULL     ELSE 'recovering' END,
      outcome  = CASE WHEN v_done THEN 'worked' ELSE outcome      END,
      end_date = CASE WHEN v_done THEN current_date ELSE end_date END,
      updated_at = now()
    WHERE id = c.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_sale_recovery() TO authenticated;

-- ── Daily recovery sweep (06:45 UTC; before the 23:30 reconcile flush). ──────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('process-sale-recovery-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-sale-recovery-daily');
    PERFORM cron.schedule(
      'process-sale-recovery-daily',
      '45 6 * * *',
      $cron$ SELECT public.process_sale_recovery(); $cron$
    );
  END IF;
END $$;
