-- Repricer v3: source candidates from the REAL eBay data (3DS orders), not the
-- Mintsoft order_line_economics view.
--
-- WHY: order_line_economics collapses every eBay listing + pack variant into the
-- single base SKU and reports a reallocated/blended price (e.g. HOL-RW2R showed
-- "£11.08" = a £9.23 reallocated NET line × 1.2 VAT — matching NO real listing,
-- and the -Q02 2-pack vanished entirely, exploded into base-SKU units). The 3DS
-- orders feed keeps the true listing identity, real per-listing price, real eBay
-- fee, and the pack (-Q0N) SKU. So we drive the candidate list from 3DS and use
-- Mintsoft only for courier cost (which 3DS doesn't carry).
--
-- STORE MAPPING: 3DS rows identify the trading store by eBay store URL slug, not
-- by the Mintsoft channel name. We add threeds_stores.ebay_store_slug and join on
-- store_url ILIKE '%slug%'.
--   NOTE: 'no1autoshop' -> Universal is inferred by elimination; CONFIRM and edit
--   that row if wrong (it's just data in threeds_stores).
--
-- CONVENTIONS: 3DS price/unit_price are GROSS (inc VAT) but ITEM-ONLY (exclude
-- postage); final_value_fee is the real eBay take. We return revenue/current_price
-- as NET to match the existing frontend (which grosses current_price for display),
-- and compute profit/POR internally in gross terms. Known approximation: postage
-- income isn't in revenue while the fee on postage IS in fvf, so margins are a
-- touch conservative — fine for ranking/repricing, refine later if needed.

ALTER TABLE public.threeds_stores ADD COLUMN IF NOT EXISTS ebay_store_slug text;

UPDATE public.threeds_stores SET ebay_store_slug = '123autocare'     WHERE mintsoft_channel = 'eBay - 123 Autocare';
UPDATE public.threeds_stores SET ebay_store_slug = 'ascgroupltd'     WHERE mintsoft_channel = 'eBay - ASC';
UPDATE public.threeds_stores SET ebay_store_slug = 'carpartsintl'    WHERE mintsoft_channel = 'eBay - CPI';
UPDATE public.threeds_stores SET ebay_store_slug = 'theautostopshop' WHERE mintsoft_channel = 'eBay - The Stop Shop';
UPDATE public.threeds_stores SET ebay_store_slug = 'no1autoshop'     WHERE mintsoft_channel = 'eBay - Universal';

DROP FUNCTION IF EXISTS public.get_threeds_reprice_candidates(text, integer);

CREATE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
 RETURNS TABLE(
   sku text, base_sku text, pack_size integer, product_name text, brand_name text,
   units_sold bigint, revenue numeric, base_unit_cost numeric, pack_cost_unit numeric,
   cost_total numeric, real_fee_rate numeric, fees_total numeric, courier_total numeric,
   profit numeric, por_pct numeric, current_price numeric, current_stock numeric
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH store_sel AS (
    SELECT ebay_store_slug AS slug
    FROM public.threeds_stores
    WHERE mintsoft_channel = p_channel
      AND ebay_store_slug IS NOT NULL
    LIMIT 1
  ),
  -- Real eBay transactions for THIS store, in the window, non-cancelled, no junk.
  tx AS (
    SELECT t.sku, t.external_item_id, t.item_name, t.quantity, t.price,
           t.unit_price, t.final_value_fee, t.order_date
    FROM public.threeds_order_transactions t
    CROSS JOIN store_sel s
    WHERE t.store_url ILIKE '%' || s.slug || '%'
      AND t.order_date >= now() - make_interval(days => p_days)
      AND t.price > 0
      AND COALESCE(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')
      AND t.sku !~* '-(DEL|PNR)(-|$)'
  ),
  -- One row per exact SKU (= one listing / pack variant within this store).
  agg AS (
    SELECT
      tx.sku,
      regexp_replace(tx.sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      GREATEST(COALESCE(NULLIF(substring(tx.sku from '(?i)-Q([0-9]+)$'), '')::int, 1), 1) AS pack_size,
      (array_agg(tx.external_item_id ORDER BY tx.order_date DESC))[1] AS external_item_id,
      (array_agg(tx.item_name        ORDER BY tx.order_date DESC))[1] AS item_name,
      SUM(tx.quantity)::bigint   AS units_sold,
      SUM(tx.price)              AS gross_revenue,  -- inc VAT, item-only
      SUM(tx.final_value_fee)    AS fvf,
      MAX(tx.order_date)         AS last_order_date,
      (array_agg(tx.unit_price ORDER BY tx.order_date DESC))[1] AS last_unit_gross
    FROM tx
    GROUP BY 1, 2, 3
  ),
  -- Mintsoft courier cost per unit, by base SKU, for this channel (3DS has none).
  courier AS (
    SELECT
      ole.sku AS base_sku,
      CASE WHEN SUM(ole.qty) > 0 THEN SUM(ole.courier_cost) / SUM(ole.qty) ELSE 0 END AS courier_per_unit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - make_interval(days => p_days)
    GROUP BY ole.sku
  )
  SELECT
    a.sku,
    a.base_sku,
    a.pack_size,
    COALESCE(pc.name, a.item_name) AS product_name,
    b.name AS brand_name,
    a.units_sold,
    ROUND((a.gross_revenue / 1.2)::numeric, 2)                       AS revenue,        -- NET
    ROUND(pcb.cost_price::numeric, 4)                               AS base_unit_cost,
    ROUND((NULLIF(pcb.cost_price, 0) * a.pack_size)::numeric, 4)     AS pack_cost_unit,
    ROUND((NULLIF(pcb.cost_price, 0) * a.pack_size * a.units_sold)::numeric, 2) AS cost_total,
    ROUND(CASE WHEN a.gross_revenue > 0 THEN a.fvf / a.gross_revenue ELSE NULL END::numeric, 4) AS real_fee_rate,
    ROUND(a.fvf::numeric, 2)                                         AS fees_total,
    ROUND((COALESCE(c.courier_per_unit, 0) * a.units_sold)::numeric, 2) AS courier_total,
    ROUND((
      a.gross_revenue
      - (NULLIF(pcb.cost_price, 0) * a.pack_size * a.units_sold)
      - COALESCE(c.courier_per_unit, 0) * a.units_sold
      - a.fvf
    )::numeric, 2) AS profit,
    CASE WHEN a.gross_revenue > 0 THEN ROUND((
      (
        a.gross_revenue
        - (NULLIF(pcb.cost_price, 0) * a.pack_size * a.units_sold)
        - COALESCE(c.courier_per_unit, 0) * a.units_sold
        - a.fvf
      ) / a.gross_revenue * 100
    )::numeric, 2) ELSE NULL END AS por_pct,
    ROUND((a.last_unit_gross / 1.2)::numeric, 2)                     AS current_price,  -- NET (app grosses it)
    pc.current_stock
  FROM agg a
  LEFT JOIN public.products_cache pcb ON pcb.sku = a.base_sku
  LEFT JOIN public.products_cache pc  ON pc.sku  = a.sku
  LEFT JOIN courier c                 ON c.base_sku = a.base_sku
  LEFT JOIN public.brands b           ON b.id = pc.brand_id
  ORDER BY profit ASC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.get_threeds_reprice_candidates(text, integer) TO authenticated;
