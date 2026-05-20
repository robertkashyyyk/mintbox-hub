## Goal

Introduce a true multi-layer SKU model in PartsDocHub so Mintsoft stays the execution layer while PartsDocHub owns inventory intelligence. The single rule:

> **Procurement packs are transient. Base SKUs are warehouse truth. Multiplier SKUs are commercial transforms.**

No SKU suffix (`-P100`, `-M20`, `.100`) will be parsed as logic — every relationship lives in explicit rule tables.

---

## Phased rollout

To avoid breaking live POs, Mintsoft sync and Buy Recs, this ships in four phases.

### Phase 1 — Foundation (schema + classification, no behaviour change)

1. Create enum `sku_type` with values `BASE`, `PROCUREMENT_PACK`, `MULTIPLIER`, `BUNDLE`, `ALT`.
2. New table `sku_master` (one row per SKU, joins to `products_cache` by `sku`):
  - `sku_type` (default `BASE`)
  - `base_sku` (nullable; FK-style by text)
  - `is_base_sku`, `is_procurement_pack`, `is_multiplier_sku`, `is_bundle` (booleans, derived from `sku_type`)
  - `allow_marketplace_sale` (default true for BASE/MULTIPLIER, false for PROCUREMENT)
  - `allow_picking` (default true for BASE/MULTIPLIER, false for PROCUREMENT)
  - `allow_stock_holding` (default true for BASE, false for MULTIPLIER, transient for PROCUREMENT)
  - `auto_convert_on_receipt` (default true for PROCUREMENT)
  - `conversion_multiplier` (PROCUREMENT only)
  - `procurement_pack_size` (BASE only — pack qty for buy recs)
  - `notes`, timestamps
3. Backfill: every existing `products_cache.sku` gets a `sku_master` row of type `BASE`.
4. Two rule tables:
  - `sku_conversion_rules` — procurement → base (`procurement_sku`, `base_sku`, `conversion_multiplier`, `auto_convert_on_receipt`, `is_active`, notes)
  - `sku_multiplier_rules` — multiplier → base (`multiplier_sku`, `base_sku`, `multiplier_qty`, `is_active`, notes)
5. Log table `sku_conversion_logs` (rule_id, procurement_sku, base_sku, procurement_qty, base_qty_created, mintsoft_reference, status `pending/success/failed/manual`, error_message, created_at, created_by).
6. RLS: read for authenticated, write restricted to `super_user` / `senior_user` (mirrors existing pattern).

**Outcome of Phase 1**: data model exists, nothing else changes — safe to ship.

### Phase 2 — Admin UI (classify SKUs)

New page `**/admin/sku-transformations**` with two tabs:

1. **SKU Logic** — searchable list of products_cache joined to sku_master. Editable per row:
  - SKU Type dropdown
  - Base SKU lookup (autocomplete from BASE rows)
  - Multiplier qty / Pack size (context-sensitive)
  - Toggles: Auto Convert, Allow Marketplace, Allow Picking, Allow Stock Holding
2. **Rules** — manage `sku_conversion_rules` and `sku_multiplier_rules` directly, with validation:
  - Procurement rule requires multiplier > 0 and a BASE row
  - Multiplier rule requires multiplier_qty > 0 and a BASE row
  - No duplicate active rules per source SKU

Bulk action: "Suggest mappings from suffix patterns" — shows candidate rules to the user from suffixes like `-P100` / `-M20`, but **never auto-applies** (per the no-hard-coding rule).

Add to `AppSidebar`, `RbacSidebar`, `system_areas`, and `role_area_permissions` (admin area) per the dual-sidebar rule.

### Phase 3 — Conversion engine (the operationally critical bit)

