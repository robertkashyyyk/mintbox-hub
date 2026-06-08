-- Repricer v5: exclude INTERNATIONAL orders — reprice UK listings on UK sales only.
--
-- WHY: the SFTP push sets ONE price on the UK listing, but the economics were
-- mixing international orders in. RM International Tracked ("Country Priced")
-- costs ~£7 vs UK Large Letter ~£1.65, so a low-volume SKU whose only recent sale
-- was international (e.g. NGK-04666, NGK-06500) showed a fake −55% loss and a 3×
-- price hike. International postage income was likewise unrepresentative.
--
-- HOW: the international flag lives only in Mintsoft (order_lines.courier_service
-- = 'RM INTL … Country Priced …'). Mintsoft order_number is the eBay order ref +
-- a '-NNNNNN' suffix; stripping the suffix matches 3DS order_external_id (verified
-- live). So we build the set of international eBay order refs and:
--   (1) exclude those orders from the 3DS economics (postage/fee/revenue/units), and
--   (2) exclude international courier services from the courier estimate, with a
--       UK channel-median fallback for SKUs that have no own UK courier sample.
-- A SKU with ONLY international sales then has no UK rows and drops out — correct,
-- it isn't a UK-listing reprice candidate.
--
-- Signature unchanged -> CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
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
  -- eBay order refs that shipped via an INTERNATIONAL service (Mintsoft is the
  -- only place this is flagged). order_number = '{ebay_ref}-{suffix}'.
  intl_orders AS (
    SELECT DISTINCT regexp_replace(ol.order_number, '-[0-9]+$', '') AS ebay_ref
    FROM public.order_lines ol
    WHERE ol.channel = p_channel
      AND ol.order_number IS NOT NULL
      AND (ol.courier_service ILIKE '%INTL%'
        OR ol.courier_service ILIKE '%International%'
        OR ol.courier_service ILIKE '%Country Priced%')
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
      AND NOT EXISTS (SELECT 1 FROM intl_orders io WHERE io.ebay_ref = t.order_external_id)
  ),
  agg AS (
    SELECT tx.sku,
      regexp_replace(tx.sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      GREATEST(COALESCE(NULLIF(substring(tx.sku from '(?i)-Q([0-9]+)$'), '')::int, 1), 1) AS pack_size,
      (array_agg(tx.external_item_id ORDER BY tx.order_date DESC))[1] AS external_item_id,
      (array_agg(tx.item_name ORDER BY tx.order_date DESC))[1] AS item_name,
      SUM(tx.quantity)::bigint AS units_sold,
      SUM(tx.price) AS item_gross, SUM(tx.shipping) AS postage_gross,
      SUM(tx.final_value_fee) AS fvf, COUNT(*) AS txns,
      MAX(tx.order_date) AS last_order_date,
      (array_agg(tx.unit_price ORDER BY tx.order_date DESC))[1] AS last_unit_gross
    FROM tx GROUP BY 1, 2, 3
  ),
  -- UK-only courier per SKU (exclude international services), median over 365d.
  courier AS (
    SELECT ole.sku AS base_sku,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS courier_per_unit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL AND ole.qty > 0
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%INTL%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%International%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%Country Priced%'
    GROUP BY ole.sku
  ),
  -- UK channel-median courier as a fallback for SKUs with no own UK sample.
  channel_courier AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS c
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL AND ole.qty > 0
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%INTL%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%International%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%Country Priced%'
  ),
  econ AS (
    SELECT a.*,
      COALESCE(c.courier_per_unit, (SELECT c FROM channel_courier)) AS courier_unit,
      (a.item_gross + a.postage_gross) AS gmv_gross,
      CASE WHEN a.units_sold > 0 THEN a.postage_gross / a.units_sold ELSE 0 END AS postage_unit,
      CASE WHEN (a.item_gross + a.postage_gross) > 0
        THEN LEAST(0.25, GREATEST(0.05, (a.fvf - a.txns * 0.36) / (a.item_gross + a.postage_gross)))
        ELSE NULL END AS var_fee_rate
    FROM agg a
    LEFT JOIN courier c ON c.base_sku = a.base_sku
  )
  SELECT e.sku, e.base_sku, e.pack_size,
    COALESCE(pc.name, e.item_name) AS product_name, b.name AS brand_name, e.units_sold,
    ROUND((e.item_gross / 1.2)::numeric, 2) AS revenue,
    ROUND(pcb.cost_price::numeric, 4) AS base_unit_cost,
    ROUND((NULLIF(pcb.cost_price, 0) * e.pack_size)::numeric, 4) AS pack_cost_unit,
    ROUND((NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold)::numeric, 2) AS cost_total,
    ROUND(e.var_fee_rate::numeric, 4) AS real_fee_rate,
    ROUND(e.fvf::numeric, 2) AS fees_total,
    ROUND((e.courier_unit * e.units_sold)::numeric, 2) AS courier_total,
    ROUND(e.postage_unit::numeric, 2) AS postage_unit,
    ROUND((e.gmv_gross / 1.2 - e.fvf - e.courier_unit * e.units_sold
      - (NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold))::numeric, 2) AS profit,
    CASE WHEN e.gmv_gross > 0 THEN ROUND(((e.gmv_gross / 1.2 - e.fvf - e.courier_unit * e.units_sold
      - (NULLIF(pcb.cost_price, 0) * e.pack_size * e.units_sold)) / e.gmv_gross * 100)::numeric, 2)
      ELSE NULL END AS por_pct,
    ROUND((e.last_unit_gross / 1.2)::numeric, 2) AS current_price,
    pc.current_stock
  FROM econ e
  LEFT JOIN public.products_cache pcb ON pcb.sku = e.base_sku
  LEFT JOIN public.products_cache pc  ON pc.sku  = e.sku
  LEFT JOIN public.brands b ON b.id = pc.brand_id
  ORDER BY profit ASC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.get_threeds_reprice_candidates(text, integer) TO authenticated;
