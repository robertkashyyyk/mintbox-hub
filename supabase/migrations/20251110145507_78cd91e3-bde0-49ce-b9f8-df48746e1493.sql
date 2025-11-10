-- Brand prefixes table
create table if not exists public.brand_prefixes (
  id          uuid primary key default gen_random_uuid(),
  brand_name  text not null,
  prefix      text not null,
  created_at  timestamptz default now(),
  unique (brand_name, prefix)
);

-- Enable RLS on brand_prefixes
alter table public.brand_prefixes enable row level security;

-- Everyone can read brand prefixes
create policy "Anyone can view brand prefixes"
on public.brand_prefixes
for select
using (true);

-- Parsed line items from report attachments
create table if not exists public.parsed_items (
  id           uuid primary key default gen_random_uuid(),
  email_id     uuid not null references public.emails(id) on delete cascade,
  report_type  text not null check (report_type in ('LowStock','Inventory')),
  occurred_at  timestamptz not null,
  sku          text not null,
  sku_core     text generated always as (
                 regexp_replace(sku, '^[^-]+-', '', 1, 1)
               ) stored,
  qty          numeric,
  warehouse    text,
  brand_name   text,
  raw          jsonb,
  created_at   timestamptz default now()
);

-- Enable RLS on parsed_items
alter table public.parsed_items enable row level security;

-- Authenticated users can view parsed items
create policy "Authenticated users can view parsed items"
on public.parsed_items
for select
using (true);

-- Indexes
create index if not exists idx_parsed_items_type_time on public.parsed_items (report_type, occurred_at desc);
create index if not exists idx_parsed_items_brand on public.parsed_items (brand_name);
create index if not exists idx_parsed_items_sku on public.parsed_items (sku);

-- Latest ingested email per type
create or replace view public.latest_email_per_type as
select distinct on (a.alert_type)
  a.alert_type,
  e.id          as email_id,
  e.received_at as occurred_at
from public.alerts a
join public.emails e on e.id = a.email_id
where a.alert_type in ('LowStock','Inventory')
order by a.alert_type, e.received_at desc;

-- Latest parsed rows per type
create or replace view public.latest_items_per_type as
select p.*
from public.parsed_items p
join public.latest_email_per_type l on l.email_id = p.email_id;

-- Convenience: brand-scoped latest rows
create or replace view public.latest_items_by_brand as
select *
from public.latest_items_per_type
where brand_name is not null;

-- Seed brand prefixes
insert into public.brand_prefixes (brand_name, prefix) values
  ('NGK','NGK-'),
  ('Sealey','SEA-'),
  ('Klokkerholm','KKH-'),
  ('Liqui Moly','LIQ-')
on conflict do nothing;