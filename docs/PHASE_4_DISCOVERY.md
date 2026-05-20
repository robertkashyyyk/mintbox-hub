# Phase 4 — 3D Sellers Reconciliation: Discovery

## Status

- **Live data sampling: BLOCKED.** `THREEDS_API_KEY` returns `401 Invalid token: access token has expired` on both REST (`api.3dsellers.com/v1/*`) and MCP `tools/call`. The MCP `tools/list` endpoint is unauthenticated and works, so we have the **schema** but not real payloads.
- All proposed shapes below are derived from the MCP tool descriptions + input schemas. They must be re-validated against a real `get-orders` response before any reconciliation writes ship.

## What 3D Sellers exposes (from MCP tool schemas)

Only one order-relevant tool exists today: **`get-orders`**.

```
get-orders(sellerId: int, externalId?, sku?, status?, channel?, page?, limit<=100)
  -> paginated results with buyer, shipping address, and line item details
```

Supporting tools we'll need:

- `get-sellers(channel?)` — enumerate seller IDs (we must iterate per seller; there is no global "all orders" endpoint).
- `get-seller(sellerId)` — seller metadata (channel, marketplace).
- `get-products` — listing-side product lookup (for `original_sku` → listing ID enrichment when missing on the order line).

### What we can rely on (per the schema)

| Required Phase 4 field | 3D Sellers source | Notes |
|---|---|---|
| marketplace / channel | `seller.channel` + likely `order.channel` | `get-orders` supports a `channel` filter, so the field exists on the order. |
| channel order reference | `order.externalId` | `get-orders` filters on `externalId` — this is the marketplace order ID (eBay, Shopify, etc.). **Primary join candidate.** |
| original ordered SKU | `lineItem.sku` | Tool supports `sku` filter; SKU is on the line. |
| listing ID / item ID | likely `lineItem.itemId` / `listingId` | Not in the input schema; needs payload confirmation. |
| quantity ordered | `lineItem.quantity` | Standard. Confirm field name. |
| sold price | `lineItem.price` or `lineItem.unitPrice` | Confirm. |
| fees | likely `order.fees[]` per channel | Not promised by schema — assume **optional, may be absent**. |
| order timestamp | `order.createdAt` / `order.orderDate` | Confirm exact field. |
| customer postcode | `order.shippingAddress.postcode` | Description explicitly says "shipping address" is returned. |
| Mintsoft order ref present? | **Unknown — assume NO.** | 3D Sellers is upstream of Mintsoft; the Mintsoft ID is assigned after fulfilment dispatch. Highly unlikely to appear in 3D Sellers payload. |

### What we don't have (and the gap it creates)

- **No reverse pointer to Mintsoft.** Mintsoft's `ExternalReference` field is our best chance — we need to confirm Mintsoft populates it with the 3D Sellers/marketplace order ID. (Live check pending — see "Next steps".)
- **No fee breakdown guaranteed.** Phase 5 profitability may have to derive fees from channel-specific rules, not 3D Sellers payload.
- **No global order feed.** We must loop sellers × pages. Build a paginated worker with cursor state.

## Proposed join strategy

```
Tier 1 (Ideal) — direct ID match
   3DS.order.externalId == Mintsoft.order.external_reference
   → confidence: "exact"

Tier 2 (Strong) — channel + ID + sanity
   3DS.channel == Mintsoft.channel
   AND 3DS.externalId == Mintsoft.channel_order_ref
   AND |3DS.orderDate - Mintsoft.order_date| <= 48h
   AND abs(3DS.total - Mintsoft.total) <= 0.01
   → confidence: "strong"

Tier 3 (Heuristic fallback) — postcode + value + time + sku set
   postcode match
   AND |orderDate diff| <= 72h
   AND |total diff| <= 1%
   AND at least one SKU overlaps (after MULTIPLIER unroll)
   → confidence: "heuristic"  (requires manual review before commit)

Tier 4 (Exception) — none of the above
   → write to marketplace_order_match_exceptions for admin review
```

We **never** overwrite `order_lines.sku` (warehouse truth). We only enrich:

- `original_sku` — from 3DS line
- `original_pack_qty` — derived via `sku_multiplier_rules` lookup of `original_sku`
- `relationship_type` — same source
- `marketplace_listing_id` — from 3DS line

## Proposed schema (draft, pending live payload)

```sql
-- Raw 3DS pulls, one row per 3DS order line. Source of truth, immutable.
marketplace_order_lines (
  id uuid pk,
  seller_id int,
  channel text,                    -- ebay, shopify, ...
  channel_order_ref text,          -- 3DS externalId
  order_date timestamptz,
  buyer_postcode text,
  order_total numeric,
  line_index int,
  original_sku text,               -- as listed on marketplace
  marketplace_listing_id text,     -- itemId / listingId
  qty int,
  unit_price numeric,
  fees jsonb,                      -- channel-dependent, may be null
  raw_payload jsonb,               -- full line for forensic use
  pulled_at timestamptz default now(),
  UNIQUE (channel, channel_order_ref, line_index)
);

-- One row per attempted match. Successful matches drive the order_lines enrichment.
marketplace_order_matches (
  id uuid pk,
  marketplace_line_id uuid references marketplace_order_lines,
  order_line_id uuid references order_lines, -- nullable until matched
  confidence text check (confidence in ('exact','strong','heuristic','manual')),
  match_strategy text,             -- 'externalId', 'composite', 'heuristic', ...
  matched_at timestamptz,
  matched_by uuid,                 -- null for system, user_id for manual
  notes text
);

-- Unmatched / ambiguous, for admin review.
marketplace_order_match_exceptions (
  id uuid pk,
  marketplace_line_id uuid references marketplace_order_lines,
  reason text,                     -- 'no_candidate','multiple_candidates','total_mismatch',...
  candidate_order_ids uuid[],      -- order_lines.id options for ambiguous cases
  created_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text                  -- 'matched','ignored','duplicate',...
);
```

`order_lines` additions (already noted in plan, deferred until Phase 4 build):

```sql
ALTER TABLE order_lines
  ADD COLUMN original_sku text,
  ADD COLUMN original_pack_qty int,
  ADD COLUMN relationship_type text,
  ADD COLUMN marketplace_listing_id text,
  ADD COLUMN marketplace_match_confidence text;
```

## Admin review surface

`/admin/marketplace-reconciliation` (super_user, senior_user):

- **Exceptions queue** — filter by reason, channel, age. Each row shows the 3DS line + candidate Mintsoft orders side-by-side; one-click "Match" / "Ignore as duplicate" / "Mark as no-Mintsoft (direct-to-customer)".
- **Recent matches** — sortable table with confidence column; allow "unmatch" to revert.
- **Coverage stats** — per channel: % of Mintsoft orders enriched with `original_sku`, % of 3DS lines matched, rolling 7/30 day.

## Next steps (need from you)

1. **Refresh `THREEDS_API_KEY`.** Without a live token I can't sample a real `get-orders` payload, and the schema above will be partly speculative.
2. **Confirm Mintsoft's `ExternalReference` behaviour.** Quick check: do orders synced from eBay/Shopify carry the marketplace order ID in `external_reference`? (I can probe `mintsoft-sync`'s last 200 orders once you give the go-ahead.)
3. **Confirm which sellers are in scope.** All sellers, or a specific list? Drives how aggressive the initial backfill is.

Once the token is refreshed I'll:

- Pull 5 real orders per active seller and attach the redacted payload to this doc
- Lock the `marketplace_order_lines` column list to actual field names
- Then propose the migration + the discovery edge function (`threeds-pull-orders`) before building the reconciliation worker
