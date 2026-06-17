-- ============================================================================
-- Phase A — Sale vs Liquidation + Sale Review loop
-- ----------------------------------------------------------------------------
-- price_campaigns already models "one concept for liquidation/sale". This adds:
--   • a first-class `sale` type (time-boxed price cut, intended to be RESTORED)
--     alongside `liquidation` (clear-and-forget),
--   • a `review` status: when a sale reaches its end_date it surfaces for a human
--     decision rather than auto-reverting,
--   • process_due_sales(): a daily evaluator that flips due sales into `review`
--     AND raises a system task (for the commercial owner / launcher) so the loop
--     can't be silently forgotten,
--   • get_sale_reviews(): the data behind the Sale Review screen (window sales vs
--     baseline).
-- Idempotent. Depends on: price_campaigns (20260605180000), tasks
-- (20260601150000), app_settings (20251231141457).
-- ============================================================================

-- ── Widen the type / status CHECK constraints ───────────────────────────────
ALTER TABLE public.price_campaigns DROP CONSTRAINT IF EXISTS price_campaigns_type_check;
ALTER TABLE public.price_campaigns ADD  CONSTRAINT price_campaigns_type_check
  CHECK (type IN ('liquidation','sale','elasticity','promo'));

ALTER TABLE public.price_campaigns DROP CONSTRAINT IF EXISTS price_campaigns_status_check;
ALTER TABLE public.price_campaigns ADD  CONSTRAINT price_campaigns_status_check
  CHECK (status IN ('active','review','ended','reverted'));

CREATE INDEX IF NOT EXISTS idx_price_campaigns_review
  ON public.price_campaigns(status) WHERE status = 'review';

-- ── Configurable owner for sale-review tasks (defaults to the launcher) ──────
INSERT INTO public.app_settings(key, value, description)
VALUES ('sale_review_owner', 'false'::jsonb,
        'auth.users.id (as a JSON string) that sale-review tasks are assigned to. If unset/invalid, the task falls back to whoever launched the sale.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- get_sale_reviews() — the Sale Review queue with window performance.
-- Sales are matched on the base SKU (folding -Q pack-size variants), from each
-- campaign's start_date. Bounded to the earliest review start_date so it never
-- scans all of order_lines.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_sale_reviews()
RETURNS TABLE(
  id                uuid,
  sku               text,
  discount_pct      numeric,
  original_price    numeric,
  campaign_price    numeric,
  baseline_velocity numeric,
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
    SELECT * FROM price_campaigns WHERE status = 'review' AND type = 'sale'
  ),
  sales AS (
    SELECT
      regexp_replace(ol.sku, '-Q[0-9]+$', '') AS base_sku,
      ol.order_date,
      ol.qty,
      ol.unit_price
    FROM order_lines ol
    WHERE ol.order_date >= (SELECT min(start_date) FROM rv)
      AND regexp_replace(ol.sku, '-Q[0-9]+$', '') IN (SELECT sku FROM rv)
  )
  SELECT
    rv.id, rv.sku, rv.discount_pct, rv.original_price, rv.campaign_price,
    rv.baseline_velocity, rv.start_date, rv.end_date, rv.notes,
    COALESCE(SUM(s.qty) FILTER (WHERE s.order_date >= rv.start_date), 0)::integer AS units_sold_window,
    round(COALESCE(SUM(s.qty * s.unit_price) FILTER (WHERE s.order_date >= rv.start_date), 0), 2) AS revenue_window,
    GREATEST(0, (current_date - rv.start_date))::integer AS days_live
  FROM rv
  LEFT JOIN sales s ON s.base_sku = rv.sku
  GROUP BY rv.id, rv.sku, rv.discount_pct, rv.original_price, rv.campaign_price,
           rv.baseline_velocity, rv.start_date, rv.end_date, rv.notes
  ORDER BY rv.end_date NULLS LAST, rv.sku;
$$;

GRANT EXECUTE ON FUNCTION public.get_sale_reviews() TO authenticated;

-- ============================================================================
-- process_due_sales() — flip due sales to `review` + raise a task. Returns the
-- number of sales moved into review. Safe to run repeatedly (task insert is
-- deduped on an open task for the same campaign).
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
  -- Resolve the configured owner; ignore the default 'false' / any non-uuid value.
  SELECT CASE WHEN (value #>> '{}') ~ '^[0-9a-fA-F-]{36}$'
              THEN (value #>> '{}')::uuid END
    INTO v_owner
  FROM app_settings WHERE key = 'sale_review_owner';

  FOR r IN
    SELECT * FROM price_campaigns
    WHERE type = 'sale' AND status = 'active'
      AND end_date IS NOT NULL AND end_date <= current_date
  LOOP
    UPDATE price_campaigns SET status = 'review', updated_at = now() WHERE id = r.id;

    v_creator := COALESCE(v_owner, r.created_by);
    IF v_creator IS NOT NULL THEN
      INSERT INTO tasks (
        created_by, assigned_to, task_type, title, description,
        priority_level, due_date,
        linked_entity_type, linked_entity_id, linked_entity_label,
        source_module, source_rule, tags
      )
      SELECT
        v_creator,
        COALESCE(v_owner, r.created_by),
        'system_generated',
        'Sale review: ' || r.sku,
        'A ' || COALESCE(r.discount_pct::text, '?') || '% sale on ' || r.sku ||
          ' has reached its end date. Review performance, then remove from sale ' ||
          '(restore price), hold, or reduce further.',
        2,
        now() + interval '2 days',
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

GRANT EXECUTE ON FUNCTION public.process_due_sales() TO authenticated;

-- ── Daily sweep (06:30 UTC). Guarded on pg_cron presence. ────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('process-due-sales-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-due-sales-daily');
    PERFORM cron.schedule(
      'process-due-sales-daily',
      '30 6 * * *',
      $cron$ SELECT public.process_due_sales(); $cron$
    );
  END IF;
END $$;
