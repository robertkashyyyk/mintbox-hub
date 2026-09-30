-- FORWARD: recreate order_line_economics with per-line ACTUAL eBay fee (final_value_fee/1.2)
-- where available, recalibrated ex-VAT model as fallback. Recreate the 4 cascade dependents
-- verbatim. Atomic (one migration = one transaction).
drop materialized view if exists public.order_line_economics cascade;

create materialized view public.order_line_economics as
 WITH lines_priced AS (
         SELECT ol.id, ol.mintsoft_order_id, ol.line_index, ol.sku, ol.qty, ol.order_date, ol.channel,
            ol.channel_order_ref, ol.warehouse_id, ol.brand_id, ol.created_at, ol.updated_at, ol.order_status,
            ol.order_status_id, ol.product_name, ol.customer_name, ol.first_seen_at, ol.last_seen_at, ol.times_seen,
            ol.last_status_change_at, ol.was_backordered, ol.last_backordered_at, ol.tracking_number, ol.unit_price,
            ol.line_total, ol.discount, ol.currency, ol.courier_service, ol.order_number,
            COALESCE(ol.unit_price, 0::numeric) AS raw_price, pc.cost_price AS cost_each,
            count(*) OVER (PARTITION BY ol.mintsoft_order_id) AS lines_in_order,
            sum(COALESCE(ol.unit_price, 0::numeric) * ol.qty::numeric) OVER (PARTITION BY ol.mintsoft_order_id) AS order_revenue_total,
            COALESCE(pc.cost_price, 0::numeric) * ol.qty::numeric AS cost_weight,
            sum(COALESCE(pc.cost_price, 0::numeric) * ol.qty::numeric) OVER (PARTITION BY ol.mintsoft_order_id) AS cost_weight_total,
            sum(ol.qty::numeric) OVER (PARTITION BY ol.mintsoft_order_id) AS qty_total
           FROM order_lines ol
             LEFT JOIN products_cache pc ON pc.sku = ol.sku
          WHERE ol.order_date >= '2026-01-01 00:00:00+00'::timestamp with time zone
        ), lines_realloc AS (
         SELECT lp.*,
                CASE
                    WHEN lp.lines_in_order <= 1 THEN lp.raw_price * lp.qty::numeric
                    WHEN lp.cost_weight_total > 0::numeric THEN lp.order_revenue_total * (lp.cost_weight / lp.cost_weight_total)
                    WHEN lp.qty_total > 0::numeric THEN lp.order_revenue_total * (lp.qty::numeric / lp.qty_total)
                    ELSE lp.raw_price * lp.qty::numeric
                END AS line_revenue
           FROM lines_priced lp
        ), lines_with_rev_total AS (
         SELECT lr.*, sum(lr.line_revenue) OVER (PARTITION BY lr.mintsoft_order_id) AS realloc_revenue_total
           FROM lines_realloc lr
        ), courier_resolved AS (
         SELECT lr.*, COALESCE(cr.cost, 0::numeric) AS courier_full_cost, cr.courier
           FROM lines_with_rev_total lr
             LEFT JOIN courier_rates cr ON cr.service = lr.courier_service
        ), courier_allocated AS (
         SELECT cr.*,
                CASE
                    WHEN cr.lines_in_order <= 1 THEN cr.courier_full_cost
                    WHEN cr.realloc_revenue_total > 0::numeric THEN cr.courier_full_cost * (cr.line_revenue / cr.realloc_revenue_total)
                    WHEN cr.qty_total > 0::numeric THEN cr.courier_full_cost * (cr.qty::numeric / cr.qty_total)
                    ELSE cr.courier_full_cost / GREATEST(cr.lines_in_order, 1::bigint)::numeric
                END AS courier_line_cost
           FROM courier_resolved cr
        ), channel_fees AS (
         SELECT c.channel,
            ( SELECT row_to_json(r.*) AS row_to_json
                   FROM ( SELECT channel_fee_rules.vat_rate, channel_fee_rules.fee_pct, channel_fee_rules.fixed_fee, channel_fee_rules.name
                           FROM channel_fee_rules
                          WHERE channel_fee_rules.active = true AND COALESCE(c.channel, ''::text) ~~* channel_fee_rules.channel_pattern
                          ORDER BY channel_fee_rules.priority
                         LIMIT 1) r) AS fee_rule_json
           FROM ( SELECT DISTINCT courier_allocated.channel FROM courier_allocated) c
        ), fee_resolved AS (
         SELECT ca.*, cf.fee_rule_json
           FROM courier_allocated ca
             LEFT JOIN channel_fees cf ON NOT cf.channel IS DISTINCT FROM ca.channel
        ), ebay_fvf AS (
         SELECT order_external_id, sum(final_value_fee) AS fvf
           FROM threeds_order_transactions WHERE final_value_fee > 0::numeric GROUP BY order_external_id
        ), fee_final AS (
         SELECT fr.*,
            ( round(COALESCE((fr.fee_rule_json ->> 'fixed_fee'::text)::numeric, 0::numeric) / GREATEST(fr.lines_in_order, 1::bigint)::numeric
              + fr.line_revenue * (1::numeric + COALESCE((fr.fee_rule_json ->> 'vat_rate'::text)::numeric, 0.20)) * COALESCE((fr.fee_rule_json ->> 'fee_pct'::text)::numeric, 0::numeric), 4) ) AS model_fee,
            ef.fvf AS ebay_order_fvf
           FROM fee_resolved fr
             LEFT JOIN ebay_fvf ef ON ef.order_external_id = regexp_replace(fr.order_number, '-[0-9]+$'::text, ''::text)
        ), fee_applied AS (
         SELECT ff.*,
            CASE WHEN ff.channel ~~* '%ebay%'::text AND ff.ebay_order_fvf IS NOT NULL AND ff.realloc_revenue_total > 0::numeric
                 THEN round(ff.ebay_order_fvf / 1.2 * (ff.line_revenue / ff.realloc_revenue_total), 4)
                 ELSE ff.model_fee END AS chan_fee,
            CASE WHEN ff.channel ~~* '%ebay%'::text AND ff.ebay_order_fvf IS NOT NULL AND ff.realloc_revenue_total > 0::numeric
                 THEN 'eBay actual FVF (ex-VAT)'::text
                 ELSE ff.fee_rule_json ->> 'name'::text END AS fee_rule_name_out
           FROM fee_final ff
        )
 SELECT id, mintsoft_order_id, line_index, sku, product_name, brand_id, qty,
        CASE WHEN qty > 0 THEN round(line_revenue / qty::numeric, 6) ELSE 0::numeric END AS price,
    cost_each, currency, order_date, channel, courier_service, courier, order_status, lines_in_order,
    round(courier_line_cost, 4) AS courier_cost,
    chan_fee AS channel_fee,
    fee_rule_name_out AS fee_rule_name,
    round(line_revenue, 4) AS order_value,
    round(line_revenue - COALESCE(cost_each, 0::numeric) * qty::numeric - courier_line_cost - chan_fee, 4) AS profit,
        CASE WHEN line_revenue > 0::numeric AND qty > 0
             THEN round((line_revenue - COALESCE(cost_each, 0::numeric) * qty::numeric - courier_line_cost - chan_fee) / NULLIF(line_revenue * 1.2, 0::numeric), 6)
             ELSE NULL::numeric END AS por_pct,
        CASE WHEN length(sku) >= 4 AND ("substring"(sku, 4, 1) = ANY (ARRAY['-'::text, '/'::text])) THEN 'Good'::text ELSE 'Dirt'::text END AS good_dirt,
    cost_each IS NULL OR cost_each = 0::numeric AS missing_cost,
    EXTRACT(isoyear FROM order_date)::integer AS iso_year,
    EXTRACT(week FROM order_date)::integer AS iso_week,
    date_trunc('week'::text, order_date)::date AS week_start
   FROM fee_applied;

