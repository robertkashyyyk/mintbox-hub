-- ============================================================================
-- Repricing impact meters (read off amazon.reprice_action). Powers the Profit-page
-- "Repricing impact" card via get_reprice_impact_summary(). (Applied to the remote
-- DB via MCP on 2026-07-02; captured here for repo parity.)
--   • margin recovery = provably-incremental £ (sold above the ORIGINAL lifted ceiling)
--   • fba guard       = buy-box recapture on capped items (point-in-time "held now")
-- Honesty: these two are causally clean; gross before/after revenue is NOT reported
-- here (too confounded by market/season/stock to claim as attribution).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_reprice_margin_impact()
 RETURNS TABLE(actions int, items_with_post_sales int, units_post bigint, gbp_unlocked numeric, first_action timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH a AS (
    SELECT DISTINCT ON (esagu_item_id) esagu_item_id, asin, old_max, acted_at
    FROM amazon.reprice_action WHERE lever='margin'
    ORDER BY esagu_item_id, acted_at            -- earliest raise = ORIGINAL ceiling
  ),
  sales AS (
    SELECT a.esagu_item_id, a.old_max, oi.quantity AS q, oi.item_price AS line_total
    FROM a
    JOIN amazon.order_items oi ON oi.asin = a.asin
    JOIN amazon.orders o ON o.amazon_order_id = oi.amazon_order_id
    WHERE a.asin IS NOT NULL AND o.purchase_date > a.acted_at
      AND COALESCE(o.order_status,'') <> 'Cancelled' AND oi.quantity > 0
  )
  SELECT (SELECT count(*) FROM a)::int,
         count(DISTINCT esagu_item_id)::int,
         COALESCE(sum(q),0)::bigint,
         COALESCE(sum(GREATEST(0, line_total - q*old_max)),0)::numeric(12,2),
         (SELECT min(acted_at) FROM a)
  FROM sales;
$function$;

CREATE OR REPLACE FUNCTION public.get_reprice_guard_impact()
 RETURNS TABLE(actions int, items int, box_held_now int, pct_box numeric, first_action timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  WITH a AS (
    SELECT DISTINCT ON (esagu_item_id) esagu_item_id, acted_at
    FROM amazon.reprice_action WHERE lever='fba_guard'
    ORDER BY esagu_item_id, acted_at DESC       -- latest guard action per item
  )
  SELECT count(*)::int, count(*)::int,
         count(*) FILTER (WHERE e.buy_box_seller='A18KNZ0ID7MNQY')::int,
         round(100.0*count(*) FILTER (WHERE e.buy_box_seller='A18KNZ0ID7MNQY')/NULLIF(count(*),0),1),
         min(a.acted_at)
  FROM a JOIN amazon.esagu_item e ON e.esagu_item_id = a.esagu_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.get_reprice_impact_summary()
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','amazon'
AS $function$
  SELECT jsonb_build_object(
    'margin', (SELECT to_jsonb(m) FROM public.get_reprice_margin_impact() m),
    'guard',  (SELECT to_jsonb(g) FROM public.get_reprice_guard_impact() g)
  );
$function$;

GRANT EXECUTE ON FUNCTION public.get_reprice_margin_impact() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reprice_guard_impact() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_reprice_impact_summary() TO anon, authenticated;
