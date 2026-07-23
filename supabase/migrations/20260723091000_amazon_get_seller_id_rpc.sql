-- The amazon schema is sealed off PostgREST, so edge functions read
-- connection config via a definer RPC (service_role-only), matching the
-- existing ingest-RPC pattern. Applied to prod 2026-07-23 via MCP.
create or replace function public.amazon_get_seller_id()
returns text
language sql
stable
security definer
set search_path = public, amazon
as $$
  select c.seller_id from amazon.connection c where c.status = 'active' limit 1
$$;
revoke all on function public.amazon_get_seller_id() from public, anon, authenticated;
grant execute on function public.amazon_get_seller_id() to service_role;