create unique index ole_mat_id_uidx on public.order_line_economics using btree (id);
create index ole_mat_week_idx on public.order_line_economics using btree (iso_year, iso_week);
create index ole_mat_chan_date_idx on public.order_line_economics using btree (channel, order_date);
create index ole_mat_sku_idx on public.order_line_economics using btree (sku);

-- courier medians (verbatim)
create materialized view public.mv_threeds_courier_median as
 SELECT channel, sku AS base_sku,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY ((courier_cost / NULLIF(qty, 0)::numeric)::double precision)) AS courier_per_unit,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (courier_cost::double precision)) FILTER (WHERE lines_in_order = 1 AND courier_cost > 0::numeric AND COALESCE(courier_service, ''::text) <> 'None Set'::text) AS courier_per_ship
   FROM order_line_economics
  WHERE order_date >= (now() - '365 days'::interval) AND courier_cost IS NOT NULL AND qty > 0 AND COALESCE(courier_service, ''::text) !~~* '%INTL%'::text AND COALESCE(courier_service, ''::text) !~~* '%International%'::text AND COALESCE(courier_service, ''::text) !~~* '%Country Priced%'::text
  GROUP BY channel, sku;
create unique index idx_mv_3ds_courier_median on public.mv_threeds_courier_median using btree (channel, base_sku);

