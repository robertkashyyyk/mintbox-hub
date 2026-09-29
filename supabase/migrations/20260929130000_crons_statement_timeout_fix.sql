-- Fix silently-failing maintenance crons (jobs 61/60/21/73) that hit the 120s
-- session statement_timeout as data volume grew. Applied live via MCP; captured here.
-- Approach: attach a generous per-function statement_timeout (15 min) so the refreshes
-- run under their own ceiling regardless of the caller's session default.

alter function public.refresh_order_line_economics()      set statement_timeout = '900000';
alter function public.refresh_threeds_sku_aliases(integer) set statement_timeout = '900000';
alter function public.amazon_refresh_economics()           set statement_timeout = '900000';
alter function public.amazon_rebuild_sku_map()             set statement_timeout = '900000';

-- Job 21 ran a bare "REFRESH MATERIALIZED VIEW sku_velocity" in cron with no function to
-- attach the GUC to. Wrap it (sku_velocity has a unique index, so CONCURRENTLY is safe
-- and avoids the read-lock), then repoint the cron job at the wrapper.
create or replace function public.refresh_sku_velocity()
  returns void language plpgsql security definer
  set search_path = public set statement_timeout = '900000'
as $$
begin
  refresh materialized view concurrently sku_velocity;
end
$$;

select cron.alter_job(21, command => $$select public.refresh_sku_velocity();$$);
