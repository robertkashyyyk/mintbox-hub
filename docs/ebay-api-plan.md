# eBay Sell APIs → PartsDoc Hub: Claude Code prompts (v2, after discovery)

Run these in order. Each prompt ends at a gate. Bring the report back to chat before running the next prompt.

Robert's inputs needed before Prompt 2:
- The five eBay usernames, mapped to their 3DS account names.
- One recent eBay VAT invoice per account (from Seller Hub → Payments → Reports/Invoices).
- Amanda to confirm that VAT on the eBay regulatory fee is reclaimable.
- A Production keyset at developer.ebay.com plus an RuName. CC will tell you the accept URL to use.

---

## Prompt 0: Security fixes (do first, today)

```
Discovery flagged security issues. Fix these before any eBay work, in this order. For each fix, log what you changed and show me how you tested it.

1. threeds-probe, threeds-mcp-probe and debug-secret: these are public and expose or proxy our 3DS and Mintsoft keys. Show me any code that still calls them. If nothing needs them, delete them. If something does, put them behind service-role auth. Then give me the list of keys I must rotate (3DS API key, Mintsoft key, and any other key these functions could have read), and where each one is stored, so I can rotate them and update the secrets.
2. eSagu price writers: add caller verification (service-role JWT or a shared-secret header checked in constant time, matching how our other internal functions authenticate). Reject unauthenticated calls with 401 and log the attempt. Confirm the existing scheduled callers still work.
3. Sweep all edge functions: list every function deployed with verify_jwt=false, what it does, and whether it needs to be public. Fix the obvious ones and report the rest. Don't change anything that's genuinely a public webhook without asking.
4. Amazon finance backfill: fix the delete-then-skip bug so a window is never deleted unless the re-pull for it succeeds (pull into staging, then swap in a transaction). Re-run any windows that were affected, and tell me which ones.

STOP and report.
```

---

## Prompt 0b: Fix the two existing contribution leaks

```
Before we compare anything against eBay Finances data, fix the two leaks found in discovery, so the shadow comparison is clean.

1. Cancelled eBay orders are still counted in contribution (~£13.8k per 13 weeks). Exclude cancelled orders/lines at the source view, consistent with the September integrity audit finding. Show before/after totals per account for the last 13 weeks.
2. Postage fee double-counted in the postage-inclusive figure the bands use (~£2.9k per 90 days). Fix it at the root, and show before/after.
3. Log old values before changing any stored figures. Report how many SKUs change contribution band as a result.

STOP and report.
```

---

## Prompt 2: eBay auth and token plumbing (revised)

```
Discovery is approved, with these decisions:

- Extend the existing ebay_accounts table (used by /operations/ebay-performance). Don't create a new one. Add: eBay username, 3DS account name, marketplaces, token status, refresh-token expiry, last successful call. Usernames: [PASTE 5 USERNAMES → 3DS NAMES].
- Scopes (final, so we only consent once): sell.finances, sell.fulfillment.readonly, sell.analytics.readonly, sell.marketing (full scope; the ad reports require it), sell.account.readonly, plus whatever scope the Sell Feed API active inventory report needs (verify; likely sell.inventory). Verify every scope name against current docs and give me the final list before building the consent URL.
- READ-ONLY ENFORCEMENT: because sell.marketing and possibly sell.inventory grant write access, the shared eBay client must hold an explicit allowlist of permitted methods/paths (GET calls, plus the POST report-task creation endpoints for ad reports and feed tasks). Any other write call must throw before it's sent. Add a test proving that a campaign update or offer write is blocked.
- Token storage: Supabase Vault for the 5 refresh tokens. App ID, Cert ID, Dev ID and RuName go in edge secrets.
- Shared helper module in supabase/functions/_shared/ebay/: token fetch/refresh, request signing, the method allowlist, rate-limit handling with backoff, and a run log. Agreed: shared rather than duplicated per function.
- Digital signatures: implement eBay HTTP message signing (signing keys via the Key Management API, keys in Vault) in the shared client. It's required on Finances calls for UK sellers.
- Callback: an edge function with a signed, single-use, short-expiry state parameter tied to the account key. Reject replays and unknown accounts.
- Marketplace Account Deletion endpoint: handle the challenge/verification, acknowledge notices, log them to an audit table.
- Client-credentials (application) token helper for future Browse use. Helper only.
- Alert via Resend to Robert 60 days before any refresh token expires.

Tell me the exact RuName accept URL and the secret names to set.

Test after I consent ONE account: one harmless call per scope (findSellerStandardsProfiles, one day of getTransactions, one page of getOrders, getCampaigns, and a Feed API task list call). Show sanitised response shapes, and confirm signing works on Finances.

STOP. I'll consent the other four after review.
```