create materialized view public.mv_threeds_courier_channel_median as
 SELECT channel,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY ((courier_cost / NULLIF(qty, 0)::numeric)::double precision)) AS courier_per_unit,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (courier_cost::double precision)) FILTER (WHERE lines_in_order = 1 AND courier_cost > 0::numeric AND COALESCE(courier_service, ''::text) <> 'None Set'::text) AS courier_per_ship
   FROM order_line_economics
  WHERE order_date >= (now() - '365 days'::interval) AND courier_cost IS NOT NULL AND qty > 0 AND COALESCE(courier_service, ''::text) !~~* '%INTL%'::text AND COALESCE(courier_service, ''::text) !~~* '%International%'::text AND COALESCE(courier_service, ''::text) !~~* '%Country Priced%'::text
  GROUP BY channel;
create unique index idx_mv_3ds_courier_channel_median on public.mv_threeds_courier_channel_median using btree (channel);

-- mv_order_economics_all (verbatim)
create materialized view public.mv_order_economics_all as
 WITH cfg AS (
         SELECT COALESCE((app_settings.value ->> 'ebay'::text)::numeric, 2.00) AS ebay,
            COALESCE((app_settings.value ->> 'amazon'::text)::numeric, 2.65) AS amazon,
            COALESCE((app_settings.value ->> 'default'::text)::numeric, 2.50) AS def
           FROM app_settings WHERE app_settings.key = 'courier_fallback'::text
        ), base AS (
         SELECT order_line_economics.id::text AS id, order_line_economics.mintsoft_order_id, order_line_economics.line_index,
            order_line_economics.sku, order_line_economics.product_name, order_line_economics.brand_id, order_line_economics.qty,
            order_line_economics.price, order_line_economics.cost_each, order_line_economics.currency, order_line_economics.order_date,
            order_line_economics.channel, order_line_economics.courier_service, order_line_economics.courier, order_line_economics.order_status,
            order_line_economics.lines_in_order, order_line_economics.courier_cost, order_line_economics.channel_fee, order_line_economics.fee_rule_name,
            order_line_economics.order_value, order_line_economics.profit, order_line_economics.por_pct, order_line_economics.good_dirt,
            order_line_economics.missing_cost, order_line_economics.iso_year, order_line_economics.iso_week, order_line_economics.week_start
           FROM order_line_economics
        UNION ALL
         SELECT mv_fba_order_economics.id, mv_fba_order_economics.mintsoft_order_id, mv_fba_order_economics.line_index,
            mv_fba_order_economics.sku, mv_fba_order_economics.product_name, mv_fba_order_economics.brand_id, mv_fba_order_economics.qty,
            mv_fba_order_economics.price, mv_fba_order_economics.cost_each, mv_fba_order_economics.currency, mv_fba_order_economics.order_date,
            mv_fba_order_economics.channel, mv_fba_order_economics.courier_service, mv_fba_order_economics.courier, mv_fba_order_economics.order_status,
            mv_fba_order_economics.lines_in_order, mv_fba_order_economics.courier_cost, mv_fba_order_economics.channel_fee, mv_fba_order_economics.fee_rule_name,
            mv_fba_order_economics.order_value, mv_fba_order_economics.profit, mv_fba_order_economics.por_pct, mv_fba_order_economics.good_dirt,
            mv_fba_order_economics.missing_cost, mv_fba_order_economics.iso_year, mv_fba_order_economics.iso_week, mv_fba_order_economics.week_start
           FROM mv_fba_order_economics
        ), fb AS (
         SELECT b.*,
                CASE WHEN b.courier_cost = 0::numeric AND b.order_status = 'DESPATCHED'::text AND b.mintsoft_order_id IS NOT NULL THEN round(
                    CASE WHEN lower(COALESCE(b.channel, ''::text)) ~~ '%amazon%'::text THEN c.amazon
                         WHEN lower(COALESCE(b.channel, ''::text)) ~~ '%ebay%'::text THEN c.ebay
                         ELSE c.def END * (b.order_value / NULLIF(sum(b.order_value) OVER (PARTITION BY b.mintsoft_order_id), 0::numeric)), 4)
                    ELSE 0::numeric END AS courier_fb,
            COALESCE(po.postage_exvat, 0::numeric) AS order_postage_exvat
           FROM base b CROSS JOIN cfg c LEFT JOIN mv_order_postage po ON po.mintsoft_order_id = b.mintsoft_order_id
        ), lined AS (
         SELECT fb.*,
            round(fb.order_postage_exvat *
                CASE WHEN sum(fb.order_value) OVER (PARTITION BY fb.mintsoft_order_id) > 0::numeric THEN fb.order_value / sum(fb.order_value) OVER (PARTITION BY fb.mintsoft_order_id)
                     ELSE 1.0 / GREATEST(fb.lines_in_order, 1::bigint)::numeric END, 4) AS line_postage
           FROM fb
        )
 SELECT id, mintsoft_order_id, line_index, sku, product_name, brand_id, qty, price, cost_each, currency, order_date,
    channel, courier_service, courier, order_status, lines_in_order,
    round(courier_cost + courier_fb, 4) AS courier_cost, channel_fee, fee_rule_name, order_value,
    round(profit - courier_fb, 4) AS profit,
        CASE WHEN courier_fb > 0::numeric AND order_value > 0::numeric THEN round((profit - courier_fb) / NULLIF(order_value * 1.2, 0::numeric), 6) ELSE por_pct END AS por_pct,
    good_dirt, missing_cost, iso_year, iso_week, week_start,
    line_postage AS postage_paid,
    round(order_value + line_postage, 4) AS order_value_incl_postage,
    round(profit - courier_fb + line_postage - line_postage * CASE WHEN order_value > 0::numeric THEN channel_fee / order_value ELSE 0::numeric END, 4) AS profit_incl_postage,
        CASE WHEN (order_value + line_postage) > 0::numeric THEN round((profit - courier_fb + line_postage - line_postage *
            CASE WHEN order_value > 0::numeric THEN channel_fee / order_value ELSE 0::numeric END) / NULLIF((order_value + line_postage) * 1.2, 0::numeric), 6)
            ELSE NULL::numeric END AS por_pct_incl_postage
   FROM lined;
