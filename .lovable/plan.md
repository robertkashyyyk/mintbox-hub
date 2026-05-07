## What we're building

A new page **Decisions → 3D Reprice** where you pick a store (= channel), see every SKU recently sold on that channel with its profit/loss data, tick the ones to reprice, type new prices, then click **Push to 3D** to SFTP a `SKU,Price` CSV up to the droplet for 3D's scheduled import to pick up.

Per-channel — so the same SKU can be repriced differently on each store (or left alone on stores where it's healthy).

## Pieces

### 1. Database

`**threeds_stores**` — maps channel name → 3D store identity → SFTP filename.

```text
id | store_name              | mintsoft_channel        | sftp_filename            | enabled
---+-------------------------+-------------------------+--------------------------+--------
 1 | CPI                     | eBay - CPI              | reprice_cpi.csv          | true
 2 | ASC                     | eBay - ASC              | reprice_asc.csv          | true
 3 | Universal               | eBay - Universal        | reprice_universal.csv    | true
 4 | 123 Autocare            | eBay - 123 Autocare     | reprice_123autocare.csv  | true
 5 | The Stop Shop           | eBay - The Stop Shop    | reprice_stopshop.csv     | true
```

Seeded with the 5 eBay channels. Editable in admin if names change.

`**threeds_reprice_pushes**` — audit log: store_id, pushed_at, pushed_by, row_count, csv_preview, sftp_path, status, error.

### 2. Read API (RPC)

`get_threeds_reprice_candidates(p_channel text, p_days int default 90)` returns one row per SKU sold on that channel:

- sku, product_name
- units_sold, revenue, cost_total, fees_total, courier_total, profit, por_pct
- current_retail_price (from `products_cache`)
- current_stock, brand_name

Built off `order_line_economics` filtered by channel. You see everything; you decide what to reprice.

### 3. UI page `/decisions/threeds-reprice`

- Store picker (5 tabs / dropdown)
- Filter chips: "Loss-makers only" · "PoR < X%" · search
- Sortable table: SKU · Brand · Units · Revenue · Profit · PoR% · Current Price · **New Price** input · checkbox
- Footer: "X rows selected · Push to 3D" button
- Right side: recent pushes for this store (date, count, status)

### 4. Edge function `threeds-reprice-push`

Body: `{ store_id, rows: [{ sku, new_price }] }`

1. Validate store exists + is enabled
2. Build CSV: `SKU,Price\n` + rows
3. Connect via `npm:ssh2-sftp-client` using `THREEDS_SFTP_HOST/PORT/USER/PASSWORD`
4. PUT to `/uploads/{sftp_filename}` (overwrites — 3D picks up latest)
5. Log to `threeds_reprice_pushes`
6. Return `{ ok: true, row_count, sftp_path }`

verify_jwt = true, super_user / senior_user only.

### 5. Navigation

Add to `AppSidebar` + `RbacSidebar` under Decisions, plus `docs/NAVIGATION.md` and a `system_areas` row (`threeds_reprice`) with role permissions.

## Out of scope for v1

- No automation / cron — manual click only
- No SSH key auth — password from secrets
- No per-channel rules engine — pure manual cherry-pick
- Amazon / Manual Input channels — not pushed (only the 5 eBay stores)
- Droplet-side setup (creating `/home/mintsoft_export/uploads/`, `chmod`) — assumed done. I'll surface a clear error if the path is wrong.

## Open assumptions to confirm by clicking through

- SFTP target path: `uploads/{filename}` relative to `mintsoft_export` home. If 3D needs a different folder, edit `sftp_filename` to include path (e.g. `cpi/reprice.csv`).
- File overwritten each push (latest = canonical). If 3D needs append-only or timestamped names, easy switch.

## After approval

I'll build in this order: migrations → RPC → edge function → UI page → nav. Then we test with one store, one SKU, one row to confirm the file lands on the droplet.  
  
Please note path needs be something for 3D so i selected /reprice

&nbsp;