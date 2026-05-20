
## Phase 2 — Admin UI for SKU Transformations

Pure admin/classification layer. Mintsoft sync, buy recs, PO creation, order processing, marketplace pushes, stock adjustments, and any auto-conversion all stay untouched.

---

## 1. New page: `/admin/sku-transformations`

File: `src/pages/admin/SkuTransformations.tsx`

Standard subpage header (per memory: `space-y-6` container, bold white h1, teal ghost back button). Wrapped in `AccessGate` requiring `super_user` OR `senior_user` (matches Phase 1 RLS).

Two tabs via shadcn `Tabs`:

- **SKU Logic** (default)
- **Rules**

Route added in `src/App.tsx` alongside other `/admin/*` routes.

---

## 2. Tab 1 — SKU Logic

Searchable, paginated table from `products_cache` left-joined to `sku_master` (by `sku`). Server-side search on `sku`, `name`, `brand`. Pagination 50/page.

Columns:

| Column | Source | Editable |
|---|---|---|
| SKU | `products_cache.sku` | no |
| Name | `products_cache.name` | no |
| Brand | `products_cache.brand` | no |
| SKU Type | `sku_master.sku_type` | yes (Select) |
| Base SKU | `sku_master.base_sku` | yes (autocomplete, BASE rows only; hidden if type=BASE) |
| Multiplier / Pack size | `sku_master.conversion_multiplier` or `procurement_pack_size` | yes (context-sensitive: pack_size for BASE, conversion_multiplier for PROCUREMENT_PACK, multiplier_qty echoed from rule for MULTIPLIER) |
| Supplier order SKU | `sku_master.supplier_order_sku` | yes |
| Internal alias | `sku_master.internal_alias_sku` | yes |
| Auto-convert | `sku_master.auto_convert_on_receipt` | yes (Switch, only meaningful for PROCUREMENT_PACK) |
| Allow marketplace | `sku_master.allow_marketplace_sale` | yes |
| Allow picking | `sku_master.allow_picking` | yes |
| Allow stock holding | `sku_master.allow_stock_holding` | yes |
| Notes | `sku_master.notes` | yes |

Edit UX: per-row "Edit" opens a side `Sheet` with all fields; "Save" upserts `sku_master`. Optimistic update via TanStack Query, toast on success/error. Validation trigger on `sku_master` (Phase 1) enforces type-flag consistency; surface its error message.

Type legend (always visible as a small `Card` above the table):

- **BASE** — warehouse truth (the real stock unit)
- **PROCUREMENT_PACK** — supplier ordering / receipt only, transient stock
- **MULTIPLIER** — sellable SKU that resolves to N × base
- **BUNDLE** — multiple different base SKUs sold together
- **ALT** — alias / legacy mapping to a base

Badges on each row use semantic tokens (no raw colors) — distinct variants per type.

---

## 3. Tab 2 — Rules

Two sections (sub-tabs or stacked cards): **Conversion Rules** and **Multiplier Rules**.

### Conversion Rules (`sku_conversion_rules`)
Table: procurement_sku → base_sku × conversion_multiplier, auto_convert_on_receipt, is_active, notes.

- "Add rule" button → Dialog with autocomplete on both SKU fields (procurement candidates = any SKU; base candidates = `sku_master.sku_type = BASE`), number input for multiplier, switches for auto-convert and active.
- Inline edit (Sheet) and delete (AlertDialog confirm).

### Multiplier Rules (`sku_multiplier_rules`)
Same UX, fields: multiplier_sku → base_sku × multiplier_qty, is_active, notes.

### Validation (client + DB)
- `conversion_multiplier > 0` and `multiplier_qty > 0` (zod + DB CHECK from Phase 1)
- `base_sku` must exist in `sku_master` with `sku_type='BASE'` (zod async check via supabase query)
- `source_sku !== base_sku` (zod refine)
- No duplicate **active** rule per source SKU (zod async check + DB partial unique index — see migration below)

---

## 4. Suggest Mappings tool

Button on the Rules tab → opens Dialog. Runs a client-side scan over `sku_master` rows looking for suffix patterns:

- `.100`, `.50`, `.25` etc. → suggest `PROCUREMENT_PACK` with multiplier from numeric suffix
- `-P100`, `-P50` → suggest `PROCUREMENT_PACK` with multiplier from number after `-P`
- `-M20`, `-M10` → suggest `MULTIPLIER` with multiplier_qty from number after `-M`
- `-Q02` → suggest `MULTIPLIER` (qty 2)

