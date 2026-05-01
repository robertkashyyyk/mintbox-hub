## Goal

Turn `/intelligence/missing-costs` (and the matching `/housekeeping` entry) into a working table you can actually drive: filter, sort, paginate, and **edit cost prices inline with one click to push back to Mintsoft**.

---

## Part 1 — Filterable / sortable table

Rework `src/pages/intelligence/MissingCosts.tsx` to match the new Profit Dashboard table style.

**Filters (top bar):**
- Free-text search (SKU, name, supplier)
- Brand dropdown (loaded from `brands` table)
- Stock state: All / In stock only / Out of stock only / Stock > 0
- Sold recently: All / Sold last 28 days / Sold last 7 days (joins `order_line_economics.missing_cost`)
- Page size selector: 25 / 50 / 100 / 250 / 500

**Sortable columns** (click header, asc/desc indicator — same `SortableHead` pattern used on the Profit Dashboard):
- SKU · Name · Brand · Suppliers · Current stock · Units sold (28d) · Last sold

**Defaults:** sorted by Units sold (28d) DESC so the "biggest profit holes" float to the top. Pagination at 100/page.

**Data:** drop the 500-row cap. Fetch in pages from `products_cache` (`cost_price IS NULL`, `discontinued = false`, `quarantined = false`) and left-join a small aggregate of recent sold-units per SKU from `order_line_economics` (last 28 days). Reuse the paged-fetch helper that exists in `ProfitDashboard.tsx`.

**Banner kept** at the top — unchanged "X SKUs sold in last 28 days have no cost".

---

## Part 2 — Inline cost editing → push to Mintsoft

**Row UI:**
- New "Cost £" column with an inline number input (right-aligned, 2dp).
- "Save" button next to it. Disabled until the value is valid (> 0, ≤ 100,000).
- After save: row turns green, then disappears from the list on the next refetch (because `cost_price` is no longer NULL).
- Bulk variant: tick rows → "Save selected" applies the entered values in one batch.

**Backend flow — new edge function `update-product-cost`:**

1. Auth: must have `senior_user` or `super_user` role (matches the `products_cache` write policy and the cost data sensitivity).
2. Input (Zod): `[{ mintsoft_product_id: number, sku: string, cost_price: number }]` — capped at 50 per call.
3. For each item:
   - Call Mintsoft `POST /api/Product` with the existing product payload merged with `CostPrice: <new value>`. (We must GET the product first to avoid wiping other fields — Mintsoft's update is a full-object PUT-style call.)
   - On success, update `products_cache` row: `cost_price = <new>`, `cost_price_updated_at = now()`, `cost_price_source = 'manual_ui'`.
4. Return per-row `{ sku, ok, error? }` so the UI can show partial success.
5. Log to `edge_function_runs` with success/failure counts.

**Schema additions (small migration):**
- `products_cache.cost_price_updated_at timestamptz`
- `products_cache.cost_price_source text` (values: `mintsoft_sync`, `csv_import`, `manual_ui`)

These let us see in the UI when a cost was last touched and where it came from, and stop the next Mintsoft enrichment cron from blindly overwriting a manual edit (the enrich function will skip rows where `cost_price_source = 'manual_ui'` and the Mintsoft value is null/zero).

---

## Part 3 — Wiring & polish

- Add the new edge function to the project (no `verify_jwt` override needed — default is fine).
- Toast feedback: "Updated 3 SKUs in Mintsoft · 1 failed (see row)".
- Keep the page reachable from both `/intelligence/missing-costs` and `/housekeeping` (already linked, no nav changes).
- Memory: add `mem://features/missing-costs-editor` documenting the inline-edit + Mintsoft push-back, and the `cost_price_source` guardrail.

---

## What this does NOT do (out of scope, ask if you want it)

- Editing Sale Price / RRP (would use `PUT /api/Product/ProductPrices` — easy follow-up)
- Bulk CSV upload of cost prices (separate page if needed)
- History/audit log of cost changes (we'll have `cost_price_updated_at` but not a full trail unless you want a `cost_price_history` table)

---

## Files touched

- `src/pages/intelligence/MissingCosts.tsx` — rewritten
- `supabase/functions/update-product-cost/index.ts` — new
- `supabase/functions/mintsoft-enrich-batch/index.ts` — small guard against overwriting manual edits
- One migration: 2 new columns on `products_cache`
- `mem://features/missing-costs-editor` — new memory file + index update
