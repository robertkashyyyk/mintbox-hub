-- Recreate views without SECURITY DEFINER (use SECURITY INVOKER instead)
drop view if exists public.latest_items_by_brand;
drop view if exists public.latest_items_per_type;
drop view if exists public.latest_email_per_type;

-- Latest ingested email per type
create or replace view public.latest_email_per_type 
with (security_invoker = true)
as
select distinct on (a.alert_type)
  a.alert_type,
  e.id          as email_id,
  e.received_at as occurred_at
from public.alerts a
join public.emails e on e.id = a.email_id
where a.alert_type in ('LowStock','Inventory')
order by a.alert_type, e.received_at desc;

-- Latest parsed rows per type
create or replace view public.latest_items_per_type
with (security_invoker = true)
as
select p.*
from public.parsed_items p
join public.latest_email_per_type l on l.email_id = p.email_id;

-- Convenience: brand-scoped latest rows
create or replace view public.latest_items_by_brand
with (security_invoker = true)
as
select *
from public.latest_items_per_type
where brand_name is not null;