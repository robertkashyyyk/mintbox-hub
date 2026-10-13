-- security/prompt0-fixes (2026-10-13): durable log of edge-function calls rejected
-- by in-function caller auth. Never stores the presented token.
-- Applied to prod via MCP apply_migration (name: edge_auth_rejections).
create table if not exists public.edge_auth_rejections (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  function_name text not null,
  reason        text not null,
  jwt_role      text,
  ip            text,
  user_agent    text,
  method        text
);
create index if not exists edge_auth_rejections_at_idx on public.edge_auth_rejections (at desc);
create index if not exists edge_auth_rejections_fn_idx on public.edge_auth_rejections (function_name, at desc);

alter table public.edge_auth_rejections enable row level security;
revoke all on table public.edge_auth_rejections from public, anon, authenticated;
revoke all on sequence public.edge_auth_rejections_id_seq from public, anon, authenticated;
grant select, insert on table public.edge_auth_rejections to service_role;
grant usage on sequence public.edge_auth_rejections_id_seq to service_role;

comment on table public.edge_auth_rejections is
  'Calls rejected by in-function caller auth (eSagu writers etc.). Written by edge functions with the service role; token values are never stored.';
