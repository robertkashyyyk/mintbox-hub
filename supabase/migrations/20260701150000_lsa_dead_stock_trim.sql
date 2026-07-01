-- Dead-stock LSA trim: give auto-update-lsa-cron a "genuinely dead" signal so it can
-- safely lower an OUT-OF-STOCK item's stale-high LSA to the floor.
--
-- Why: the buy engine treats low_stock_alert_level > lsa.min_threshold (1) as a reorder
-- point (effective_lsa; see buy-recs RPC). So a stale-high LSA on a product with no demand
-- drives PHANTOM purchase orders. auto-update-lsa lowers such items when in stock, but its
-- IN-STOCK guard refuses to lower OOS items — because "0 sales while OOS" usually means
-- "couldn't sell", not "no demand". That guard is right for real sellers temporarily out,
-- but it also traps genuinely-dead stock at a high LSA, feeding phantom buys.
--
-- Resolution: distinguish the two with a LONG window. An OOS item with ZERO sales over
-- lsa.dead_window_weeks (default 26) is genuinely dead — safe to trim to the floor. Anything
-- with sales in that window stays protected. This RPC returns, from a candidate SKU list,
-- only those that ARE alive (have sales in the window); the caller trims the rest.

INSERT INTO app_settings (key, value, description)
VALUES (
  'lsa.dead_window_weeks',
  '26'::jsonb,
  'Weeks of zero sales after which an OUT-OF-STOCK item is treated as genuinely dead, allowing auto-LSA to trim its stale alert level to the floor (prevents phantom reorders). Longer than lsa.weekly_window_weeks so a hot seller merely out of stock is not mistaken for dead.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lsa_skus_with_recent_sales(
  p_skus text[],
  p_weeks int DEFAULT NULL
)
RETURNS TABLE(sku text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH cfg AS (
    SELECT COALESCE(
      p_weeks,
      (SELECT (value)::int FROM app_settings WHERE key = 'lsa.dead_window_weeks'),
      26
    ) AS weeks
  )
  SELECT DISTINCT ol.sku
  FROM order_lines ol, cfg
  WHERE ol.sku = ANY(p_skus)
    AND ol.order_date >= now() - (cfg.weeks || ' weeks')::interval;
$function$;

REVOKE ALL ON FUNCTION public.lsa_skus_with_recent_sales(text[], int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lsa_skus_with_recent_sales(text[], int) TO service_role, authenticated;
