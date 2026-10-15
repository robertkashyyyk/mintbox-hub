-- eBay Sell APIs, Prompt 2 (2026-10-15): accounts + auth plumbing. Read-only against eBay.
--
-- public.ebay_accounts (exists; used by /operations/ebay-performance) is extended, not
-- replaced. ebay_accounts.code (ASC/CPI/123/TSS/UNI) is the account key everywhere.
-- Secrets never sit in a table: refresh tokens and the signing private key live in
-- Supabase Vault and are only reachable through service_role-only SECURITY DEFINER RPCs.

-- ---------------------------------------------------------------------------
-- 1. public.ebay_accounts: display/status columns (readable by signed-in users)
-- ---------------------------------------------------------------------------
alter table public.ebay_accounts
  add column if not exists ebay_username            text,
  add column if not exists ebay_user_id             text,
  add column if not exists threeds_store_name       text,
  add column if not exists mintsoft_channel         text,
  add column if not exists threeds_store_slug       text,
  add column if not exists threeds_uk_seller_id     integer,
  add column if not exists marketplaces             text[] not null default array['EBAY_GB'],
  add column if not exists token_status             text not null default 'not_connected',
  add column if not exists refresh_token_expires_at timestamptz,
  add column if not exists consented_at             timestamptz,
  add column if not exists last_success_at          timestamptz,
  add column if not exists last_error               text;

do $$ begin
  alter table public.ebay_accounts add constraint ebay_accounts_token_status_chk
    check (token_status in ('not_connected','active','error','expired'));
exception when duplicate_object then null; end $$;

comment on column public.ebay_accounts.ebay_username is
  'eBay username. If set BEFORE consent, the OAuth callback refuses a token from any other eBay account; if NULL it is learned at consent (Identity API).';

-- 3DS / Mintsoft identifiers confirmed from order data in Prompt 1 discovery (new columns, no prior values).
update public.ebay_accounts a set
  threeds_store_name   = v.store_name,
  mintsoft_channel     = v.channel,
  threeds_store_slug   = v.slug,
  threeds_uk_seller_id = v.seller_id
from (values
  ('ASC', 'ASC',           'eBay - ASC',           'ascgroupltd',     567490),
  ('CPI', 'CPI',           'eBay - CPI',           'carpartsintl',    567491),
  ('123', '123 Autocare',  'eBay - 123 Autocare',  '123autocare',     567489),
  ('TSS', 'The Stop Shop', 'eBay - The Stop Shop', 'theautostopshop', 566068),
  ('UNI', 'Universal',     'eBay - Universal',     'no1autoshop',     567497)
) as v(code, store_name, channel, slug, seller_id)
where a.code = v.code and a.threeds_store_name is null;

-- ---------------------------------------------------------------------------
-- 2. Sealed ebay schema (service_role only), sibling of amazon.*
-- ---------------------------------------------------------------------------
create schema if not exists ebay;
revoke all on schema ebay from public, anon, authenticated;
grant usage on schema ebay to service_role;

create table if not exists ebay.connection (
  account_code              text primary key references public.ebay_accounts(code),
  refresh_token_secret_id   uuid,                 -- vault.secrets.id
  scopes                    text[] not null default '{}',
  ebay_user_id              text,
  ebay_username             text,
  refresh_token_expires_at  timestamptz,
  consented_at              timestamptz,
  oauth_state_id            uuid,
  updated_at                timestamptz not null default now()
);

-- One row per consent link. The raw nonce only ever exists inside the HMAC-signed state
-- sent to eBay; we store its SHA-256, so a DB read can't forge a callback.
create table if not exists ebay.oauth_state (
  id            uuid primary key default gen_random_uuid(),
  account_code  text not null references public.ebay_accounts(code),
  nonce_sha256  text not null unique,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  used_at       timestamptz,
  outcome       text
);

