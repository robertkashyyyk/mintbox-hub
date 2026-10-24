# Internal-auth batch: plan (not deployed)

**Status:** plan only. Prompt 0 step 4, 13 Oct 2026.

**Helper:** `supabase/functions/_shared/internal_auth.ts` is written but nothing imports it yet. The eBay functions (Prompt 2) use it from the start.

## Problem

About 25 deployed functions run with `verify_jwt = false` and no caller check, so anyone with the URL can trigger them. Two constraints decide the shape of the fix:

1. **Supabase's gateway check only verifies the legacy `anon` / `service_role` JWTs.** It rejects `sb_secret_…` / `sb_publishable_…` keys. Two functions are called with an `sb_secret` key, so they can't simply turn `verify_jwt` on:
   - `sync-mintsoft-orders` → `evaluate-order-issues`
   - `auto-update-lsa-cron` → itself, when it self-chains
2. **Decoding a JWT's role without verifying it is forgeable.** Prompt 0 found exactly this in `threeds-reprice-reconcile`, `threeds-sftp-touch` and `ingest-3ds-orders`.

## The check: `requireCaller(req, opts)`

It works with `verify_jwt` on or off, and never trusts an unverified claim. The first match wins:

| # | Caller | How it is verified | Who uses it |
|---|---|---|---|
| 1 | Project secret key in `apikey` or `Bearer` | Constant-time compare to `SUPABASE_SECRET_KEYS` / `SUPABASE_SERVICE_ROLE_KEY` | Function → function calls (`sb_secret` callers) |
| 2 | `x-hub-internal` header | Constant-time compare to the Vault secret `hub_internal_secret`, read once per isolate via a service-role RPC | **pg_cron** |
| 3 | Signed-in Hub user | `auth.getUser()`; only when `allowUsers: true` | Hub UI buttons |
| 4 | Legacy `service_role` JWT | Gateway-verified; only with `trustGatewayServiceJwt: true` **and** `verify_jwt = true` | Transition only |

Anything else gets a 401 and a row in `public.edge_auth_rejections`. The token is never stored.

**One migration supports the cron path:**

```sql
-- value generated server-side, never printed
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'hub_internal_secret',
                           'pg_cron -> edge function shared secret');
create function public.hub_internal_secret() returns text
  language sql security definer set search_path = '' as
  $$ select decrypted_secret from vault.decrypted_secrets where name = 'hub_internal_secret' $$;
revoke all on function public.hub_internal_secret() from public, anon, authenticated;
grant execute on function public.hub_internal_secret() to service_role;
```

**The cron change** is the same for every job. Replace the `Authorization` header (an anon JWT, or none) with:

```sql
headers := jsonb_build_object('Content-Type','application/json',
  'x-hub-internal', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_internal_secret'))
```

Rotating the secret means updating the Vault entry only. Functions re-read it on their next cold start.

**Deploying:** the CLI bundles `../_shared/` imports automatically. With the MCP `deploy_edge_function`, include `_shared/internal_auth.ts` in `files`.

## Ranked list, with the cron changes paired

Rollout per batch:

1. Apply the migration once, before batch A.
2. Deploy the batch's functions with the guard.
3. **Then, in the same step,** re-point the batch's crons to `x-hub-internal`.
4. Confirm each cron's next run in `net._http_response` / `edge_auth_rejections`.
5. Only then move to the next batch.

Columns: "UI" means a frontend caller that needs `allowUsers: true`. "Fn" means another function calls it.

### Batch A: writes to external systems or the catalogue (highest risk)

| Function | Crons to re-point (current bearer) | Other callers | Notes |
|---|---|---|---|
| `auto-update-lsa-cron` | 4 `*/15` (anon) | UI: `AutoLsaScheduleCard`, `Brands`; **self-chain with service key** (rule 1 covers it) | Pushes LSA to Mintsoft |
| `klokkerholm-ingest` | 89 hourly (anon) | — | Equalises WH6 stock in Mintsoft; reads sourcing@ Gmail |
| `sync-supplier-feed` | 65 02:00 (anon) | — | Writes supplier stock to Mintsoft |
| `process-product-csv` | — | UI: `useChunkedCsvUpload` | Writes `products_cache` from CSV |

