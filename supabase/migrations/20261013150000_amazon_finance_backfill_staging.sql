-- security/prompt0-fixes item 4 (2026-10-13): Amazon finance backfill — stage, then swap.
--
-- Old flow (amazon-refinance-backfill): DELETE a 7-day window of amazon.financial_events,
-- then re-pull it page by page. If the time budget or the page guard ran out mid-window,
-- the driver still marked the window done and moved on → rows deleted, never re-pulled.
--
-- New flow: a window is pulled into amazon.financial_events_stage under a stage_id and
-- only touches live data in ONE transaction (amazon_swap_finance_window) once the pull
-- has completed. The swap is a diff on the natural key (marketplace_id, event_type,
-- posted_date, event_hash): live rows absent from the fresh pull are deleted, staged rows
-- not yet live are inserted, unchanged rows are left alone (event_id preserved). A window
-- that never finishes pulling leaves live data untouched.

create table if not exists amazon.finance_backfill_window (
  stage_id        uuid primary key default gen_random_uuid(),
  marketplace_id  text not null,
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  status          text not null default 'pulling'
                  check (status in ('pulling','swapped','failed','abandoned')),
  pulled_after    timestamptz,   -- PostedAfter/PostedBefore Amazon actually applied (first page);
  pulled_before   timestamptz,   -- the swap only ever touches [pulled_after, pulled_before)
  pages           integer not null default 0,
  events_staged   integer not null default 0,
  live_before     integer,
  rows_deleted    integer,
  rows_inserted   integer,
  live_after      integer,
  error           text,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  swapped_at      timestamptz,
  check (window_end > window_start)
);
create index if not exists finance_backfill_window_started_idx on amazon.finance_backfill_window (started_at desc);

create table if not exists amazon.financial_events_stage (
  stage_id        uuid not null references amazon.finance_backfill_window(stage_id) on delete cascade,
  marketplace_id  text not null,
  event_type      text not null,
  event_subtype   text,
  posted_date     timestamptz not null,
  amazon_order_id text,
  sku             text,
  asin            text,
  amount          numeric not null,
  direction       text not null check (direction in ('credit','debit')),
  original_amount numeric not null,
  currency_code   character(3) not null,
  fee_description text,
  event_hash      text not null,
  raw_id          bigint references amazon.raw_event(raw_id) on delete set null,
  staged_at       timestamptz not null default now(),
  primary key (stage_id, marketplace_id, event_type, posted_date, event_hash)
);

-- Begin a staged window (returns the stage_id the pulls must carry).
create or replace function public.amazon_begin_finance_window(
  p_marketplace_id text, p_start timestamptz, p_end timestamptz)
returns uuid
language plpgsql security definer set search_path = amazon, public
as $$
declare v_id uuid;
begin
  insert into amazon.finance_backfill_window (marketplace_id, window_start, window_end)
  values (p_marketplace_id, p_start, p_end)
  returning stage_id into v_id;
  return v_id;
end $$;

-- Stage one page of listFinancialEvents (same event mapping as amazon_ingest_financial_events).
create or replace function public.amazon_ingest_financial_events_stage(
  p_stage_id uuid, p_marketplace_id text, p_window_start timestamptz, p_window_end timestamptz,
  p_request_params jsonb, p_next_token text, p_raw_payload jsonb, p_events jsonb)
returns jsonb
language plpgsql security definer set search_path = public, amazon
as $$
declare
  v_conn uuid := amazon._ensure_connection(p_marketplace_id);
  v_run uuid; v_raw bigint; v_inserted integer := 0; v_status text;
begin
  select status into v_status from amazon.finance_backfill_window where stage_id = p_stage_id for update;
  if v_status is null then raise exception 'unknown stage_id %', p_stage_id; end if;
  if v_status <> 'pulling' then raise exception 'stage % is %, not pulling', p_stage_id, v_status; end if;

  insert into amazon.sync_run (connection_id, object, mode, window_start, window_end, status, finished_at)
  values (v_conn, 'financial_events_stage', 'backfill', p_window_start, p_window_end, 'success', now())
  returning sync_run_id into v_run;

  insert into amazon.raw_event (connection_id, sync_run_id, endpoint, request_params, response_payload, next_token, parsed_at)
  values (v_conn, v_run, 'listFinancialEvents', p_request_params, p_raw_payload, p_next_token, now())
  returning raw_id into v_raw;

  insert into amazon.financial_events_stage (
    stage_id, marketplace_id, event_type, event_subtype, posted_date, amazon_order_id, sku, asin,
    amount, direction, original_amount, currency_code, fee_description, event_hash, raw_id)
  select p_stage_id, p_marketplace_id, e->>'event_type', nullif(e->>'event_subtype',''),
    (e->>'posted_date')::timestamptz, nullif(e->>'amazon_order_id',''), nullif(e->>'sku',''), nullif(e->>'asin',''),
    abs((e->>'original_amount')::numeric),
    case when (e->>'original_amount')::numeric < 0 then 'debit' else 'credit' end,
    (e->>'original_amount')::numeric, coalesce(nullif(e->>'currency_code',''),'GBP'),
    nullif(e->>'fee_description',''), e->>'event_hash', v_raw
  from jsonb_array_elements(coalesce(p_events,'[]'::jsonb)) e
  where coalesce(e->>'event_hash','') <> '' and (e->>'original_amount') is not null
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  update amazon.sync_run set rows_fetched = jsonb_array_length(coalesce(p_events,'[]'::jsonb)), rows_upserted = v_inserted
   where sync_run_id = v_run;
  -- First page fixes the query range Amazon applied; NextToken pages continue that query.
  update amazon.finance_backfill_window
     set pages = pages + 1, events_staged = events_staged + v_inserted, updated_at = now(),
         pulled_after  = coalesce(pulled_after,  (p_request_params->>'PostedAfter')::timestamptz),
         pulled_before = coalesce(pulled_before, (p_request_params->>'PostedBefore')::timestamptz)
   where stage_id = p_stage_id;

  return jsonb_build_object('sync_run_id', v_run, 'raw_id', v_raw,
    'events_seen', jsonb_array_length(coalesce(p_events,'[]'::jsonb)), 'events_inserted', v_inserted);