1. **Edge function `sku-auto-convert**` (cron, every 15 min, `verify_jwt = false`):
  - Find SKUs of type `PROCUREMENT_PACK` with `auto_convert_on_receipt = true` and Mintsoft `current_stock > 0`.
  - For each, look up active conversion rule.
  - Pre-flight safeguards: rule exists, qty > 0, base SKU exists in Mintsoft, no in-flight conversion for the same procurement SKU+stock snapshot.
  - Call Mintsoft stock adjustment API twice:
    - `-procurement_qty` on procurement SKU
    - `+procurement_qty * multiplier` on base SKU
    - Adjustment reason: `PROCUREMENT_PACK_AUTO_CONVERSION` + log row id
  - Insert `sku_conversion_logs` row (status `success` or `failed`).
  - On failure: mark log `failed`, leave stock untouched, surface in Conversion Dashboard.
2. **Idempotency**: a partial unique index on `sku_conversion_logs(procurement_sku, mintsoft_reference)` for `status = 'success'` prevents double conversion.
3. **Manual retry / override** endpoint for super_users (called from dashboard).
4. **Buy Recommendation update** (`get_buy_recommendations`):
  - Calculate required base units as today.
  - If the BASE row has a `procurement_pack_size > 1` and an active procurement rule exists, output the procurement SKU + pack count (`ceil(required / pack_size)`), rather than the base SKU.
  - PO CSV / `mintsoft-create-po` send the procurement SKU so Mintsoft GRNs it correctly.

### Phase 4 — Selling resolution + dashboard

