# Carriers — Royal Mail penalty reduction workflow

A new section under **Operations** that anchors the current £~800/wk Royal Mail penalty cost, ingests penalty notices and invoices as PDFs, turns each penalty into an actionable remeasure task for packers, and tracks reduction over time.

Built carrier-agnostic from day one (Royal Mail first, DPD/Evri/UPS later).

## Navigation

Four new sub-pages, all under `/operations/carriers/...`:

| Route | Page |
|---|---|
| `/operations/carriers` | Index tile grid |
| `/operations/carriers/documents` | Upload + library of invoices and penalty notices |
| `/operations/carriers/penalties` | Trend dashboard (weekly total, 4–6w avg, by reason, by SKU) |
| `/operations/carriers/remeasure` | Packer worklist |
| `/operations/carriers/settings` | Carriers, reason codes, packer assignments |

Sidebar entry "Carriers" added to the Operations group. `docs/NAVIGATION.md`, `system_areas`, `role_area_permissions`, `AppSidebar.tsx`, `RbacSidebar.tsx`, and `OperationsIndex.tsx` all updated together (per existing nav governance).

## Data model (migration)

```text
carriers                  id, name, slug, active
carrier_documents         id, carrier_id, doc_type (invoice|penalty_notice|claim|other),
                          document_date, period_start, period_end,
                          file_path, file_url, total_amount,
                          parse_status (pending|parsed|failed|manual),
                          parse_error, parsed_at, uploaded_by, created_at
carrier_penalties         id, document_id, carrier_id, tracking_number,
                          penalty_amount, reason_code, reason_text,
                          declared_format, actual_format,
                          penalty_date,
                          mintsoft_order_id (nullable, resolved later),
                          sku (nullable, resolved later),
                          resolution_status (unresolved|order_found|sku_found|
                                             remeasure_pending|remeasured|
                                             packer_issue|written_off),
                          resolved_at, notes, created_at
carrier_remeasure_tasks   id, penalty_id, sku, mintsoft_order_id,
                          assigned_to, status (todo|in_progress|done|escalated),
                          old_category, new_category,
                          old_dimensions jsonb, new_dimensions jsonb,
                          completed_at, completed_by, notes
```

Plus a tracking column added to `order_lines`:
- `tracking_number text`, indexed — populated going forward by `sync-mintsoft-orders`, looked up on demand for older orders.

Storage: new private bucket `carrier-documents` for the PDFs (RLS to authenticated, write to operations/admin roles).

RLS pattern: read for authenticated; write/update restricted via `has_area_capability('operations.carriers', ...)` with super_user/senior_user fallback (matches existing tables).

## Edge functions

1. **`parse-carrier-document`** — triggered on upload. Downloads the PDF, sends to Lovable AI (`google/gemini-2.5-flash` with vision via tool-calling for structured output) with a schema that returns: `total_amount`, `period_start/end`, and an array of penalty rows `{tracking_number, amount, reason_code, reason_text, declared_format, actual_format, date}`. Writes to `carrier_penalties`, sets `parse_status`. User can review/correct before they hit the worklist.
2. **`resolve-penalty-tracking`** — for each unresolved penalty: first try `order_lines.tracking_number` (fast local lookup); if miss, call Mintsoft order search by tracking number (single call per unknown — small volumes). Backfills `mintsoft_order_id` and `sku` (single-line orders auto-assign; multi-line marked for human pick).
3. **`sync-mintsoft-orders` update** — capture `TrackingNo`/`Consignment` from the Mintsoft order payload into the new `order_lines.tracking_number` column.

Lovable AI key is already present (`LOVABLE_API_KEY`), Mintsoft is already wired. **No new secrets needed.**

## UI — page by page

**Documents** (`/operations/carriers/documents`)
- Drag-drop upload (PDF), required fields: carrier, doc type, document date.
- Library table: date, carrier, type, total amount, # penalties extracted, parse status, file link. Filters by carrier/type/date.
- Row click → drawer with PDF preview, parsed line items, "Re-parse with AI" and "Edit manually" actions.

**Penalties dashboard** (`/operations/carriers/penalties`)
- Anchor cards: This week £, Last week £, 4-week avg £, 6-week avg £, week-over-week delta.
- Weekly bar chart (last 12 weeks), £ and count.
- Breakdown tables: by reason code, by top-offending SKUs, by declared vs actual format.
- "Estimated annualised cost" and "Reduction since baseline" once we have ≥4 weeks of data.

**Remeasure queue** (`/operations/carriers/remeasure`)
- One row per task: SKU, current Mintsoft category, current declared dims/weight, penalty count for that SKU, total £ impact, assigned packer, status.
- Grouped/sortable by SKU (so a single SKU with 5 penalties is one row of work).
- Actions: "Mark remeasured" (records new dims), "Already correct → packer issue" (flags for supervisor convo), "Escalate".
- Linked back to the underlying penalty rows.

**Settings** (`/operations/carriers/settings`)
- Carriers list (Royal Mail seeded).
- Reason code library (editable labels).
- Packer roster for assignment dropdowns.

## Style & layout

Standard subpage header pattern, full-width layout, Carbon/Graphite/Teal tokens, existing `Card`/`Table`/`Badge`/`Accordion` components — same conventions as Buy Recommendations and Order Telemetry. No new design patterns.

## Build order (one PR per phase, all in this plan)

1. **Schema + nav scaffolding** — migration (carriers, documents, penalties, remeasure_tasks, `order_lines.tracking_number`, storage bucket, RLS), nav entries, four empty page shells, `OperationsIndex` tile.
2. **Documents page + parse-carrier-document edge function** — upload, AI extract, library list, parsed-rows review drawer.
3. **Penalties dashboard** — anchor cards, weekly chart, breakdowns.
4. **Tracking capture + resolver + Remeasure queue** — extend `sync-mintsoft-orders` to grab tracking, build `resolve-penalty-tracking`, build worklist UI with completion actions.
5. **Settings page** — carriers, reason codes, packer roster.

## Out of scope (for now)

- Auto-pushing corrected dimensions back into Mintsoft (manual entry by packer in Mintsoft for v1; a "Push to Mintsoft" button is a v2 candidate).
- Other carriers beyond Royal Mail (schema supports them; we only seed Royal Mail).
- Automated dispute submission to Royal Mail.

## Memory updates after build

- Add `mem://features/carriers/overview` and `mem://data-model/carriers-schema`.
- Update Core memory: "Carriers section under Operations owns courier penalty reduction loop."
