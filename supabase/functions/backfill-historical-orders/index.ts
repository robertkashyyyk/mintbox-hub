// Backfill historical orders from Mintsoft that the live-tail sync misses
// (mostly already-DESPATCHED orders that aged out before the sync existed).
//
// Walks /api/Order/Search by created date window across ALL active statuses
// configured in mintsoft_status_cache, paginates with PageNumber, and inserts
// any missing order_lines rows. Resumes via ingest_run_state cursor
// "historical_orders_cursor" so it can be invoked repeatedly.
//
// Body: { from_date?: "2026-01-23", to_date?: "2026-05-01", page_size?: 100, max_pages_per_run?: 30 }
// Returns: { ok, processed_pages, new_orders, new_lines, cursor, done }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const START = Date.now();
const MAX_MS = 50_000;
const timeOut = () => Date.now() - START > MAX_MS;

const HISTORICAL_FLOOR_ISO = "2026-01-01T00:00:00Z";
const CURSOR_ID = "historical_orders_cursor";

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function extractCourier(order: any): string | null {
  if (typeof order?.CourierService === 'string' && order.CourierService) return order.CourierService;
  if (typeof order?.CourierServiceName === 'string' && order.CourierServiceName) return order.CourierServiceName;
  if (order?.Courier && typeof order.Courier === 'object' && order.Courier.Name) return order.Courier.Name;
  if (typeof order?.Courier === 'string') return order.Courier;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );
  const apiKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "MINTSOFT_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const pageSize = Math.max(50, Math.min(100, Number(body.page_size ?? 100)));
  const maxPagesPerRun = Math.max(1, Math.min(60, Number(body.max_pages_per_run ?? 30)));

  const { data: settings } = await supabase
    .from("mintsoft_settings")
    .select("base_url, dispatched_status_ids")
    .limit(1).single();
  if (!settings?.base_url) {
    return new Response(JSON.stringify({ error: "Mintsoft settings missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve cursor
  const { data: cursorRow } = await supabase
    .from("ingest_run_state")
    .select("last_status, updated_at")
    .eq("id", CURSOR_ID)
    .maybeSingle();

  // Cursor encodes "{from_date}|{page}". On first run it points to today walking BACK day-by-day.
  let cursorFrom: string;
  let cursorPage: number;
  if (body.from_date) {
    cursorFrom = String(body.from_date).slice(0, 10);
    cursorPage = Number(body.start_page ?? 1);
  } else if (cursorRow?.last_status?.includes("|")) {
    const [d, p] = cursorRow.last_status.split("|");
    cursorFrom = d;
    cursorPage = Math.max(1, Number(p) || 1);
  } else {
    // Fresh start: today
    cursorFrom = isoDate(new Date());
    cursorPage = 1;
  }

  const floor = body.to_date ? new Date(String(body.to_date)) : new Date(HISTORICAL_FLOOR_ISO);
  const floorIso = floor.toISOString();

  let processedPages = 0;
  let newOrders = 0;
  let newLines = 0;
  let totalApiOrders = 0;
  let dayDoneCount = 0;
  const errors: string[] = [];

  // Walk backwards day by day. For each day fetch pages until empty, then move to previous day.
  while (!timeOut() && processedPages < maxPagesPerRun) {
    const dayStart = `${cursorFrom}T00:00:00Z`;
    const dayEnd = `${cursorFrom}T23:59:59Z`;

    if (new Date(dayEnd) < new Date(floorIso)) {
      // Reached floor — stop entirely
      await supabase.from("ingest_run_state").upsert({
        id: CURSOR_ID,
        last_status: `DONE|${cursorFrom}`,
        last_run_at: new Date().toISOString(),
        last_ok_at: new Date().toISOString(),
      });
      return finish(supabase, true, processedPages, newOrders, newLines, totalApiOrders, `${cursorFrom}|done`, errors);
    }

    const url = `${settings.base_url}/api/Order/Search?CreatedDateStart=${encodeURIComponent(dayStart)}&CreatedDateEnd=${encodeURIComponent(dayEnd)}&PageNumber=${cursorPage}&PageSize=${pageSize}`;

    let pageOrders: any[] = [];
    try {
      const r = await fetch(url, { headers: { "ms-apikey": apiKey, "Content-Type": "application/json" } });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        errors.push(`${cursorFrom} p${cursorPage}: ${r.status} ${txt.slice(0, 100)}`);
        // On error, advance to previous day to avoid getting stuck
        cursorFrom = previousDay(cursorFrom);
        cursorPage = 1;
        dayDoneCount++;
        continue;
      }
      const json = await r.json();
      pageOrders = Array.isArray(json) ? json : (json?.Items ?? json?.Results ?? []);
    } catch (e) {
      errors.push(`${cursorFrom} p${cursorPage}: ${(e as Error).message}`);
      cursorFrom = previousDay(cursorFrom);
      cursorPage = 1;
      dayDoneCount++;
      continue;
    }

    processedPages++;
    totalApiOrders += pageOrders.length;

    // If empty, this day is done — move backwards
    if (pageOrders.length === 0) {
      cursorFrom = previousDay(cursorFrom);
      cursorPage = 1;
      dayDoneCount++;
      continue;
    }

    // Process each order: insert if not present, then fetch items if missing.
    const orderIds = pageOrders.map(o => Number(o.ID ?? o.Id ?? o.OrderId ?? o.OrderID)).filter(Boolean);

    // Find which IDs we already have lines for
    const { data: existing } = await supabase
      .from("order_lines")
      .select("mintsoft_order_id")
      .in("mintsoft_order_id", orderIds);
    const existingIds = new Set((existing ?? []).map((r: any) => r.mintsoft_order_id));
    const missingOrders = pageOrders.filter(o => {
      const id = Number(o.ID ?? o.Id ?? o.OrderId ?? o.OrderID);
      return id && !existingIds.has(id);
    });

    // For each missing order, fetch items and insert lines (sequential to avoid rate limit blow-up)
    for (const order of missingOrders) {
      if (timeOut()) break;
      const orderId = Number(order.ID ?? order.Id ?? order.OrderId ?? order.OrderID);
      const orderDate = order.OrderDate ?? order.CreatedDate ?? order.DateCreated;
      if (!orderDate) continue;

      try {
        const itemsResp = await fetch(`${settings.base_url}/api/Order/${orderId}/Items`, {
          headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
        });
        if (!itemsResp.ok) { errors.push(`items ${orderId}: ${itemsResp.status}`); continue; }
        const items: any[] = await itemsResp.json();
        if (!Array.isArray(items) || items.length === 0) continue;

        const courier = extractCourier(order);
        const channel = order.OrderSourceName ?? order.OrderSource ?? null;
        const channelOrderRef = order.ChannelOrderRef ?? order.ExternalOrderReference ?? null;
        const customerName = [order.FirstName, order.LastName].filter(Boolean).join(" ") || null;
        const orderStatus = order.OrderStatus ?? order.Status ?? "DESPATCHED";
        const orderStatusId = Number(order.OrderStatusId ?? order.StatusId) || null;
        const trackingNumber = order.TrackingNumber ?? order.Tracking ?? null;
        const warehouseId = order.WarehouseId ? String(order.WarehouseId) : null;

        const rows = items.map((item: any, idx: number) => {
          const sku = item?.SKU;
          if (!sku) return null;
          const unitPrice = num(item.Price) ?? num(item.UnitValue) ?? 0;
          const qty = Number(item.Quantity) || 0;
          const lineTotal = num(item.LineTotal) ?? num(item.LinePrice) ?? unitPrice * qty;
          return {
            mintsoft_order_id: orderId,
            line_index: idx,
            sku,
            qty,
            order_date: orderDate,
            channel,
            channel_order_ref: channelOrderRef,
            customer_name: customerName,
            product_name: item.ProductName ?? item.Name ?? null,
            order_status: orderStatus,
            order_status_id: orderStatusId,
            warehouse_id: warehouseId,
            unit_price: unitPrice,
            line_total: lineTotal,
            discount: num(item.Discount) ?? 0,
            currency: order.Currency ?? "GBP",
            courier_service: courier,
            tracking_number: trackingNumber,
            last_status_change_at: order.DespatchedDate ?? order.LastModified ?? orderDate,
          };
        }).filter(Boolean);

        if (rows.length === 0) continue;

        const { error: insErr } = await supabase
          .from("order_lines")
          .upsert(rows, { onConflict: "mintsoft_order_id,line_index", ignoreDuplicates: true });
        if (insErr) {
          errors.push(`insert ${orderId}: ${insErr.message}`);
        } else {
          newOrders++;
          newLines += rows.length;
        }
      } catch (e) {
        errors.push(`order ${orderId}: ${(e as Error).message}`);
      }
    }

    // Decide pagination
    if (pageOrders.length < pageSize) {
      // Last page for this day
      cursorFrom = previousDay(cursorFrom);
      cursorPage = 1;
      dayDoneCount++;
    } else {
      cursorPage++;
    }
  }

  // Persist cursor
  const newCursor = `${cursorFrom}|${cursorPage}`;
  await supabase.from("ingest_run_state").upsert({
    id: CURSOR_ID,
    last_status: newCursor,
    last_run_at: new Date().toISOString(),
    last_ok_at: errors.length === 0 ? new Date().toISOString() : null,
  });

  return finish(supabase, false, processedPages, newOrders, newLines, totalApiOrders, newCursor, errors);
});

function previousDay(d: string): string {
  const dt = new Date(`${d}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return isoDate(dt);
}

async function finish(supabase: any, done: boolean, pages: number, newOrders: number, newLines: number, apiOrders: number, cursor: string, errors: string[]) {
  await supabase.from("edge_function_runs").insert({
    function_name: "backfill-historical-orders",
    started_at: new Date(START).toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - START,
    status: done ? "succeeded" : (errors.length > 0 ? "partial" : "running"),
    message: `${newOrders} new orders, ${newLines} lines, ${pages} pages scanned (${apiOrders} api rows), cursor=${cursor}${errors.length ? `, ${errors.length} errors` : ""}`,
    details: { done, pages, new_orders: newOrders, new_lines: newLines, api_orders: apiOrders, cursor, errors: errors.slice(0, 10) },
  });
  return new Response(JSON.stringify({
    ok: true, done, processed_pages: pages, new_orders: newOrders, new_lines: newLines,
    api_orders_seen: apiOrders, cursor, errors: errors.slice(0, 10),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