create unique index mv_oea_id_uidx on public.mv_order_economics_all using btree (id);
create index mv_oea_week_idx on public.mv_order_economics_all using btree (iso_year, iso_week);
create index mv_oea_sku_idx on public.mv_order_economics_all using btree (sku);
create index mv_oea_chan_date_idx on public.mv_order_economics_all using btree (channel, order_date);

-- order_economics_all (verbatim view)
create view public.order_economics_all as
 SELECT id, mintsoft_order_id, line_index, sku, product_name, brand_id, qty, price, cost_each, currency, order_date,
    channel, courier_service, courier, order_status, lines_in_order, courier_cost, channel_fee, fee_rule_name, order_value,
    profit, por_pct, good_dirt, missing_cost, iso_year, iso_week, week_start, postage_paid, order_value_incl_postage,
    profit_incl_postage, por_pct_incl_postage
   FROM mv_order_economics_all;

grant select on public.order_line_economics to authenticated, service_role, anon;
grant select on public.mv_threeds_courier_median to authenticated, service_role, anon;
grant select on public.mv_threeds_courier_channel_median to authenticated, service_role, anon;
grant select on public.mv_order_economics_all to authenticated, service_role, anon;
grant select, insert, update, delete on public.order_economics_all to authenticated, service_role, anon;
