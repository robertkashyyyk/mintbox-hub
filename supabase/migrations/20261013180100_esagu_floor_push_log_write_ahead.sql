-- Applied to prod after 20261013180000 (which, in this repo, already contains the final shape).
-- Kept so the repo matches prod's migration history. Idempotent.
alter table public.esagu_floor_push_log alter column ok drop not null;
grant update (ok, http_status, error) on table public.esagu_floor_push_log to service_role;
comment on column public.esagu_floor_push_log.ok is 'NULL = row written before the PUT and the outcome was never recorded (treat as unknown; check eSagu). true/false = PUT result.';
alter table public.esagu_floor_push_log add column if not exists source_fn text not null default 'esagu-set-floor';
comment on table public.esagu_floor_push_log is
  'Every live eSagu minPrice push (esagu-set-floor, esagu-costfloor-guard): item, old/new floor and max (pence), caller, outcome. Written write-ahead by the edge functions with the service role.';