---

## Prompt 3: Finances → true eBay order profit (revised, shadow mode)

```
All 5 accounts are authorised. Build Finances ingestion. Discovery findings to apply: order_earnings is US-only, so build from getTransactions. Finances line items carry no SKU. Money attaches through orderId to Fulfillment order lines and Mintsoft's kit explode, not through SKU.

1. Landing tables (append-only, raw JSON plus parsed columns), idempotent on transactionId plus account:
   - ebay_fin_transactions: ALL transaction types and ALL marketplaces for each account (the money is account-level). Fee breakdowns by feeType, AD_FEE, international fee, regulatory fee, refunds, disputes, fee credits, shipping labels, non-sale charges.
   - ebay_orders_api / ebay_order_lines_api from Fulfillment getOrders, for orderId → line item → SKU, legacy IDs and cancellation status.
2. Backfill to the API's maximum lookback (tell me what it is), chunked and resumable. Use staging-then-swap, never delete-then-pull (see the Amazon backfill bug). Log runs with counts.
3. Nightly incremental with a 14-day overlap re-pull, because ad fees, refunds and credits post late.
4. VAT (confirmed from the Sept 2026 tax invoice): final value, international, ad and regulatory operating fees all carry 20% reclaimable VAT, so use ÷1.2. "Non-eBay delivery fees" are non-taxable, so make no VAT adjustment. Subscription and one-time fees are OpEx, so exclude them from per-order profit. Keep the VAT treatment per fee type in one config place. Check how Finances presents these amounts (gross or net) against the invoice before applying.
5. Per-order-line profit view: account, marketplace, orderId, line, TRUE SKU (via the existing resolver plus kit explode), single-unit qty, gross, each fee component ex-VAT, ad fee, international fee, label cost, refunds/credits, net proceeds. Allocate order-level charges to lines pro rata by line value, and document the rule. Unresolved lines are kept and flagged.
6. SHADOW COMPARISON (last 90 days, after the Prompt 0b fixes): the current Hub (3DS-sourced fees ÷ 1.2, plus the rate model for the other 2.5%) against Finances. Break the gap down by component: ad fees, international, refunds/disputes, credits, residual. Summarise per account and per band, show the 50 worst orders, and count how many SKUs change band.

STOP with the shadow report. Switching the bands over is my call.
```

---

## Prompt 4: Traffic report → listing funnel (revised for rate limits)

```
Constraint from discovery: ~176k active listings, ~100 traffic calls a day, 200 listings per call.

1. Listing→SKU map: use the Sell Feed API active inventory report (one bulk file per account, scheduled daily or weekly) to map every active listing ID to its SKU, price and qty. Verify that the report includes Trading-API/3DS-created listings. If it doesn't, propose the cheapest Trading API fallback. Never read listing state from 3DS.
2. Account-level daily trend: dimension=DAY per account, all funnel metrics.
3. Listing-level pull, prioritised: (a) listings with stock and sales in the last 90 days, (b) listings with stock and no sales, (c) the rest on a slow rotation. Budget the calls so tier (a) refreshes weekly and (b) monthly. Show me the maths.
4. Draft the Application Growth Check request to raise our Analytics call limits, for me to submit.
5. Funnel classes (INVISIBLE / IGNORED / BROWSED_NOT_BOUGHT / HEALTHY) with config-driven thresholds. Join to Finances contribution, and produce a Monday "50 to fix" list per account ranked by margin at stake.

STOP and show me the call budget, the class distribution and a sample Monday list before scheduling anything.
```

---

## Prompt 5: Ads vs profit, and automating the seller standards page (revised)

```
A) Promoted Listings: ad_report_task → ad_report, daily, listing-level, per account, all funding models. Reconcile against Finances AD_FEE (Finances is canonical for money). Flag listings where ads push contribution into Loss/Breakeven, and listings with spend but no attributed sales. Produce a recommendations list only. The read-only allowlist stays in force: no campaign writes.

B) Seller standards: automate the existing /operations/ebay-performance page. Don't build a new one. Replace its manual inputs with daily pulls of findSellerStandardsProfiles (current and projected) and getCustomerServiceMetric (INAD, INR, with peer benchmarks), stored as history. Add headroom per metric (how many more defects before the level drops) and a Resend alert to Robert when the projected level falls or headroom drops under a configurable buffer.

STOP with screenshots of both before turning on schedules or alerts.
```

---

## Later: Browse API for Price Hunter
Reuses the client-credentials helper. Lands in the append-only competitor_prices table, excluding our own seller accounts.
