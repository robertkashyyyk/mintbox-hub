# Phase 4 Discovery — 3D Sellers ↔ Mintsoft Reconciliation

_Last updated: 2026-05-20 (post-probe)_

## TL;DR

The join-key problem **is already solved by Mintsoft** — we don't need any new
field. **Mintsoft `OrderNumber` natively carries the marketplace order ID**,
and 3D Sellers exposes the same value as `externalId`. The match is
deterministic and one-to-one:

| Channel    | Mintsoft `OrderNumber`         | 3DS `externalId`     | Rule                              |
| ---------- | ------------------------------ | -------------------- | --------------------------------- |
| `Ebay`     | `04-14672-27365-1381335`       | `04-14672-27365`     | Strip trailing `-NNNNNNN` segment |
| `Amazon`   | `205-7690691-5773157`          | (predicted same)     | 1:1, use as-is                    |

This collapses what was originally a four-tier reconciliation cascade into one
exact-match join with a tiny fallback layer (Tier 2: postcode + time window +
total) reserved for the rare edge cases where OrderNumber parsing fails.

---

## 1. 3D Sellers API — confirmed

**Auth:** `Authorization: Bearer <THREEDS_API_KEY>` with the long-lived hex API
key (40-char hex format like `4a971f78…ecfb`). Token refreshed 2026-05-20.

**Sellers endpoint:** `GET /v1/sellers` — returns full seller list, 21 active
records. UK marketplaces scoped to Phase 4 build:

| Scoped Name        | Store handle      | Marketplace | Seller ID  |
| ------------------ | ----------------- | ----------- | ---------- |
| CPI                | `carpartsintl`    | eBay UK     | **567491** |
| ASC                | `ascgroupltd`     | eBay UK     | **567490** |
| 123 Autocare       | `123autocare`     | eBay UK     | **567489** |
| The Stop Shop      | `theautostopshop` | eBay UK     | **566068** |
| Universal *(TBC)*  | `no1autoshop`     | eBay UK     | **567497** |

> **Pending confirmation:** "Universal" maps to `no1autoshop` (567497) by
> elimination — the only remaining UK GBP store. User to confirm before build
> hard-codes it.

**Orders endpoint:** `GET /v1/orders?sellerId={id}&limit=100&page=N` — returns
buyer, shipping address, transactions (line items). Page metadata gives
`total` so we can cleanly paginate.

### Redacted sample payload (eBay - CPI, seller 567491)

```json
{
  "id": 125822495,                              // 3DS internal order ID
  "sellerId": 567491,
  "channel": "ebay",
  "externalId": "06-14669-20984",               // ★ eBay order ID — JOIN KEY
  "createdAt": "2026-05-20T14:43:42.110Z",
  "orderDate": "2026-05-20T14:43:40.000Z",
  "updatedAt": "2026-05-20T14:43:43.000Z",
  "status": "Completed",
  "channelOrderStatus": null,
  "cancelStatus": null,
  "currency": "GBP",
  "subTotal": 34.95,
  "total": 34.95,
  "notes": null,
  "url": "https://www.ebay.co.uk/sh/ord/details?orderid=06-14669-20984",
  "buyer": {
    "username": "[REDACTED]",
    "name": "[REDACTED]",
    "email": "[REDACTED]"
  },
  "shippingAddress": {
    "name": "[REDACTED]",
    "street": null,
    "city": "London",
    "state": "London",
    "postalCode": "Tw7 4ab",                    // ★ Tier-2 fallback key
    "country": "United Kingdom",
    "countryCode": "GB",
    "phone": "[REDACTED]"
  },
  "transactions": [                             // ★ LINE ITEMS — the gold
    {
      "id": 117531851,
      "sku": "BER-0116-Q03",                    // ★ ORIGINAL COMMERCIAL SKU (Q-code!)
      "quantity": 1,
      "price": 34.95,                           // unit price
      "currency": "GBP",
      "externalItemId": "354744739346",         // eBay listing ID
      "transactionId": "10081905922806",        // eBay transaction
      "orderLineItemId": "354744739346-10081905922806",
      "shippingStatus": "PendingShipment",
      "shippingDate": null,
      "trackingNumber": null,
      "carrier": null
    }
  ]
}
```

### Field coverage from the live probe

- `externalId`: **100% populated** on eBay orders, deterministic eBay order ID format.
- `transactions[].sku`: **100% populated**, contains the original listing SKU including Q-codes (e.g. `BER-0116-Q03`, `NGK-06726-Q02`).
- `transactions[].quantity`, `transactions[].price`: **100% populated**.
- `externalItemId` (eBay listing ID): **100% populated**.
- `shippingAddress.postalCode`: **100% populated**.
- **`fees`: NOT exposed** — channel fee rules will need to come from a separate `channel_fee_rules` table (already exists in DB, just empty).

---

## 2. Mintsoft API — confirmed via 200-order probe

Hit `GET /api/Order/List` across NEW, DESPATCHED, ONBACKORDER, AWAITINGPICKING.

### Marketplace reference fields — all 0% populated

Every candidate I tested returned 0 hits across 200 orders:
`ExternalReference`, `ExternalId`, `ExternalOrderReference`,
`ChannelOrderReference`, `ChannelOrderRef`, `OrderRef`, `MarketplaceOrderId`,
`MarketplaceReference`, etc.

### But `OrderNumber` does the job

eBay samples from probe (channel = `eBay - CPI`):

```
04-14672-27365-1381335
13-14658-17909-1381332
13-14658-19533-1381333
04-14672-27118-1381334
07-14667-48977-408735       (channel = eBay - 123 Autocare)
```

Amazon samples:
```
205-7690691-5773157
206-5806764-2611527
205-7385601-5423532
026-6054774-3125923
205-9726439-4237142
```

