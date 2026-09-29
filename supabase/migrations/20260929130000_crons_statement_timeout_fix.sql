-- Fix silently-failing maintenance crons (jobs 61/60/21/73) that hit the DB-default
-- 120s statement_timeout as data volume grew (60 dead since 28 Jul; 61 intermittent
-- since 22 Sep). Applied live via MCP; captured here.
--
-- IMPORTANT: a per-function `ALTER FUNCTION ... SET statement_timeout` is NOT enough —
-- it only governs statements executed INSIDE the function, while the top-level cron
-- statement (`SELECT refresh_*()`) is still capped by the session default. Verified:
-- with only the function-level setting, refresh_threeds_sku_aliases still died at
-- exactly 120s. The effective fix is to raise statement_timeout in the CRON COMMAND
-- (session-level) so the whole call runs under the 15-min ceiling. The ALTER FUNCTION
-- lines are kept as belt-and-braces for any other caller.

alter function public.refresh_order_line_economics()      set statement_timeout = '900000';
alter function public.refresh_threeds_sku_aliases(integer) set statement_timeout = '900000';
alter function public.amazon_refresh_economics()           set statement_timeout = '900000';
alter function public.amazon_rebuild_sku_map()             set statement_timeout = '900000';

-- Job 21 ran a bare "REFRESH MATERIALIZED VIEW sku_velocity". Wrap it (sku_velocity has
-- a unique index, so CONCURRENTLY is safe and avoids the read-lock).
create or replace function public.refresh_sku_velocity()
  returns void language plpgsql security definer
  set search_path = public set statement_timeout = '900000'
as $$
begin
  refresh materialized view concurrently sku_velocity;
end
$$;

-- The actual fix: set the timeout at the cron-command (session) level.
select cron.alter_job(61, command => $$SET statement_timeout='900000'; SELECT public.refresh_order_line_economics();$$);
select cron.alter_job(60, command => $$SET statement_timeout='900000'; SELECT public.refresh_threeds_sku_aliases(180);$$);
select cron.alter_job(21, command => $$SET statement_timeout='900000'; SELECT public.refresh_sku_velocity();$$);
select cron.alter_job(73, command => $$SET statement_timeout='900000'; SELECT public.amazon_rebuild_sku_map(); SELECT public.amazon_refresh_economics();$$);