For each suggestion: show source SKU, inferred type, inferred base SKU (suffix stripped, must already exist in `sku_master`), multiplier, and a checkbox. Suggestions where the inferred base doesn't exist are shown disabled with reason "base SKU not found".

User ticks the ones they want, clicks "Create selected rules" → batched insert into the appropriate rule table. Never auto-applied; never inserts on page load.

---

## 5. Tiny supporting migration (additive only)

Two partial unique indexes to enforce "no duplicate active rule per source SKU":

```sql
CREATE UNIQUE INDEX IF NOT EXISTS sku_conversion_rules_active_unique
  ON public.sku_conversion_rules (procurement_sku)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS sku_multiplier_rules_active_unique
  ON public.sku_multiplier_rules (multiplier_sku)
  WHERE is_active = true;
```

No table or RLS changes — RLS from Phase 1 already restricts writes to super/senior.

---

## 6. Navigation & permissions (dual-sidebar rule)

Per the project's Dual Sidebar Sync rule, update all four:

1. **`src/components/AppSidebar.tsx`** — add "SKU Transformations" link under the Admin group, icon `Shuffle` or `Layers`.
2. **`src/components/RbacSidebar.tsx`** — same link, gated on area capability.
3. **`system_areas` table** — insert row `{ key: 'sku_transformations', label: 'SKU Transformations', parent: 'administration', route: '/admin/sku-transformations' }` (exact column names verified against existing rows during implementation).
4. **`role_area_permissions` table** — grant `admin` to `super_user`, `propose`/`read` to `senior_user`, `read` to relevant ops roles (mirroring `administration` siblings).
5. **`docs/NAVIGATION.md`** — add the new route.

Also add a tile/link on `src/pages/AdminIndex.tsx`.

---

## 7. Data access

New hook `src/hooks/useSkuTransformations.ts`:

- `useSkuMasterList({ search, page })` — joins via two queries (products_cache page + sku_master upsert-on-missing fallback for any rows still missing after Phase 1 backfill).
- `useUpdateSkuMaster(sku)` — upsert mutation.
- `useConversionRules()` / `useMultiplierRules()` + CRUD mutations.
- `useSuggestMappings()` — pure client function, no network beyond the existing list.

All queries scoped with `queryKey: ['sku-transformations', ...]` so invalidation is clean.

---

## 8. Out of scope (explicitly)

- No edits to `mintsoft-sync`, `poll-inventory`, `mintsoft-create-po`, `threeds-reprice-push`, `get_buy_recommendations`, order-line resolution, or any cron.
- No new edge functions.
- No SKU renaming.
- No suffix parsing in any operational code path.

---

## Files to create / edit

**Create**
- `src/pages/admin/SkuTransformations.tsx`
- `src/components/admin/sku-transformations/SkuLogicTab.tsx`
- `src/components/admin/sku-transformations/SkuEditSheet.tsx`
- `src/components/admin/sku-transformations/RulesTab.tsx`
- `src/components/admin/sku-transformations/ConversionRuleDialog.tsx`
- `src/components/admin/sku-transformations/MultiplierRuleDialog.tsx`
- `src/components/admin/sku-transformations/SuggestMappingsDialog.tsx`
- `src/components/admin/sku-transformations/SkuTypeBadge.tsx`
- `src/components/admin/sku-transformations/BaseSkuAutocomplete.tsx`
- `src/hooks/useSkuTransformations.ts`
- One migration (two partial unique indexes + system_areas + role_area_permissions seed rows)

**Edit**
- `src/App.tsx` (route)
- `src/components/AppSidebar.tsx` (link)
- `src/components/RbacSidebar.tsx` (link)
- `src/pages/AdminIndex.tsx` (tile)
- `docs/NAVIGATION.md`
- `mem://index.md` + new `mem://features/sku-transformations-admin` memory once shipped

---

## Acceptance

- Search any SKU, see/edit its `sku_master` row.
- Set any of the 5 types; flags update consistently (trigger enforces).
- Create a procurement rule (`FA1-756.521.100 → FA1-756.521 × 100`) and a multiplier rule (`FA1-756.521-M20 → FA1-756.521 × 20`).
- Validation blocks zero/negative multipliers, self-references, missing base, and duplicate active rules.
- Suggest Mappings surfaces candidates from suffixes; nothing is written until the admin ticks and confirms.
- Nothing in live ordering, sync, or marketplace pushes behaves differently.
