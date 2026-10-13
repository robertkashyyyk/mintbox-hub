-- SHADOW ONLY (2026-10-13): actual Amazon FBM fees per order_line_economics line, model as
-- fallback. Nothing reads this yet; order_line_economics is unchanged until Robert approves.
-- Actual = (Commission + DigitalServicesFee) / 1.2 from amazon.financial_events (Shipment),
-- matched on order_lines.order_number = amazon_order_id, split across lines by net share.
create materialized view if not exists public.mv_amazon_fbm_fee_shadow as
with ole as (
  select e.id, e.mintsoft_order_id, e.line_index, e.sku, e.channel, e.order_date, e.order_status,
         e.order_value, e.channel_fee as model_fee, e.profit as model_profit, e.cost_each, e.qty, e.courier_cost,
         e.missing_cost,
         sum(e.order_value) over (partition by e.mintsoft_order_id) as order_net,
         count(*) over (partition by e.mintsoft_order_id) as order_lines
  from public.order_line_economics e
  where e.channel in ('Amazon','Amazon - IE')
), ref as (
  select mintsoft_order_id, min(order_number) as amazon_order_id
  from public.order_lines where order_number ~ '^\d{3}-\d{7}-\d{7}$' group by 1
), fe as (
  select amazon_order_id,
         sum(amount) filter (where event_subtype = 'Commission') as commission,
         sum(amount) filter (where event_subtype in ('DigitalServicesFee','DigitalServicesFeeFBA')) as dsf,
         count(*) filter (where event_subtype = 'FBAPerUnitFulfillmentFee') as fba_rows,
         min(posted_date) as posted_date
  from amazon.financial_events where event_type = 'Shipment' group by 1
)
select o.id, o.mintsoft_order_id, o.line_index, o.sku, o.channel, o.order_date, o.order_status,
       r.amazon_order_id, f.posted_date,
       o.order_value, o.model_fee,
       case when f.commission is not null and f.fba_rows = 0
            then round(((f.commission + coalesce(f.dsf,0)) / 1.2)
                       * case when o.order_net > 0 then o.order_value / o.order_net else 1.0 / o.order_lines end, 4)
       end as actual_fee,
       case when f.commission is not null and f.fba_rows = 0 then 'actual' else 'model' end as fee_source,
       o.model_profit,
       round(o.model_profit + o.model_fee - coalesce(
         case when f.commission is not null and f.fba_rows = 0
              then ((f.commission + coalesce(f.dsf,0)) / 1.2)
                   * case when o.order_net > 0 then o.order_value / o.order_net else 1.0 / o.order_lines end end,
         o.model_fee), 4) as shadow_profit,
       o.missing_cost
from ole o
left join ref r on r.mintsoft_order_id = o.mintsoft_order_id
left join fe f on f.amazon_order_id = r.amazon_order_id;

create unique index if not exists mv_amazon_fbm_fee_shadow_id on public.mv_amazon_fbm_fee_shadow (id);
create index if not exists mv_amazon_fbm_fee_shadow_date on public.mv_amazon_fbm_fee_shadow (order_date);
revoke all on public.mv_amazon_fbm_fee_shadow from public, anon, authenticated;
grant select on public.mv_amazon_fbm_fee_shadow to service_role;
comment on materialized view public.mv_amazon_fbm_fee_shadow is
  'SHADOW (not wired in): Amazon FBM fee per OLE line from SP-API settlement (Commission + DSF, /1.2, split by line net share), model fee as fallback when unsettled. Refreshed daily by cron. Switch-over needs Robert''s approval.';

-- Applied in prod via cron.schedule (job 138):
-- select cron.schedule('refresh-amazon-fbm-fee-shadow', '0 4 * * *',
--   $$SET statement_timeout='600000'; REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_amazon_fbm_fee_shadow;$$);
