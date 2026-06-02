-- Refine threeds_listings:
--  (1) add pack_size — the Q-code multiplier (Q0N => N, true SKUs only; base = 1)
--      so the repricer can scale cost: pack cost = pack_size * single-unit cost.
--      (Confirmed with Robert: -Q0N rows never carry a valid own cost — always
--       derive from the base/single SKU. The multiplier is the literal Q number,
--       multi-digit allowed, e.g. -Q12 = 12-pack, and always at the END of a
--       TRUE SKU.)
--  (2) exclude junk SKUs flagged for Mintsoft deletion: any '-DEL' / '-PNR'
--      token (these are not real listings and must be ignored).

CREATE OR REPLACE VIEW public.threeds_listings AS
SELECT
  t.base_sku,
  t.sku,
  t.q_code,
  -- pack_size: integer from the trailing -Q<N> token; NULL/absent => single (1)
  coalesce(nullif(substring(t.q_code from '[0-9]+'), '')::int, 1)              AS pack_size,
  t.external_item_id,
  t.marketplace,
  t.channel,
  t.store_name,
  max(t.item_name)                                                              AS item_name,
  max(t.item_url)                                                               AS item_url,
  max(t.currency)                                                              AS currency,
  -- latest gross PACK price (the listing's selling unit) from the most recent
  -- non-cancelled sale. Per-individual-item price = last_unit_price / pack_size.
  (array_agg(t.unit_price ORDER BY t.order_date DESC)
     FILTER (WHERE coalesce(lower(t.cancel_status), '') NOT IN ('cancelled', 'canceled')))[1]
                                                                                AS last_unit_price,
  max(t.order_date)                                                             AS last_order_date,
  count(*) FILTER (WHERE t.order_date >= now() - interval '90 days')            AS orders_90d,
  coalesce(sum(t.quantity)        FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS units_90d,
  coalesce(sum(t.price)           FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS revenue_90d,
  coalesce(sum(t.final_value_fee) FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) AS fvf_90d,
  CASE
    WHEN coalesce(sum(t.price) FILTER (WHERE t.order_date >= now() - interval '90 days'), 0) > 0
    THEN sum(t.final_value_fee) FILTER (WHERE t.order_date >= now() - interval '90 days')
       / sum(t.price)           FILTER (WHERE t.order_date >= now() - interval '90 days')
    ELSE NULL
  END                                                                           AS real_fee_rate
FROM public.threeds_order_transactions t
WHERE t.external_item_id IS NOT NULL
  -- drop Mintsoft-deletion junk SKUs (-DEL / -PNR tokens)
  AND t.sku !~* '-(DEL|PNR)(-|$)'
GROUP BY
  t.base_sku, t.sku, t.q_code,
  coalesce(nullif(substring(t.q_code from '[0-9]+'), '')::int, 1),
  t.external_item_id, t.marketplace, t.channel, t.store_name;

COMMENT ON VIEW public.threeds_listings IS
  'Per-listing rollup of threeds_order_transactions: eBay item number, marketplace, pack_size (Q-code multiplier), latest gross PACK price, 90d units, REAL fee rate. Grouped by base_sku so Q-variants roll up to their parent. Excludes -DEL/-PNR junk SKUs.';

GRANT SELECT ON public.threeds_listings TO authenticated;
