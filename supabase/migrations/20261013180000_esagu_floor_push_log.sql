-- 2026-10-13: every LIVE push made by esagu-set-floor is logged here (item, old/new min,
-- old/new max, result, caller). Dry runs are not pushes and are not logged.
-- Write-ahead: the row is inserted BEFORE the PUT (ok NULL) and the outcome is filled in
-- after. If the insert fails the function refuses to push. ok NULL afterwards = unknown.
create table if not exists public.esagu_floor_push_log (
  id             bigserial primary key,
  at             timestamptz not null default now(),
  esagu_item_id  bigint not null,
  old_min_pence  integer,
  new_min_pence  integer not null,
  old_max_pence  integer,
  new_max_pence  integer,
  ok             boolean,               -- NULL = outcome not recorded (check eSagu)
  http_status    integer,
  error          text,
  caller_kind    text not null,          -- service_key | service_jwt | user
  caller_user_id uuid,                   -- set when caller_kind = 'user'
  reason         text,                   -- optional, from the request body
  user_agent     text,
  source_fn      text not null default 'esagu-set-floor'  -- esagu-set-floor | esagu-costfloor-guard
);
create index if not exists esagu_floor_push_log_item_idx on public.esagu_floor_push_log (esagu_item_id, at desc);
create index if not exists esagu_floor_push_log_at_idx on public.esagu_floor_push_log (at desc);

alter table public.esagu_floor_push_log enable row level security;
revoke all on table public.esagu_floor_push_log from public, anon, authenticated;
revoke all on sequence public.esagu_floor_push_log_id_seq from public, anon, authenticated;
grant select, insert on table public.esagu_floor_push_log to service_role;
grant update (ok, http_status, error) on table public.esagu_floor_push_log to service_role;
grant usage on sequence public.esagu_floor_push_log_id_seq to service_role;

comment on table public.esagu_floor_push_log is
  'Every live eSagu minPrice push (esagu-set-floor, esagu-costfloor-guard): item, old/new floor and max (pence), caller, outcome. Written write-ahead by the edge functions with the service role.';
