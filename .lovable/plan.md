## What the spreadsheet actually does

Each `Week NN` tab has 21 columns. **A–H come from Mintsoft**, **I–U are formulas** you paste in. Decoded:

| Col | Meaning | Logic |
|---|---|---|
| A–H | Order Id, Date, Channel, Courier Service, SKU, Price, Qty, Cost | from Mintsoft export |
| I | Courier Cost | VLOOKUP service → `Courier Costs` table, divided across multi-line orders |
| J | Channel Fee | Amazon: `price × 1.2 × 15% × qty`; else: `0.36 + (price × 1.2 × 12% × qty)` |
| K | Profit | `(price − cost) × qty − courier − fee` |
| L | POR % | `profit / (price × qty × 1.2)`; "Sale Items" excluded |
| M | Profit Status | Loss / Breakeven / Poor / Average / Good / Great / Amazing (bands at 0/5/10/20/25/30%) |
| N | Good/Dirt | `Good` if 4th char of SKU is `-` or `/`, else `Dirt` |
| O | Order Value | `price × qty` |
| P | Profit per piece | `profit / qty` |
| Q | Price Increase? | `Yes` if POR < 10% |
| R | Suggested New Price | rounded formula based on status |
| S | Note | "Multi-Pack Possible" warning if qty>1 |
| T | Brand | first 4 chars of SKU |
| U | Single-unit order flag | |

Plus supporting sheets:
- **Overview** – per-week totals (Revenue, Qty, Couriers, Fees, Profit, Missing-Cost ratio, Good/Dirt %, AOV, AIP, APPP, APPO)
- **Missing Costs** – unique SKUs from latest week with cost = 0
- **Remaining Dirt** – Dirt SKUs from latest week
- **Sale Items** – SKUs to exclude from POR scoring
- **Courier Costs** – service → cost lookup (rates you maintain)

---

## The plan: one module, four surfaces

### 1. New core feature — **Profit Intelligence** (under Intelligence)

**Data model**
- `courier_rates` table — `courier`, `service` (unique), `cost`, `effective_from`. Seed from your `Courier Costs` sheet (~17 active services).
- `channel_fee_rules` table — `channel_pattern` (e.g. `Ama%`), `vat_rate`, `fee_pct`, `fixed_fee`, `priority`. Seed two rules matching your formula.
- `sale_items` table — list of SKUs excluded from POR scoring (your current `Sale Items` sheet).
- `order_line_economics` view — joins `order_lines` + `products_cache` (for cost) + `courier_rates` + `channel_fee_rules` and computes courier cost (with multi-line split), channel fee, profit, POR %, profit status, Good/Dirt, profit-per-piece, suggested price — exactly as your sheet does.

**Pages**
- `/intelligence/profit` — week selector (default = current ISO week), KPI cards mirroring the **Overview** sheet (Revenue, Qty, Profit, Couriers, Fees, AOV, APPP, APPO, Good/Dirt %, Missing-Cost ratio), profit-status distribution, channel breakdown.
- `/intelligence/profit/lines` — full line-level table (the Week 17 view) with filters: week, channel, brand, profit status, Good/Dirt, "Price Increase?", "Has cost". Inline columns include Suggested New Price + Multi-Pack warning. CSV/XLSX export that mirrors your current paste-in format so you can keep the spreadsheet running in parallel until you trust the new view.
- `/intelligence/profit/history` — sparkline trend of every Overview metric, week-over-week, with quarter/YTD totals.

### 2. Surface the by-products the spreadsheet was inventing

These are *the same query* with different filters — no new pipelines:

- **Missing Costs** → fill the existing placeholder. Lists SKUs with cost = 0 that *actually sold* in the chosen window, ranked by units sold and revenue at risk. Click-through to product detail to fill cost. Replaces the `Missing Costs` tab.
- **Dirt SKUs** → fill the existing placeholder. Lists SKUs whose 4th char isn't `-` or `/` and that sold in the window. Adds a "Quarantine / Map to clean SKU / Ignore" action. Replaces the `Remaining Dirt` tab.
- **Pricing — Needs Increase** → feeds the existing Price Hunter / pricing area. Lists every line where POR < 10% (or Loss/Breakeven), grouped by SKU with units sold, current price, suggested price, expected POR after change. This is the "where we are too cheap" question, but answered from *real sold orders* instead of just eBay scrapes.

### 3. Cron + automation

- Weekly cron at Monday 06:00 UTC: snapshot the previous ISO week's Overview metrics into a `profit_weekly_snapshots` table so history is durable even if `order_lines` rolls or order data is corrected later.
- The `Sale Items` and `Courier Costs` tables become editable admin screens (Settings → Profit Rules) so you stop hand-editing the workbook.

### 4. What stays manual (for now)

Your spreadsheet currently has channel fees as a single hardcoded rule per channel. We'll seed the same rule, but the new `channel_fee_rules` table lets us add Amazon-IE / specific eBay accounts later without touching code.

---

## Build order (suggested — each step is independently shippable)

1. **Migration**: `courier_rates`, `channel_fee_rules`, `sale_items`, `profit_weekly_snapshots` + seed data from the workbook.
2. **`order_line_economics` view** + a `get_profit_week(week_start, week_end)` RPC.
3. **`/intelligence/profit`** dashboard + line-level table + XLSX export matching the current sheet layout.
4. **Wire Missing Costs / Dirt SKUs / Pricing Needs Increase** placeholders to the same view (small UI work, no new data).
5. **Weekly snapshot cron** + `/intelligence/profit/history`.
6. **Settings → Profit Rules** screens for courier rates, channel fees, sale items.

---

## Open questions before I build

1. **Channel fees** — your formula treats anything starting with `Ama` as 15% Amazon and everything else as eBay's `0.36 + 12%`. Keep that exact rule, or do you want to split eBay accounts / add Amazon-IE separately at the same time?
2. **Sale Items** — currently 10 SKUs. OK to migrate them as-is and let you maintain via a small admin screen?
3. **History** — do you want me to backfill Weeks 1–17 from the spreadsheet's Overview tab into `profit_weekly_snapshots` so the history view is populated from day one? (I can ingest your XLSX values directly.)
4. **Cost source** — should "cost price" come from `products_cache.cost_price` only, or do you want a fallback to the Mintsoft API value at sync-time when cache is empty?

Once you've answered those (or said "your call"), I'll start with step 1.