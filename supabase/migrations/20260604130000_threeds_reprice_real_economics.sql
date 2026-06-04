-- Repricer: feed real per-listing economics into get_threeds_reprice_candidates.
--
-- WHAT CHANGES vs the previous version (20260520091146):
--  1. pack_size      — N from a trailing -Q0N token (else 1). True SKUs only.
--  2. base_unit_cost — products_cache.cost_price of the BASE SKU (strip -Q0N).
--  3. pack_cost_unit — base_unit_cost * pack_size. This is Robert's rule:
--        a -Q0N listing NEVER uses its own cost; cost is always derived from the
--        single (base) unit x the pack multiplier. NULL when the base cost is
--        missing/zero -> the row gets flagged "missing cost" client-side.
--  4. real_fee_rate  — SUM(final_value_fee)/SUM(price) from
--        threeds_order_transactions for that exact SKU over the window. This is
--        the REAL eBay take (~22% on low-ASP items, vs the modeled 12%), with the
--        £0.36 fixed fee + promoted-listing fees already baked in.
--  5. cost_total / fees_total / profit / por_pct are RECOMPUTED from the above so
--        the whole row is internally consistent. Fees use real_fee_rate when we
--        have 3DS data for the SKU, else fall back to the modeled channel fee.
--
-- current_price stays the latest observed NET sold price (what actually sold).
--
-- Return signature changes (new columns), so we must DROP + CREATE — CREATE OR
-- REPLACE FUNCTION cannot change the OUT/return columns.

DROP FUNCTION IF EXISTS public.get_threeds_reprice_candidates(text, integer);

CREATE FUNCTION public.get_threeds_reprice_candidates(p_channel text, p_days integer DEFAULT 90)
 RETURNS TABLE(
   sku text,
   base_sku text,
   pack_size integer,
   product_name text,
   brand_name text,
   units_sold bigint,
   revenue numeric,
   base_unit_cost numeric,
   pack_cost_unit numeric,
   cost_total numeric,
   real_fee_rate numeric,
   fees_total numeric,
   courier_total numeric,
   profit numeric,
   por_pct numeric,
   current_price numeric,
   current_stock numeric
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT
      ole.sku,
      MAX(ole.product_name) AS product_name,
      (array_agg(ole.brand_id ORDER BY ole.order_date DESC))[1] AS brand_id,
      SUM(ole.qty)::bigint  AS units_sold,
      SUM(ole.order_value)  AS revenue,
      SUM(ole.channel_fee)  AS modeled_fees_total,
      SUM(ole.courier_cost) AS courier_total
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - make_interval(days => p_days)
      AND ole.order_date >= '2026-01-01'::timestamptz
    GROUP BY ole.sku
  ),
  latest_price AS (
    SELECT DISTINCT ON (ole.sku)
      ole.sku,
      ole.price
    FROM public.order_line_economics ole
    WHERE ole.channel = p_channel
      AND ole.order_date >= now() - make_interval(days => p_days)
      AND ole.price IS NOT NULL
      AND ole.price > 0
    ORDER BY ole.sku, ole.order_date DESC
  ),
  -- REAL eBay fee take per exact SKU, from the 3DS orders feed.
  fee_agg AS (
    SELECT
      t.sku,
      SUM(t.final_value_fee) AS fvf,
      SUM(t.price)           AS gross
    FROM public.threeds_order_transactions t
    WHERE t.order_date >= now() - make_interval(days => p_days)
      AND t.price > 0
      AND COALESCE(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')
      AND t.sku !~* '-(DEL|PNR)(-|$)'
    GROUP BY t.sku
  ),
  base AS (
    SELECT
      a.*,
      lp.price AS current_price,
      -- pack multiplier: digits of a trailing -Q0N token, else 1 (min 1).
      GREATEST(
        COALESCE(NULLIF(substring(a.sku from '(?i)-Q([0-9]+)$'), '')::int, 1),
        1
      ) AS pack_size,
      regexp_replace(a.sku, '(?i)-Q[0-9]+$', '') AS base_sku,
      CASE WHEN fa.gross > 0 THEN fa.fvf / fa.gross ELSE NULL END AS real_fee_rate
    FROM agg a
    LEFT JOIN latest_price lp ON lp.sku = a.sku
    LEFT JOIN fee_agg fa       ON fa.sku = a.sku
  ),
  costed AS (
    SELECT
      bse.*,
      pcb.cost_price AS base_unit_cost,
      -- pack cost = single (base) unit cost x pack multiplier. NULL if no base
      -- cost (zero treated as missing) -> flagged client-side, never priced.
      (NULLIF(pcb.cost_price, 0) * bse.pack_size) AS pack_cost_unit
    FROM base bse
    LEFT JOIN public.products_cache pcb ON pcb.sku = bse.base_sku
  )
  SELECT
    c.sku,
    c.base_sku,
    c.pack_size,
    COALESCE(pc.name, c.product_name) AS product_name,
    b.name AS brand_name,
    c.units_sold,
    ROUND(c.revenue::numeric, 2)         AS revenue,
    ROUND(c.base_unit_cost::numeric, 4)  AS base_unit_cost,
    ROUND(c.pack_cost_unit::numeric, 4)  AS pack_cost_unit,
    ROUND((c.pack_cost_unit * c.units_sold)::numeric, 2) AS cost_total,
    ROUND(c.real_fee_rate::numeric, 4)   AS real_fee_rate,
    -- fees: real take when we have 3DS data, else the modeled channel fee.
    ROUND(
      CASE
        WHEN c.real_fee_rate IS NOT NULL THEN c.real_fee_rate * (c.revenue * 1.2)
        ELSE c.modeled_fees_total
      END::numeric, 2
    ) AS fees_total,
    ROUND(c.courier_total::numeric, 2)   AS courier_total,
    -- profit recomputed from corrected cost + (real|modeled) fees.
    ROUND((
      c.revenue
      - (c.pack_cost_unit * c.units_sold)
      - c.courier_total
      - CASE
          WHEN c.real_fee_rate IS NOT NULL THEN c.real_fee_rate * (c.revenue * 1.2)
          ELSE c.modeled_fees_total
        END
    )::numeric, 2) AS profit,
    CASE WHEN c.revenue > 0
      THEN ROUND((
        (
          c.revenue
          - (c.pack_cost_unit * c.units_sold)
          - c.courier_total
          - CASE
              WHEN c.real_fee_rate IS NOT NULL THEN c.real_fee_rate * (c.revenue * 1.2)
              ELSE c.modeled_fees_total
            END
        ) / (c.revenue * 1.2) * 100
      )::numeric, 2)
      ELSE NULL END AS por_pct,
    ROUND(c.current_price::numeric, 2) AS current_price,
    pc.current_stock
  FROM costed c
  LEFT JOIN public.products_cache pc ON pc.sku = c.sku
  LEFT JOIN public.brands b ON b.id = COALESCE(pc.brand_id, c.brand_id)
  ORDER BY profit ASC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.get_threeds_reprice_candidates(text, integer) TO authenticated;