1. **Selling resolution**: when order_lines arrive from Mintsoft, if `sku` matches a row in `sku_multiplier_rules`, store `resolved_base_sku` and `resolved_base_qty = qty * multiplier_qty` on the order line (additive columns, doesn't break existing reports). Forecasting / velocity / stock health views switch to `resolved_base_sku` where present.
2. **Marketplace guard**: any push to channels (Threeds reprice, future channel pushes) checks `allow_marketplace_sale` before sending the SKU.
3. **Dashboard `/intelligence/sku-transformations**`:
  - Active procurement SKUs (count + table)
  - Active multiplier SKUs (count + table)
  - Per row: pack size, base mapping, current Mintsoft procurement stock, current base stock, last conversion at, last error
  - Failed conversions panel with "Retry" and "Mark resolved"
  - Manual convert button (super_user only)
  - Enable/disable toggle per rule

---

## Technical details

```text
products_cache.sku   ──┐
                       ▼
                 sku_master (sku PK)
                 ├─ sku_type
                 ├─ base_sku ────► points to sku_master.sku where sku_type = BASE
                 ├─ flags…
                 ▼
       ┌───────────────────────┐
       │ sku_conversion_rules  │   procurement → base + multiplier
       │ sku_multiplier_rules  │   sellable → base + qty
       └───────────────────────┘
                 │
                 ▼
          sku_conversion_logs   (audit trail of every adjustment)
```

**Mintsoft adjustment API**: the existing `mintsoft-create-po` uses `PUT /api/ASN`. For stock conversion we'll use `POST /api/Stock/Adjust` (or `/StockMovement` — to be confirmed against the live Mintsoft API during Phase 3 spike) with reason `PROCUREMENT_PACK_AUTO_CONVERSION`.

**Safeguards encoded as constraints + function checks**:

- `sku_conversion_rules.conversion_multiplier > 0` (CHECK)
- `sku_multiplier_rules.multiplier_qty > 0` (CHECK)
- Conversion log uniqueness on (`procurement_sku`, `mintsoft_reference`) where `status = 'success'`
- Validation trigger (not CHECK, per project rule) on `sku_master` to ensure type-flag consistency

**Defaults for new BASE rows**: `allow_marketplace_sale=true`, `allow_picking=true`, `allow_stock_holding=true`. PROCUREMENT defaults flip the first three to false.

**Will not change in Phase 1–3**: live `mintsoft-sync`, `poll-inventory`, `mintsoft-create-po` payloads, Threeds — they keep working on raw SKUs until the corresponding phase flips them over.

---

## Open questions before Phase 3

1. **Mintsoft stock-adjust endpoint** — confirm exact endpoint/payload for atomic two-sided adjustments (Mintsoft sometimes splits into two calls). Will spike at Phase 3 kickoff.
2. **Existing B-suffix bundles** — keep current `-BXX` import-rule exclusions, or fold them into `sku_type = BUNDLE` immediately? Recommendation: leave the import rule alone in Phase 1, migrate in Phase 4.
3. **Marketplace channels** — confirm which active pushes need the `allow_marketplace_sale` guard (Threeds is the only one I see; eBay is read-only price-hunter).

Happy to start with **Phase 1 (schema + backfill + RLS)** on approval; that's pure additive and safe to ship before the UI work.  
  
Amendments   
  


This direction looks good — please proceed with Phase 1, with the clarifications below.

Approved Direction

The overall architecture is correct:

Procurement packs are transient.  
Base SKUs are warehouse truth.  
Multiplier SKUs are commercial transforms.

Please proceed with the phased implementation, starting with Phase 1: schema + classification only, with no behaviour changes to live Mintsoft sync, buy recommendations, PO creation, marketplace pushes, or order processing yet.

Important Clarification: Procurement SKU Naming

Please do not force procurement SKUs into a renamed internal format such as:

FA1-756.521-P100

In many cases, the supplier’s actual orderable part number must remain exactly as the supplier provides it.

Example:

FA1-756.521.100

This may be the real supplier code that must go onto the PO.

If we alter it, we risk breaking supplier ordering unless we add an additional alias/mapping layer.

So for now:

procurement_sku must support the supplier’s actual orderable SKU exactly as supplied.

Do not assume we can rename it.

If we later want a cleaner internal alias such as FA1-756.521-P100, that should be optional and mapped separately.

The conversion rule should define the relationship, not the SKU format.

Example:

procurement_sku: FA1-756.521.100  
base_sku: FA1-756.521  
conversion_multiplier: 100

Add Optional Alias Support

Please add, or allow for, an optional field such as:

internal_alias_sku  
supplier_order_sku

or similar.

The key point is:

supplier_order_sku = the code we send to supplier / Mintsoft PO

internal_alias_sku = optional cleaner internal label, if we ever want one

base_sku = the true stock unit

But the system must work without requiring an alias.

Returns

No need to solve returns in this phase.

For now, the expected principle is:

If a multiplier SKU is sold, returns should ultimately return to base stock.

Example:

FA1-756.521-M20

means:

20 × FA1-756.521

So a return of 1 × M20 would ultimately become:

+20 × FA1-756.521

However, this can be handled later when we deal with selling resolution and returns logic. Please do not build returns logic into Phase 1.

Phase 1 Scope

Please implement only the additive foundation:

sku_type enum

sku_master

sku_conversion_rules

sku_multiplier_rules

sku_conversion_logs

Backfill existing SKUs as BASE

RLS matching existing senior/super user patterns

No operational behaviour change yet

Boolean Flags

Where possible, avoid storing too many boolean fields that can drift away from sku_type.

If the project needs them for UI/filtering, that is fine, but ideally:

sku_type = PROCUREMENT_PACK

should be the source of truth, and things like:

is_procurement_pack  
is_multiplier_sku  
is_base_sku

should be derived where practical.

Please use validation triggers if stored flags are necessary.

Critical Principle

Do not parse suffixes as logic.

Suffixes can suggest mappings for admin review, but they must never create active logic automatically.

So:

.100  
-P100  
-M20

can be suggested patterns only.

The actual behaviour must always come from explicit database rules.

Please Start

Please proceed with Phase 1 only.

Do not yet alter:

live Mintsoft sync

buy recommendations

PO creation

marketplace stock pushes

order line resolution

stock conversion automation

Once Phase 1 is complete, we can review the schema and then move into the Admin UI phase.