### Batch B: paid APIs and email senders

| Function | Crons to re-point | Other callers | Notes |
|---|---|---|---|
| `image-scout-process` | 34 `*/5` (anon) | UI: ImageScout, ImageScoutQARun | Firecrawl / Anthropic / remove.bg spend |
| `web-search-dimensions` | — | UI: DimsWeights | Brave / SERP / Anthropic spend |
| `send-ops-weekly-report` | 32 Fri 16:45 (anon) | UI: OpsReports | Sends email |
| `stale-asn-guard-email` | 113 monthly (none) | — | Sends email; accepts `?to=` |
| `supplier-feed-watchdog` | 120 08:00 (anon) | — | Emails Clive + Robert |

### Batch C: core sync workers (do in a quiet window, one at a time)

| Function | Crons to re-point | Other callers | Notes |
|---|---|---|---|
| `sync-mintsoft-orders` | 30 06:00 (anon), 31 `*/15` (anon) | UI: SystemHealthStrip, useOrderTelemetry | Order ingest; calls `evaluate-order-issues` with `sb_secret` |
| `evaluate-order-issues` | 7 `*/15` (anon) | Fn: `sync-mintsoft-orders` (`sb_secret`, rule 1); UI: SystemHealthStrip | — |
| `poll-despatched-today` | 14 `*/5` (none) | — | Despatch ledger |
| `sftp-pull-stock` | 26 06:00 (anon) | UI: Settings; Fn: `pull-mintsoft-stock-ftp` | Writes `current_stock`; deletes the pulled file |
| `sftp-pull-lowstock` | 24 07:30 (anon) | — | Writes LSA |
| `mintsoft-fetch-todays-asns` | 13 `*/15` (none) | UI: PurchaseOrders | Buy-engine overlay |
| `mintsoft-enrich-batch` | 11 2-hourly (anon), 12 `*/30` (anon) | UI: SystemHealthStrip | — |
| `mintsoft-fetch-products` | — | UI: MintsoftProductPull | — |
| `mintsoft-discover-new-products` | 10 Sun 06:00 (none) | UI: MintsoftProductPull | — |
| `mintsoft-resolve-orphan-skus` | 22 6-hourly (none) | UI: ProductDetail, OrphanSkus | — |
| `mintsoft-scan-asns` | 112 04:00 (none) | — | — |
| `mintsoft-order-snapshot` | 41, 42 (none) | — | Replace the optional `CRON_SECRET` check |
| `mintsoft-backorder-age-snapshot` | 35 06:30 (anon) | — | Replace the optional `CRON_SECRET` check |
| `reprice-payoff` | 48 23:50 (service_role JWT) | UI: reprice lib, StandingReports | — |

### Batch D: tidy-up

| Function | Action |
|---|---|
| `pull-mintsoft-stock-ftp` | Deprecated redirect; retire to a 410 stub |
| `mintsoft-sync` | No callers found; confirm, then retire |
| `email-intake` | Keep public (webhook). Make its token compare constant-time |
| `push-dims-to-mintsoft`, `update-product-fields` | Already verify users (`getUser` + role); add `requireCaller` for consistency only |

### Also worth covering (gateway on, but no in-function check)

These have `verify_jwt = true`, so anyone holding the **public anon key** can still call them. They should adopt `requireCaller` too:
- `amazon-sweep-listing-issues` (cron 106, anon)
- `orin-report` (54–56, anon)
- the email crons: 98, 104, 109, 111, 114, 115, 119 (anon)
- `dirt-replace-push` (99, anon; writes SFTP re-SKU files)
- `dirt-run-health` (103)
- `reconcile-*` (19, 105)
- `poll-*` (15, 16)
- `backfill-noneset-courier` (92)

Inventory them before batch A.

## Risk notes

- **Batch C** touches order sync, stock and despatch. One function per step, watching the next two cron runs before moving on.
- **No-header crons** are marked "(none)" above. They currently rely on `verify_jwt = false`. Re-point each cron **in the same step** as its function's deploy, or it gets a 401 on its next run.
- **The UI path:** `allowUsers: true` works for any signed-in Hub user. Where a function should be senior-only, add the existing role check after `requireCaller`.