create table if not exists ebay.app_signing_key (
  signing_key_id          text primary key,
  cipher                  text not null,
  private_key_secret_id   uuid not null,          -- vault.secrets.id
  jwe                     text not null,          -- public key as JWE (sent on every signed call)
  public_key              text,
  created_at              timestamptz not null,
  expires_at              timestamptz not null,
  active                  boolean not null default true,
  stored_at               timestamptz not null default now()
);

-- Every eBay HTTP call the shared client makes (or refuses), for debugging and quota watch.
create table if not exists ebay.api_call_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  fn            text not null,
  account_code  text,
  method        text not null,
  host          text not null,
  path          text not null,
  status        integer,
  ms            integer,
  attempt       integer not null default 1,
  signed        boolean not null default false,
  blocked       boolean not null default false,       -- refused by the read-only allowlist, never sent
  error         text
);
create index if not exists ebay_api_call_log_at_idx on ebay.api_call_log (at desc);
create index if not exists ebay_api_call_log_acct_idx on ebay.api_call_log (account_code, at desc);

-- Same shape as amazon.sync_run, plus account_code (used from Prompt 3).
create table if not exists ebay.sync_run (
  sync_run_id    uuid primary key default gen_random_uuid(),
  account_code   text references public.ebay_accounts(code),
  object         text not null,
  mode           text not null default 'incremental',
  window_start   timestamptz,
  window_end     timestamptz,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running',
  rows_fetched   integer,
  rows_upserted  integer,
  error_message  text,
  next_cursor    jsonb,
  duration_ms    integer
);

-- Marketplace Account Deletion notices. We keep no buyer data (PII is stripped before
-- storage), so the notice is acknowledged and audited. The deleted user's identifiers are
-- kept only as SHA-256 hashes.
create table if not exists ebay.account_deletion_notice (
  notification_id   text primary key,
  topic             text,
  publish_date      timestamptz,
  event_date        timestamptz,
  received_at       timestamptz not null default now(),
  signature_valid   boolean,
  signature_error   text,
  user_id_sha256    text,
  username_sha256   text
);

-- ---------------------------------------------------------------------------
-- 3. RPCs (public schema so PostgREST can reach them; service_role only)
-- ---------------------------------------------------------------------------
create or replace function public.ebay_create_oauth_state(p_account text, p_nonce_sha256 text, p_created_by text, p_ttl_minutes integer default 20)
returns uuid language plpgsql security definer set search_path = public, ebay as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.ebay_accounts where code = p_account and active) then
    raise exception 'unknown or inactive eBay account %', p_account;
  end if;
  insert into ebay.oauth_state (account_code, nonce_sha256, created_by, expires_at)
  values (p_account, p_nonce_sha256, p_created_by, now() + make_interval(mins => least(greatest(p_ttl_minutes, 1), 60)))
  returning id into v_id;
  return v_id;
end $$;

-- Single use: marks the state used and returns it only if unused, unexpired and for the
-- same account the signed state names. Replays / expired / unknown → no row.
create or replace function public.ebay_consume_oauth_state(p_nonce_sha256 text, p_account text)
returns uuid language plpgsql security definer set search_path = public, ebay as $$
declare v_id uuid;
begin
  update ebay.oauth_state set used_at = now(), outcome = 'consumed'
   where nonce_sha256 = p_nonce_sha256 and account_code = p_account
     and used_at is null and expires_at > now()
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ebay_close_oauth_state(p_state_id uuid, p_outcome text)
returns void language sql security definer set search_path = public, ebay as $$
  update ebay.oauth_state set outcome = left(p_outcome, 200) where id = p_state_id;
$$;

-- Stores/rotates an account's refresh token in Vault and marks the account connected.
-- Any change to an existing stored value on ebay_accounts is written to audit_log first.
create or replace function public.ebay_store_connection(
  p_account text, p_refresh_token text, p_refresh_expires_at timestamptz, p_scopes text[],
  p_ebay_user_id text, p_ebay_username text, p_state_id uuid)