end $$;

-- Swap a fully-pulled window into live, atomically, as a diff on the natural key.
-- Refuses an empty pull over a non-empty live window unless p_allow_empty.
create or replace function public.amazon_swap_finance_window(p_stage_id uuid, p_allow_empty boolean default false)
returns jsonb
language plpgsql security definer set search_path = amazon, public
as $$
declare
  w amazon.finance_backfill_window%rowtype;
  v_lo timestamptz; v_hi timestamptz;
  v_staged int; v_before int; v_del int; v_ins int; v_after int;
begin
  select * into w from amazon.finance_backfill_window where stage_id = p_stage_id for update;
  if not found then raise exception 'unknown stage_id %', p_stage_id; end if;
  if w.status <> 'pulling' then raise exception 'stage % is %, not pulling', p_stage_id, w.status; end if;
  if w.pulled_after is null or w.pulled_before is null then
    raise exception 'stage % has no pulled range (no pages staged)', p_stage_id;
  end if;
  -- Only the range Amazon was actually asked for, clipped to the nominal window.
  v_lo := greatest(w.window_start, w.pulled_after);
  v_hi := least(w.window_end, w.pulled_before);
  if v_hi <= v_lo then raise exception 'stage % pulled range is empty', p_stage_id; end if;

  select count(*) into v_staged from amazon.financial_events_stage where stage_id = p_stage_id;
  select count(*) into v_before from amazon.financial_events
   where marketplace_id = w.marketplace_id and posted_date >= v_lo and posted_date < v_hi;

  if v_staged = 0 and v_before > 0 and not p_allow_empty then
    update amazon.finance_backfill_window set status = 'failed', live_before = v_before, updated_at = now(),
           error = 'refused: empty pull over non-empty live window' where stage_id = p_stage_id;
    return jsonb_build_object('ok', false, 'error', 'empty pull over non-empty live window', 'live_before', v_before);
  end if;

  delete from amazon.financial_events f
   where f.marketplace_id = w.marketplace_id
     and f.posted_date >= v_lo and f.posted_date < v_hi
     and not exists (select 1 from amazon.financial_events_stage s
                      where s.stage_id = p_stage_id and s.marketplace_id = f.marketplace_id
                        and s.event_type = f.event_type and s.posted_date = f.posted_date and s.event_hash = f.event_hash);
  get diagnostics v_del = row_count;

  insert into amazon.financial_events (marketplace_id, event_type, event_subtype, posted_date, amazon_order_id, sku, asin,
    amount, direction, original_amount, currency_code, fee_description, event_hash, raw_id)
  select s.marketplace_id, s.event_type, s.event_subtype, s.posted_date, s.amazon_order_id, s.sku, s.asin,
    s.amount, s.direction, s.original_amount, s.currency_code, s.fee_description, s.event_hash, s.raw_id
  from amazon.financial_events_stage s
  where s.stage_id = p_stage_id and s.posted_date >= v_lo and s.posted_date < v_hi
  on conflict (marketplace_id, event_type, posted_date, event_hash) do nothing;
  get diagnostics v_ins = row_count;

  select count(*) into v_after from amazon.financial_events
   where marketplace_id = w.marketplace_id and posted_date >= v_lo and posted_date < v_hi;

  delete from amazon.financial_events_stage where stage_id = p_stage_id;
  update amazon.finance_backfill_window
     set status = 'swapped', live_before = v_before, rows_deleted = v_del, rows_inserted = v_ins,
         live_after = v_after, swapped_at = now(), updated_at = now()
   where stage_id = p_stage_id;

  return jsonb_build_object('ok', true, 'stage_id', p_stage_id, 'range', jsonb_build_array(v_lo, v_hi),
    'staged', v_staged, 'live_before', v_before, 'deleted', v_del, 'inserted', v_ins, 'live_after', v_after);
end $$;

-- Mark a window failed/abandoned (live data untouched; staged rows dropped).
create or replace function public.amazon_abandon_finance_window(p_stage_id uuid, p_error text default null)
returns void
language plpgsql security definer set search_path = amazon, public
as $$
begin
  delete from amazon.financial_events_stage where stage_id = p_stage_id;
  update amazon.finance_backfill_window
     set status = case when p_error is null then 'abandoned' else 'failed' end, error = p_error, updated_at = now()
   where stage_id = p_stage_id and status = 'pulling';
end $$;

revoke all on function public.amazon_begin_finance_window(text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.amazon_ingest_financial_events_stage(uuid, text, timestamptz, timestamptz, jsonb, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.amazon_swap_finance_window(uuid, boolean) from public, anon, authenticated;
revoke all on function public.amazon_abandon_finance_window(uuid, text) from public, anon, authenticated;
grant execute on function public.amazon_begin_finance_window(text, timestamptz, timestamptz) to service_role;
grant execute on function public.amazon_ingest_financial_events_stage(uuid, text, timestamptz, timestamptz, jsonb, text, jsonb, jsonb) to service_role;
grant execute on function public.amazon_swap_finance_window(uuid, boolean) to service_role;
grant execute on function public.amazon_abandon_finance_window(uuid, text) to service_role;

-- The old delete-first RPC is no longer used by the driver; keep it service-role-only.
revoke all on function public.amazon_delete_finance_window(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.amazon_delete_finance_window(timestamptz, timestamptz) to service_role;