The eBay `OrderNumber` pattern is `{ebayOrderId}-{mintsoftLineSeq}` where the
trailing segment is a Mintsoft-internal sequence (4–7 digits). Strip it with
a single regex.

Amazon `OrderNumber` is the Amazon order ID verbatim, no transformation needed.

### What `order_lines` currently stores

We capture `mintsoft_order_id` and `channel_order_ref`, but **`OrderNumber`
is not stored** — sync-mintsoft-orders pulls it from the API but discards it.
First small change in Phase 4: persist `order_number` on the row.

---

## 3. Revised Phase 4 Build Plan

Build in this order:

### Step 1 — Persist Mintsoft `OrderNumber` (1 migration + 1 edge edit)
- Add `order_lines.order_number TEXT` + index.
- Update `sync-mintsoft-orders` to write `OrderNumber` from the API payload.
- Add `derive_marketplace_order_id(order_number, channel)` SQL function
  implementing the strip rule per channel.
- Tiny backfill job to populate `order_number` on existing rows from a
  one-shot re-fetch of just the OrderNumber field (cheap; one API call per
  Mintsoft order is wasteful, so use bulk `Order/List` paginated re-pulls
  scoped to 2026-01-01+).

### Step 2 — Create `marketplace_order_lines` (1 migration)
Schema:
- `id uuid PK`
- `channel text` (3DS `channel`)
- `seller_id bigint` (3DS sellerId)
- `marketplace_order_id text` (= 3DS `externalId`)
- `threeds_order_id bigint` (3DS internal `id`)
- `line_index int`
- `original_sku text` (3DS `transactions[].sku` — the commercial/Q-code SKU)
- `quantity int`
- `unit_price numeric`
- `currency text`
- `external_item_id text` (eBay listing ID)
- `order_line_item_id text` / `transaction_id text`
- `shipping_postcode text`
- `order_date timestamptz`, `created_at`, `updated_at`
- `raw_payload jsonb` (full transaction row, for forensics)
- `pulled_at timestamptz`
- `UNIQUE (channel, marketplace_order_id, line_index)`

Read-only ingest from 3DS — never touches `order_lines`.

### Step 3 — Create `marketplace_order_matches` (1 migration)
- `marketplace_order_id text + channel text` (unique together)
- `mintsoft_order_id bigint`
- `confidence text` enum: `exact_ordernumber`, `postcode_window`, `manual`
- `match_strategy text` (human description)
- `matched_at timestamptz`, `matched_by uuid` (null = automated)
- `notes text`

### Step 4 — Create `marketplace_order_match_exceptions` (1 migration)
- `marketplace_order_id text + channel text`
- `reason text` enum: `no_mintsoft_order`, `ambiguous_match`,
  `quantity_mismatch`, `sku_overlap_zero`
- `candidate_mintsoft_order_ids bigint[]`
- `details jsonb`
- `resolved_at`, `resolved_by`, `resolution text`

### Step 5 — Read-only 3DS pull/import edge function
`pull-threeds-orders` — for each scoped seller, pull orders since
last-run-cursor (or last 24h on first run), upsert into
`marketplace_order_lines`. No writes outside that table.

### Step 6 — Matching worker (`reconcile-marketplace-orders`)
- **Tier 1 (exact):** for each unmatched `marketplace_order_lines.marketplace_order_id`,
  look up `order_lines` where `derive_marketplace_order_id(order_number, channel)
  = marketplace_order_id`. Expect ~99% hit rate. Insert into `matches` with
  confidence `exact_ordernumber`.
- **Tier 2 (postcode + window):** if Tier 1 misses, search Mintsoft orders
  within ±48h of 3DS `orderDate`, matching `PostCode` (whitespace-normalised)
  and total within 1%. Confidence `postcode_window`.
- **Anything else:** insert into `marketplace_order_match_exceptions`.

### Step 7 — Admin review page `/admin/marketplace-matches`
- Tab 1: unresolved exceptions — table with reason, 3DS payload preview,
  candidate Mintsoft orders, manual-match action.
- Tab 2: recent matches by confidence tier (sanity check).
- Tab 3: match-rate metric per channel per day.

### Step 8 — Enrich `order_lines` (final, gated)
Only after match has `exact_ordernumber` confidence (or human-confirmed
manual), enrich the linked `order_lines` row(s):
- `original_sku` ← 3DS `transactions[].sku`
- `original_pack_qty` ← 3DS `transactions[].quantity`
- `original_unit_price` ← 3DS `transactions[].price`

We **never overwrite** `sku` (the fulfilled SKU from Mintsoft). The new
columns are additive. Source of truth stays: Mintsoft = operational,
3DS = commercial.

Line-level pairing within a multi-line order uses `external_item_id` (eBay
listing ID) matched against Mintsoft `OrderItems[].ListingId` / fallback to
position. This is the one place that needs care — written up in build step.

---

## 4. Open questions before I touch code

1. **Confirm Universal = `no1autoshop` (seller 567497)?** It's the only
   remaining UK GBP store and the URL says `theautostopshop` is actually
   "The Stop Shop", `123autocare` is "123 Autocare", `ascgroupltd` is "ASC",
   `carpartsintl` is "CPI". So `no1autoshop` must be Universal — but please
   confirm.
2. **Backfill horizon:** start matching from 2026-01-01 (operational
   retention cutoff) or only forward from build date? My recommendation:
   forward-only initially, then a one-shot backfill once Tier 1 hit-rate
   proves out.
3. **Cron cadence for `pull-threeds-orders`:** every 15 min (aligned with
   Mintsoft order sync) seems right — let me know if you want different.

Once 1–3 are answered I'll write the Step 1 migration + edge edit as the
first piece of code.
