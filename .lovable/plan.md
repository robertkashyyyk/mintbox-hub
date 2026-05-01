## Goal

Replace the manual monthly despatch performance spreadsheet with an in-app **Active Report**, surfaced as a card inside Operations → Reports. Restructure that page into two tabs: **Scheduled** (today's content) and **Active** (interactive on-demand reports). Make the Despatch Performance card on the Operations Dashboard click through to it.

## What we have

- ~15k despatched lines from late Jan 2026 onward across 7 channels/accounts (Amazon, Amazon-IE, eBay - CPI, ASC, Universal, 123 Autocare, The Stop Shop). Channel is already populated on `order_lines`.
- Despatch time = `last_status_change_at - order_date` when `order_status='DESPATCHED'` (already used by the existing dashboard card).
- Existing `OpsReports` page only manages weekly email subscribers + send history.

## Plan

### 1. Restructure Operations → Reports into tabs

`src/pages/operations/OpsReports.tsx` gets a `<Tabs>` shell:

- **Scheduled** — current Subscribers + Send History cards, unchanged.
- **Active** — new grid of report cards. Phase 1 ships **one** card: "Despatch Performance". Layout leaves room for future cards (Backorder Ageing, Channel Mix, etc.).

Active tab card: title, one-line description, "Open Report →" button. Clicking opens the Despatch Performance report.

### 2. New report: Despatch Performance

Lives at `src/pages/operations/reports/DespatchPerformanceReport.tsx`, route `/operations/reports/despatch-performance`. Reached via:
- The Active tab card on `/operations/reports`.
- A click on the existing **Despatch Performance** card on `/operations/dashboard` (wrap it in a link, add a small "View report →" affordance).

#### Filter bar
- **Period preset**: This Week, Last Week, This Month, Last Month, This Quarter, Last Quarter, YTD, Custom range.
- **Bucket**: Day / Week / Month / Quarter (auto-default by period length, user override).
- **Channel filter**: multi-select chips of all distinct channels. Default = All.
- **Group by**: None (totals only) | Channel.

#### KPI strip
Four cards for the selected window: Total Despatched, % within 24h, % within 48h, % within 72h. Each shows a delta vs the previous equivalent period.

#### Distribution table (the heart of the report — matches the user's reference sheet)
Pivot rows = period bucket (and channel if grouped); columns mirror the reference:

```text
Period   | Channel    | Despatched | <6h | <12h | <24h | <36h | <48h | <72h | >72h | Median hrs | Mean hrs
2026-04  | Amazon     |    412     |  8% | 22%  | 78%  | 88%  | 92%  | 97%  |  3%  |   18.4     |  20.1
2026-04  | eBay - CPI |    560     |  6% | 19%  | 71%  | 84%  | 88%  | 95%  |  5%  |   22.1     |  24.6
2026-04  | TOTAL      |  1,820     |  7% | 21%  | 74%  | 86%  | 90%  | 96%  |  4%  |   20.3     |  22.4
```

Conditional colour on the % cells using the user's reference scale (Terrible / Poor / Unacceptable / Average / Good / Great) mapped to existing semantic tokens (`destructive`, `warning`, `success`, `pd-accent`). Sticky header.

#### Trend chart
Stacked bar per bucket: <24h / 24-48h / 48-72h / >72h. Toggle counts ↔ %. When grouped by channel, becomes one small-multiple chart per channel.

#### Export
"Download CSV" + "Download XLSX" buttons. Exports the breakdown table exactly as displayed (respects filters/grouping/channel). Filename pattern: `despatch-performance_{period}_{channel|all}_{generated-at}.csv`. This is the artifact that replaces the manual monthly report.

### 3. Data layer

Two new SECURITY DEFINER SQL functions on `order_lines` (no schema changes):

- `get_despatch_performance_buckets(from_date date, to_date date, bucket text, channels text[])` → rows of `{ bucket_start, channel, total, under_6h, under_12h, under_24h, under_36h, under_48h, under_72h, over_72h, median_hours, mean_hours }`. `bucket` ∈ `'day'|'week'|'month'|'quarter'`. NULL `channel` row = grand total per bucket. NULL `channels` arg = all.
- `get_despatch_channels()` → distinct channel values seen in `order_lines` since 2026-01-01, for the filter.

Both honour the Jan 1, 2026 retention boundary and use the same despatch definition as today's dashboard card so numbers reconcile.

### 4. Wiring

- New hook `src/hooks/useDespatchPerformance.ts` calling the new RPCs.
- Add route in `src/App.tsx`.
- Update `docs/NAVIGATION.md` (Reports stays the sidebar entry; the report is reached *through* it, not added to the sidebar).
- Existing OpsDashboard "Despatch Performance" card → wrap in click handler navigating to the new report; add a small "View history →" link in the card header.

## Out of scope (call out, not building)

- Carrier-level breakdown (carrier not on order line yet).
- Per-channel SLA targets — using universal 24/48/72 buckets for now.
- Auto-emailing the monthly despatch report — easy follow-on once the page exists; we'd register it as a second "scheduled" job alongside the weekly ops report.

## Notes

- Data starts ~23 Jan 2026 due to the retention cutoff. Periods before that show empty; UI will note this.
- Colour bands for the heatmap will be configurable constants in the component so we can tune them after first review.
