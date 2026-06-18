-- Dirt-SKU resolver (Layer A).
--
-- eBay listings sometimes still carry an OLD "dirt" SKU (e.g. DV_29045) that
-- Mintsoft maps to the true SKU (DEV-29045) via its Alternative Code feature on
-- arrival — good for stock/picking, but the 3DS/eBay feed still shows the dirt
-- code. The repricer is driven by 3DS, so it looks up cost for the dirt SKU,
-- finds none, and the item never enters repricing (while the Profit page, driven
-- by Mintsoft, shows it as a loss). This builds a dirt->true alias map and uses
-- it for COST resolution only — the listing SKU is preserved for the SFTP push
-- so 3D still matches the eBay listing.
--
-- True SKU convention: 4th char is '-' or '/' (3-letter brand prefix + separator).
-- The map is derived by matching single-line 3DS orders to single-line Mintsoft
-- orders on the eBay order id (Mintsoft order_number minus its trailing -NNNN).

CREATE TABLE IF NOT EXISTS public.threeds_sku_aliases (
  dirt_sku     text PRIMARY KEY,
  true_sku     text NOT NULL,
  order_count  integer NOT NULL DEFAULT 0,
  needs_review boolean NOT NULL DEFAULT false,   -- the same dirt SKU mapped to >1 true SKU
  source       text NOT NULL DEFAULT 'order_match',
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Rebuild the alias map from matched single-line orders in the last p_days.
CREATE OR REPLACE FUNCTION public.refresh_threeds_sku_aliases(p_days integer DEFAULT 180)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_rows integer;
BEGIN
  WITH ms AS (  -- single-line Mintsoft eBay orders -> true SKU
    SELECT regexp_replace(order_number, '-[0-9]+$', '') AS ebay_order, min(sku) AS true_sku
    FROM public.order_lines
    WHERE channel LIKE 'eBay%' AND order_number IS NOT NULL
      AND order_date >= now() - make_interval(days => p_days)
    GROUP BY 1 HAVING count(*) = 1
  ),
  tds AS (  -- single-line 3DS orders -> listing SKU
    SELECT order_external_id AS ebay_order, min(sku) AS dirt_sku
    FROM public.threeds_order_transactions
    WHERE order_external_id IS NOT NULL
      AND order_date >= now() - make_interval(days => p_days)
    GROUP BY 1 HAVING count(*) = 1
  ),
  pairs AS (
    SELECT t.dirt_sku, m.true_sku, count(*) AS n
    FROM tds t JOIN ms m USING (ebay_order)
    WHERE t.dirt_sku <> m.true_sku
      AND t.dirt_sku NOT LIKE '%+%'                 -- skip multi-product bundle listings
      AND substr(t.dirt_sku, 4, 1) NOT IN ('-', '/') -- dirt: 4th char not a separator
      AND substr(m.true_sku, 4, 1) IN ('-', '/')     -- true: 4th char is a separator
    GROUP BY 1, 2
  ),
  ranked AS (
    SELECT dirt_sku, true_sku, n,
      row_number() OVER (PARTITION BY dirt_sku ORDER BY n DESC, true_sku) AS rk,
      count(*)     OVER (PARTITION BY dirt_sku) AS variants
    FROM pairs
  )
  INSERT INTO public.threeds_sku_aliases (dirt_sku, true_sku, order_count, needs_review, source, updated_at)
  SELECT dirt_sku, true_sku, n, variants > 1, 'order_match', now()
  FROM ranked WHERE rk = 1
  ON CONFLICT (dirt_sku) DO UPDATE
    SET true_sku = EXCLUDED.true_sku, order_count = EXCLUDED.order_count,
        needs_review = EXCLUDED.needs_review, source = 'order_match', updated_at = now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$function$;

-- Populate now.
SELECT public.refresh_threeds_sku_aliases(180);

-- Keep it fresh daily (06:45 UTC). Safe to re-run; unschedule first if it exists.
DO $$
BEGIN
  PERFORM cron.unschedule('refresh-threeds-sku-aliases');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('refresh-threeds-sku-aliases', '45 6 * * *',
  $$SELECT public.refresh_threeds_sku_aliases(180);$$);

-- ── Repricer: resolve dirt->true for COST only (listing SKU kept for the push) ──
CREATE OR REPLACE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
 RETURNS TABLE(sku text, base_sku text, pack_size integer, product_name text, brand_name text, units_sold bigint, revenue numeric, base_unit_cost numeric, pack_cost_unit numeric, cost_total numeric, real_fee_rate numeric, fees_total numeric, courier_total numeric, postage_unit numeric, profit numeric, por_pct numeric, current_price numeric, current_stock numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
  WITH store_sel AS (
    SELECT ebay_store_slug AS slug FROM public.threeds_stores
    WHERE mintsoft_channel = p_channel AND ebay_store_slug IS NOT NULL LIMIT 1
  ),
  intl_orders AS (
    SELECT DISTINCT regexp_replace(ol.order_number, '-[0-9]+$', '') AS ebay_ref
    FROM public.order_lines ol
    WHERE ol.channel = p_channel AND ol.order_number IS NOT NULL
      AND (ol.courier_service ILIKE '%INTL%'
        OR ol.courier_service ILIKE '%International%'
        OR ol.courier_service ILIKE '%Country Priced%')
  ),
  tx AS (
    SELECT t.sku, al.true_sku, t.external_item_id, t.item_name, t.quantity, t.price,
           t.unit_price, t.final_value_fee, t.order_date,
           COALESCE((t.raw->>'shippingPrice')::numeric, 0) AS shipping
    FROM public.threeds_order_transactions t CROSS JOIN store_sel s
    LEFT JOIN public.threeds_sku_aliases al ON al.dirt_sku = t.sku
    WHERE t.store_url ILIKE '%' || s.slug || '%'
      AND t.order_date >= now() - make_interval(days => p_days)
      AND t.price > 0
      AND COALESCE(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')
      AND t.sku !~* '-(DEL|PNR)(-|$)'
      AND NOT EXISTS (SELECT 1 FROM intl_orders io WHERE io.ebay_ref = t.order_external_id)
  ),
  agg AS (
    SELECT tx.sku,
      -- COST base resolves the dirt SKU to its true SKU; the listing SKU (tx.sku) is untouched.
      regexp_replace(COALESCE(tx.true_sku, tx.sku), '(?i)-Q[0-9]+$', '') AS base_sku,
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
  courier AS (
    SELECT ole.sku AS base_sku,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS courier_per_unit
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel AND ole.order_date >= now() - interval '365 days'
      AND ole.courier_cost IS NOT NULL AND ole.qty > 0
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%INTL%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%International%'
      AND COALESCE(ole.courier_service, '') NOT ILIKE '%Country Priced%'
    GROUP BY ole.sku
  ),
  channel_courier AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY ole.courier_cost / NULLIF(ole.qty, 0)) AS c
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel AND ole.order_date >= now() - interval '365 days'
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
    COALESCE(pc.name, pcb.name, e.item_name) AS product_name, COALESCE(b.name, bb.name) AS brand_name, e.units_sold,
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
    COALESCE(pc.current_stock, pcb.current_stock) AS current_stock
  FROM econ e
  LEFT JOIN public.products_cache pcb ON pcb.sku = e.base_sku
  LEFT JOIN public.products_cache pc  ON pc.sku  = e.sku
  LEFT JOIN public.brands b  ON b.id  = pc.brand_id
  LEFT JOIN public.brands bb ON bb.id = pcb.brand_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.price_campaigns pcm
    WHERE pcm.status = 'active' AND (pcm.sku = e.base_sku OR pcm.sku = e.sku)
  )
  ORDER BY profit ASC NULLS LAST;
$function$;
