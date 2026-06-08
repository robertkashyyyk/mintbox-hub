-- Repricer fix: make the courier-cost input ROBUST.
--
-- BUG: the courier CTE averaged order_line_economics.courier_cost / qty over the
-- p_days window. courier_cost is intermittently a £7 outlier for the SAME item +
-- same "Royal Mail" service that normally costs ~£1.65 (a pricier RM service maps
-- to the same display name). For a low-volume SKU whose only sale in the window
-- hit a £7 line, courier/unit = £7, and the back-solve turned that into absurd
-- prices (NGK-05123: £4.27 -> £20.81).
--
-- FIX: use the MEDIAN per-unit courier (percentile_cont 0.5), computed over a wide
-- 365-day window (courier rates are stable, so a wider window is more robust and
-- gives low-volume SKUs enough samples to shrug off the odd outlier). Everything
-- else in the function is unchanged. Signature is unchanged -> CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
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
    WHERE mintsoft_channel = p_channel AND ebay_store_slug IS NOT NULL
    LIMIT 1
  ),
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
  agg AS (
    SELECT
      tx.sku,
      regexp_replace(tx.sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      GREATEST(COALESCE(NULLIF(substring(tx.sku from '(?i)-Q([0-9]+)$'), '')::int, 1), 1) AS pack_size,
      (array_agg(tx.external_item_id ORDER BY tx.order_date DESC))[1] AS external_item_id,
      (array_agg(tx.item_name        ORDER BY tx.order_date DESC))[1] AS item_name,
      SUM(tx.quantity)::bigint AS units_sold,
      SUM(tx.price)            AS gross_revenue,
      SUM(tx.final_value_fee)  AS fvf,
      MAX(tx.order_date)       AS last_order_date,
      (array_agg(tx.unit_price ORDER BY tx.order_date DESC))[1] AS last_unit_gross
    FROM tx GROUP BY 1, 2, 3
  ),
  -- ROBUST courier: median per-unit cost over 365d (stable rates, outlier-proof).
  courier AS (
    SELECT
      ole.sku AS base_sku,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS courier_per_unit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL
      AND ole.qty > 0
    GROUP BY ole.sku
  )
  SELECT
    a.sku, a.base_sku, a.pack_size,
    COALESCE(pc.name, a.item_name) AS product_name, b.name AS brand_name,
    a.units_sold,
    ROUND((a.gross_revenue / 1.2)::numeric, 2) AS revenue,
    ROUND(pcb.cost_price::numeric, 4) AS base_unit_cost,
    ROUND((NULLIF(pcb.cost_price, 0) * a.pack_size)::numeric, 4) AS pack_cost_unit,
    ROUND((NULLIF(pcb.cost_price, 0) * a.pack_size * a.units_sold)::numeric, 2) AS cost_total,
    ROUND(CASE WHEN a.gross_revenue > 0 THEN a.fvf / a.gross_revenue ELSE NULL END::numeric, 4) AS real_fee_rate,
    ROUND(a.fvf::numeric, 2) AS fees_total,
    ROUND((COALESCE(c.courier_per_unit, 0) * a.units_sold)::numeric, 2) AS courier_total,
    ROUND((a.gross_revenue - (NULLIF(pcb.cost_price, 0) * a.pack_size * a.units_sold)
      - COALESCE(c.courier_per_unit, 0) * a.units_sold - a.fvf)::numeric, 2) AS profit,
    CASE WHEN a.gross_revenue > 0 THEN ROUND(((a.gross_revenue
      - (NULLIF(pcb.cost_price, 0) * a.pack_size * a.units_sold)
      - COALESCE(c.courier_per_unit, 0) * a.units_sold - a.fvf) / a.gross_revenue * 100)::numeric, 2)
      ELSE NULL END AS por_pct,
    ROUND((a.last_unit_gross / 1.2)::numeric, 2) AS current_price,
    pc.current_stock
  FROM agg a
  LEFT JOIN public.products_cache pcb ON pcb.sku = a.base_sku
  LEFT JOIN public.products_cache pc  ON pc.sku  = a.sku
  LEFT JOIN courier c ON c.base_sku = a.base_sku
  LEFT JOIN public.brands b ON b.id = pc.brand_id
  ORDER BY profit ASC NULLS LAST;
$function$;