returns void language plpgsql security definer set search_path = public, ebay, vault as $$
declare
  v_secret uuid;
  v_old jsonb;
begin
  select refresh_token_secret_id into v_secret from ebay.connection where account_code = p_account;
  if v_secret is null then
    v_secret := vault.create_secret(p_refresh_token, 'ebay_refresh_token_' || lower(p_account),
                                    'eBay refresh token for account ' || p_account);
  else
    perform vault.update_secret(v_secret, p_refresh_token);
  end if;

  insert into ebay.connection (account_code, refresh_token_secret_id, scopes, ebay_user_id, ebay_username,
                               refresh_token_expires_at, consented_at, oauth_state_id, updated_at)
  values (p_account, v_secret, p_scopes, p_ebay_user_id, p_ebay_username, p_refresh_expires_at, now(), p_state_id, now())
  on conflict (account_code) do update set
    refresh_token_secret_id = excluded.refresh_token_secret_id, scopes = excluded.scopes,
    ebay_user_id = excluded.ebay_user_id, ebay_username = excluded.ebay_username,
    refresh_token_expires_at = excluded.refresh_token_expires_at, consented_at = now(),
    oauth_state_id = excluded.oauth_state_id, updated_at = now();

  select jsonb_build_object('ebay_username', ebay_username, 'ebay_user_id', ebay_user_id, 'token_status', token_status,
                            'refresh_token_expires_at', refresh_token_expires_at, 'consented_at', consented_at)
    into v_old from public.ebay_accounts where code = p_account;
  if (v_old->>'ebay_user_id') is not null or (v_old->>'refresh_token_expires_at') is not null then
    insert into public.audit_log (entity_type, entity_id, action_type, old_value, new_value)
    values ('ebay_accounts', p_account, 'ebay_reconsent', v_old,
            jsonb_build_object('ebay_username', p_ebay_username, 'ebay_user_id', p_ebay_user_id,
                               'refresh_token_expires_at', p_refresh_expires_at));
  end if;

  update public.ebay_accounts set
    ebay_username = coalesce(ebay_username, p_ebay_username),
    ebay_user_id = p_ebay_user_id,
    token_status = 'active',
    refresh_token_expires_at = p_refresh_expires_at,
    consented_at = now(),
    last_error = null
  where code = p_account;
end $$;

create or replace function public.ebay_get_refresh_token(p_account text)
returns table (refresh_token text, scopes text[], expires_at timestamptz)
language sql security definer set search_path = public, ebay, vault as $$
  select d.decrypted_secret, c.scopes, c.refresh_token_expires_at
  from ebay.connection c join vault.decrypted_secrets d on d.id = c.refresh_token_secret_id
  where c.account_code = p_account;
$$;

create or replace function public.ebay_store_signing_key(
  p_signing_key_id text, p_cipher text, p_private_key text, p_jwe text, p_public_key text,
  p_created_at timestamptz, p_expires_at timestamptz)
returns void language plpgsql security definer set search_path = public, ebay, vault as $$
declare v_secret uuid;
begin
  v_secret := vault.create_secret(p_private_key, 'ebay_signing_private_key_' || p_signing_key_id,
                                  'eBay HTTP-signature private key ' || p_signing_key_id || ' (' || p_cipher || ')');
  update ebay.app_signing_key set active = false where active;
  insert into ebay.app_signing_key (signing_key_id, cipher, private_key_secret_id, jwe, public_key, created_at, expires_at, active)
  values (p_signing_key_id, p_cipher, v_secret, p_jwe, p_public_key, p_created_at, p_expires_at, true);
end $$;

create or replace function public.ebay_get_signing_key()
returns table (signing_key_id text, cipher text, private_key text, jwe text, expires_at timestamptz)
language sql security definer set search_path = public, ebay, vault as $$
  select k.signing_key_id, k.cipher, d.decrypted_secret, k.jwe, k.expires_at
  from ebay.app_signing_key k join vault.decrypted_secrets d on d.id = k.private_key_secret_id
  where k.active order by k.created_at desc limit 1;
