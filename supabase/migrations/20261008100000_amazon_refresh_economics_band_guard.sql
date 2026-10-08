-- amazon-nightly-refresh had failed every night since 2026-09-30:
-- mv_profit_band_history was dropped by the September fee-rebase work and the
-- unconditional REFRESH aborted the whole transaction, leaving
-- amazon.mv_sku_economics stale. Same guard pattern already applied to
-- refresh_order_line_economics on 2026-10-01. Applied to prod 2026-10-08 via MCP.
create or replace function public.amazon_refresh_economics()
returns void
language plpgsql
security definer
set search_path = public, amazon
as $$
begin
  refresh materialized view concurrently amazon.mv_sku_economics;
  refresh materialized view concurrently public.mv_fba_order_economics;
  refresh materialized view concurrently public.mv_order_economics_all;
  -- Guarded: mv_profit_band_history was dropped by the fee-rebase work; skip if
  -- absent so it no longer rolls back the whole refresh.
  if to_regclass('public.mv_profit_band_history') is not null then
    refresh materialized view concurrently public.mv_profit_band_history;
  end if;
  analyze public.mv_fba_order_economics;
  analyze public.mv_order_economics_all;
end
$$;
