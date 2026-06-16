-- Repricer candidate RPC was hitting statement timeouts (esp. at 90 days), which
-- in "All stores" mode zeroed the whole list. Root cause: get_threeds_reprice_candidates
-- filters threeds_order_transactions by `store_url ILIKE '%slug%'` (a leading-wildcard
-- that can't use a btree) plus an order_date window — with no indexes, so every call
-- does a full table scan of all order transactions, then recomputes the
-- order_line_economics view for the courier cost.
--
-- Fixes:
--   1. btree on order_date      → the 30/90-day window scans only recent rows.
--   2. pg_trgm GIN on store_url → makes `ILIKE '%slug%'` index-able.
--   3. raise the function's statement_timeout as a safety net so a heavy window
--      can finish instead of being cancelled at the ~8s role default.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_threeds_otx_order_date
  ON public.threeds_order_transactions (order_date);

CREATE INDEX IF NOT EXISTS idx_threeds_otx_store_url_trgm
  ON public.threeds_order_transactions USING gin (store_url gin_trgm_ops);

-- order_line_economics is a view over order_lines; the courier CTE filters it by
-- channel + order_date. Index those on the underlying table to speed it up.
CREATE INDEX IF NOT EXISTS idx_order_lines_channel_order_date
  ON public.order_lines (channel, order_date);

ALTER FUNCTION public.get_threeds_reprice_candidates(text, integer)
  SET statement_timeout = '25s';
