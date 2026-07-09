-- Add AOV (average order value) as a first-class scorecard metric.
-- Applied live via MCP apply_migration 2026-07-02; kept here for version control.
--
-- profit_weekly_snapshots already carries `aov` (revenue / order_count, FBA-inclusive).
-- Surfacing it as metric aov_gbp in the 'profit' area gives the in-app Scorecard a tile +
-- sparkline and lets Orin narrate its direction of travel (the team is actively lifting AOV:
-- each +£1 ≈ £0.68 incremental profit per order). Only the added UNION and the RAG seed are
-- new; the rest of get_scorecard is unchanged from 20260621140000_scorecard_orin_extra_metrics.
--
-- (Full CREATE OR REPLACE lives in the applied migration; here we document the delta.)
-- The added metric row in the raw CTE:
--   SELECT 'profit','aov_gbp','Average order value','gbp',
--          iso_year*100+iso_week, iso_year||'-W'||lpad(iso_week::text,2,'0'), round(aov::numeric,2)
--   FROM profit_weekly_snapshots
--
-- RAG band: up is good; >1% WoW drop = amber, >2.5% = red.
UPDATE public.app_settings
SET value = jsonb_set(COALESCE(value,'{}'::jsonb), '{aov_gbp}', '{"good":"up","amber":1.0,"red":2.5}'::jsonb)
WHERE key = 'scorecard.rag';

-- NOTE: the get_scorecard() body was recreated with the aov_gbp UNION via apply_migration
-- 'scorecard_add_aov_metric' (2026-07-02). This file records the config delta; the function
-- source of truth is the live definition (pull with pg_get_functiondef if regenerating).
