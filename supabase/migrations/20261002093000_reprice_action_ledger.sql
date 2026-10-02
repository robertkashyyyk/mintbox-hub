-- Audit log for manual/batch reprice actions (Sealey revert, toys revert, etc.). Applied live via MCP.
create table if not exists public.reprice_action_ledger (
  id          uuid primary key default gen_random_uuid(),
  sku         text not null,
  channel     text not null,          -- 'ebay:<store>' | 'amazon'
  old_price   numeric,
  new_price   numeric,
  action      text not null,          -- 'revert_original' | 'revert_markdown_10' | 'campaign_close' | 'campaign_open'
  reason      text not null,          -- e.g. 'sealey_revert' | 'toys_revert'
  campaign_id uuid,
  batch_id    uuid,
  created_at  timestamptz not null default now(),
  created_by  text default 'cc-session'
);
create index if not exists reprice_action_ledger_sku_idx on public.reprice_action_ledger (sku);
create index if not exists reprice_action_ledger_reason_idx on public.reprice_action_ledger (reason, created_at);
alter table public.reprice_action_ledger enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid='public.reprice_action_ledger'::regclass and polname='ral_authenticated_all') then
    create policy ral_authenticated_all on public.reprice_action_ledger for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on public.reprice_action_ledger to authenticated, service_role;
