-- ============================================================================
-- Durable, queryable repricing intervention ledger: one row per applied price
-- change. Materialised from amazon.sync_run (the runners' durable log) via an
-- idempotent ETL, so the live edge functions are untouched. JSON parsed in ONE
-- place. (Applied to the remote DB via MCP on 2026-07-02; captured here for repo
-- parity — CREATE ... IF NOT EXISTS / OR REPLACE make re-runs safe.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS amazon.reprice_action (
  id            bigserial PRIMARY KEY,
  lever         text NOT NULL,            -- 'margin' | 'fba_guard' (future: 'clearance')
  esagu_item_id bigint,
  asin          text,
  old_max       numeric,                  -- £ ceiling before the change
  new_max       numeric,                  -- £ ceiling after
  status        int,                      -- eSagu PUT status (204 = applied)
  acted_at      timestamptz NOT NULL,
  UNIQUE (lever, esagu_item_id, acted_at)
);
CREATE INDEX IF NOT EXISTS ix_reprice_action_lever_time ON amazon.reprice_action (lever, acted_at);
CREATE INDEX IF NOT EXISTS ix_reprice_action_item ON amazon.reprice_action (esagu_item_id);

-- Idempotent ETL: pull any not-yet-ledgered successful changes from sync_run.
-- Cron: 'sync-reprice-ledger-daily' @ 08:00 UTC calls SELECT sync_reprice_ledger();
CREATE OR REPLACE FUNCTION public.sync_reprice_ledger()
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH ins AS (
    INSERT INTO amazon.reprice_action (lever, esagu_item_id, asin, old_max, new_max, status, acted_at)
    SELECT
      CASE sr.object WHEN 'esagu_margin_guard' THEN 'margin'
                     WHEN 'esagu_fba_guard'    THEN 'fba_guard' END,
      (r->>'id')::bigint,
      e.asin,
      NULLIF(r->>'from','')::numeric/100,
      NULLIF(r->>'to','')::numeric/100,
      NULLIF(r->>'status','')::int,
      sr.finished_at
    FROM amazon.sync_run sr
    CROSS JOIN LATERAL jsonb_array_elements(sr.next_cursor->'results') r
    LEFT JOIN amazon.esagu_item e ON e.esagu_item_id = (r->>'id')::bigint
    WHERE sr.object IN ('esagu_margin_guard','esagu_fba_guard')
      AND (r->>'status') = '204'
      AND (r->>'id') IS NOT NULL
    ON CONFLICT (lever, esagu_item_id, acted_at) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM ins;
$function$;