$$;

create or replace function public.ebay_log_api_calls(p_rows jsonb)
returns void language sql security definer set search_path = public, ebay as $$
  insert into ebay.api_call_log (at, fn, account_code, method, host, path, status, ms, attempt, signed, blocked, error)
  select coalesce((r->>'at')::timestamptz, now()), r->>'fn', r->>'account_code', r->>'method', r->>'host', r->>'path',
         (r->>'status')::int, (r->>'ms')::int, coalesce((r->>'attempt')::int, 1),
         coalesce((r->>'signed')::boolean, false), coalesce((r->>'blocked')::boolean, false), left(r->>'error', 500)
  from jsonb_array_elements(p_rows) r;
$$;

create or replace function public.ebay_mark_account(p_account text, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.ebay_accounts set
    last_success_at = case when p_ok then now() else last_success_at end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    token_status = case when not p_ok and p_error ilike '%invalid_grant%' then 'error' else token_status end
  where code = p_account;
$$;

create or replace function public.ebay_log_deletion_notice(
  p_notification_id text, p_topic text, p_publish_date timestamptz, p_event_date timestamptz,
  p_signature_valid boolean, p_signature_error text, p_user_id_sha256 text, p_username_sha256 text)
returns void language sql security definer set search_path = public, ebay as $$
  insert into ebay.account_deletion_notice (notification_id, topic, publish_date, event_date, signature_valid,
                                            signature_error, user_id_sha256, username_sha256)
  values (p_notification_id, p_topic, p_publish_date, p_event_date, p_signature_valid, left(p_signature_error, 300),
          p_user_id_sha256, p_username_sha256)
  on conflict (notification_id) do nothing;
$$;

-- Refresh tokens (~18 months) and the signing key (3 years) that need attention.
create or replace function public.ebay_token_health(p_warn_days integer default 60)
returns table (kind text, account_code text, expires_at timestamptz, days_left integer, status text)
language sql stable security definer set search_path = public, ebay as $$
  select 'refresh_token', a.code, a.refresh_token_expires_at,
         floor(extract(epoch from (a.refresh_token_expires_at - now())) / 86400)::int,
         case when a.refresh_token_expires_at < now() then 'expired'
              when a.refresh_token_expires_at < now() + make_interval(days => p_warn_days) then 'expiring'
              else 'ok' end
  from public.ebay_accounts a where a.active and a.refresh_token_expires_at is not null
  union all
  select 'signing_key', k.signing_key_id, k.expires_at,
         floor(extract(epoch from (k.expires_at - now())) / 86400)::int,
         case when k.expires_at < now() then 'expired'
              when k.expires_at < now() + make_interval(days => greatest(p_warn_days, 90)) then 'expiring'
              else 'ok' end
  from ebay.app_signing_key k where k.active;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.ebay_create_oauth_state(text,text,text,integer)',
    'public.ebay_consume_oauth_state(text,text)',
    'public.ebay_close_oauth_state(uuid,text)',
    'public.ebay_store_connection(text,text,timestamptz,text[],text,text,uuid)',
    'public.ebay_get_refresh_token(text)',
    'public.ebay_store_signing_key(text,text,text,text,text,timestamptz,timestamptz)',
    'public.ebay_get_signing_key()',
    'public.ebay_log_api_calls(jsonb)',
    'public.ebay_mark_account(text,boolean,text)',
    'public.ebay_log_deletion_notice(text,text,timestamptz,timestamptz,boolean,text,text,text)',
    'public.ebay_token_health(integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['connection','oauth_state','app_signing_key','api_call_log','sync_run','account_deletion_notice'] loop
    execute format('alter table ebay.%I enable row level security', t);
  end loop;
end $$;

grant select, insert, update on all tables in schema ebay to service_role;
grant usage, select on all sequences in schema ebay to service_role;
