-- Repricer v4: postage-aware economics + correctly-decomposed eBay fee.
--
-- TWO BUGS this fixes (found by Robert hand-checking NGK-05123):
--  (1) FEE was modeled as real_fee_rate = fvf / item_price. That (a) folds the
--      fixed £0.36 fee into a % that then wrongly GROWS with price, and (b)
--      divides by item-only price when the fee is actually charged on
--      item + postage. Result: a ~13% real referral looked like ~29%, massively
--      over-inflating suggested prices.
--      FIX: decompose. variable_rate = (Σfvf − Ntxns·F) / Σ(item + postage),
--      with F = £0.36 fixed. The back-solve then applies variable_rate to the
--      price and adds F once (fixed), so the fixed fee no longer scales.
--  (2) POSTAGE INCOME was ignored entirely. The buyer-paid postage (raw
--      ->>'shippingPrice') offsets courier cost. Ignoring it made profitable
--      items look loss-making and inflated target prices.
--      FIX: pull postage from raw, add it to GMV, recompute profit/POR on the
--      full item+postage value, and return postage_unit so the back-solve can
--      subtract it (changing the item price doesn't change postage income).
--
-- real_fee_rate now means the VARIABLE rate (~12-16%), NOT the old blended figure.
-- New column: postage_unit (avg buyer-paid postage per item).
-- Return signature changes -> DROP + CREATE.

DROP FUNCTION IF EXISTS public.get_threeds_reprice_candidates(text, integer);

CREATE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
 RETURNS TABLE(
   sku text, base_sku text, pack_size integer, product_name text, brand_name text,
   units_sold bigint, revenue numeric, base_unit_cost numeric, pack_cost_unit numeric,
   cost_total numeric, real_fee_rate numeric, fees_total numeric, courier_total numeric,
   postage_unit numeric, profit numeric, por_pct numeric, current_price numeric, current_stock numeric
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH store_sel AS (
    SELECT ebay_store_slug AS slug FROM public.threeds_stores
    WHERE mintsoft_channel = p_channel AND ebay_store_slug IS NOT NULL LIMIT 1
  ),
  tx AS (
    SELECT t.sku, t.external_item_id, t.item_name, t.quantity, t.price,
           t.unit_price, t.final_value_fee, t.order_date,
           COALESCE((t.raw->>'shippingPrice')::numeric, 0) AS shipping
    FROM public.threeds_order_transactions t CROSS JOIN store_sel s
    WHERE t.store_url ILIKE '%' || s.slug || '%'
      AND t.order_date >= now() - make_interval(days => p_days)
      AND t.price > 0
      AND COALESCE(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')
      AND t.sku !~* '-(DEL|PNR)(-|$)'
  ),
  agg AS (
    SELECT tx.sku,
      regexp_replace(tx.sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      GREATEST(COALESCE(NULLIF(substring(tx.sku from '(?i)-Q([0-9]+)$'), '')::int, 1), 1) AS pack_size,
      (array_agg(tx.external_item_id ORDER BY tx.order_date DESC))[1] AS external_item_id,
      (array_agg(tx.item_name ORDER BY tx.order_date DESC))[1] AS item_name,
      SUM(tx.quantity)::bigint AS units_sold,
      SUM(tx.price)            AS item_gross,     -- item revenue, inc VAT
      SUM(tx.shipping)         AS postage_gross,  -- buyer-paid postage, inc VAT
      SUM(tx.final_value_fee)  AS fvf,
      COUNT(*)                 AS txns,
      MAX(tx.order_date)       AS last_order_date,
      (array_agg(tx.unit_price ORDER BY tx.order_date DESC))[1] AS last_unit_gross
    FROM tx GROUP BY 1, 2, 3
  ),
  courier AS (
    SELECT ole.sku AS base_sku,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS courier_per_unit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL AND ole.qty > 0
    GROUP BY ole.sku
  ),
  econ AS (
    SELECT a.*,
      (a.item_gross + a.postage_gross)                            AS gmv_gross,
      CASE WHEN a.units_sold > 0 THEN a.postage_gross / a.units_sold ELSE 0 END AS postage_unit,
      -- variable eBay rate: strip the fixed £0.36/txn, divide by full GMV.
      CASE WHEN (a.item_gross + a.postage_gross) > 0
        THEN LEAST(0.25, GREATEST(0.05, (a.fvf - a.txns * 0.36) / (a.item_gross + a.postage_gross)))
        ELSE NULL END                                             AS var_fee_rate
    FROM agg a
  )
  SELECT
    e.sku, e.base_sku, e.pack_size,
    COALESCE(pc.name, e.item_name) AS product_name, b.name AS brand_name, e.units_sold,
    ROUND((e.item_gross / 1.2)::numeric, 2) AS revenue,
    ROUND(pcb.cost_price::numeric, 4) AS base_unit_cost,
    ROUND((NULLIF(pcb.cost_price, 0) * e.pack_size)::numeric, 4) AS pack_cost_unit,
    ROUND((NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold)::numeric, 2) AS cost_total,
    ROUND(e.var_fee_rate::numeric, 4) AS real_fee_rate,
    ROUND(e.fvf::numeric, 2) AS fees_total,
    ROUND((COALESCE(c.courier_per_unit, 0) * e.units_sold)::numeric, 2) AS courier_total,
    ROUND(e.postage_unit::numeric, 2) AS postage_unit,
    -- profit on FULL GMV (item+postage): net − real fvf − courier − cost.
    ROUND((e.gmv_gross / 1.2
      - e.fvf
      - COALESCE(c.courier_per_unit, 0) * e.units_sold
      - (NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold))::numeric, 2) AS profit,
    CASE WHEN e.gmv_gross > 0 THEN ROUND(((e.gmv_gross / 1.2
      - e.fvf
      - COALESCE(c.courier_per_unit, 0) * e.units_sold
      - (NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold)) / e.gmv_gross * 100)::numeric, 2)
      ELSE NULL END AS por_pct,
    ROUND((e.last_unit_gross / 1.2)::numeric, 2) AS current_price,
    pc.current_stock
  FROM econ e
  LEFT JOIN public.products_cache pcb ON pcb.sku = e.base_sku
  LEFT JOIN public.products_cache pc  ON pc.sku  = e.sku
  LEFT JOIN courier c ON c.base_sku = e.base_sku
  LEFT JOIN public.brands b ON b.id = pc.brand_id
  ORDER BY profit ASC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.get_threeds_reprice_candidates(text, integer) TO authenticated;
