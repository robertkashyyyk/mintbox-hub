// Backfill historical orders from Mintsoft that the live-tail sync missed.
//
// Strategy: Mintsoft has NO date-range search; we must walk /api/Order/List per
// OrderStatusId, paginating from page 1 (most-recent first) until we cross the
// HISTORICAL_FLOOR. For each page, find any IDs we don't already have in
// order_lines and fetch their items. Resumes via ingest_run_state.
//
// Cursor encoding in last_status: "{statusId}:{pageNo}" or "DONE".
// Body (all optional): { max_pages_per_run?: 30, status_ids?: number[], reset?: true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const START = Date.now();
const MAX_MS = 50_000;
const timeOut = () => Date.now() - START > MAX_MS;

const HISTORICAL_FLOOR = new Date("2026-01-01T00:00:00Z");
const CURSOR_ID = "historical_orders_cursor";
const PAGE_SIZE = 100;

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}
function extractCourier(order: any): string | null {
  if (typeof order?.CourierService === "string" && order.CourierService) return order.CourierService;
  if (typeof order?.CourierServiceName === "string" && order.CourierServiceName) return order.CourierServiceName;
  if (order?.Courier && typeof order.Courier === "object" && order.Courier.Name) return order.Courier.Name;
  if (typeof order?.Courier === "string") return order.Courier;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const apiKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "MINTSOFT_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const maxPagesPerRun = Math.max(1, Math.min(80, Number(body.max_pages_per_run ?? 30)));

  const { data: settings } = await supabase
    .from("mintsoft_settings").select("base_url").limit(1).single();
  if (!settings?.base_url) {
    return new Response(JSON.stringify({ error: "Mintsoft settings missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (body.reset === true) {
    await supabase.from("ingest_run_state").upsert({
      id: CURSOR_ID, last_status: null,
      last_run_at: new Date().toISOString(), last_ok_at: null,
    });
    return new Response(JSON.stringify({ ok: true, reset: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve status IDs to walk. Prefer caller-supplied list; otherwise fetch
  // ALL active statuses from Mintsoft and walk them terminal-first (DESPATCHED
  // is the largest gap source).
  let statusIds: number[] = Array.isArray(body.status_ids) ? body.status_ids.map((n: any) => Number(n)).filter(Boolean) : [];
  const statusNames = new Map<number, string>();
  if (statusIds.length === 0) {
    try {
      const r = await fetch(`${settings.base_url}/api/Order/Statuses`, {
        headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
      });
      if (r.ok) {
        const arr = await r.json();
        const terminalNames = ["despatch", "complete", "cancel", "refund", "return"];
        const terminal: number[] = []; const nonTerminal: number[] = [];
        for (const s of arr ?? []) {
          if (!s?.ID) continue;
          if (s?.ExternalName) statusNames.set(s.ID, s.ExternalName);
          if (s.Active === false) continue;
          const name = (s.ExternalName || "").toLowerCase();
          if (terminalNames.some((t) => name.includes(t))) terminal.push(s.ID);
          else nonTerminal.push(s.ID);
        }
        // DESPATCHED first because that's where the gaps are
        statusIds = [...terminal, ...nonTerminal];
      }
    } catch (_e) { /* fall through */ }
  }
  if (statusIds.length === 0) {
    return new Response(JSON.stringify({ error: "No status IDs to walk (Mintsoft Statuses fetch failed)" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve cursor
  const { data: cursorRow } = await supabase
    .from("ingest_run_state").select("last_status").eq("id", CURSOR_ID).maybeSingle();

  let curStatusIdx = 0;
  let curPageNo = 1;
  if (cursorRow?.last_status && cursorRow.last_status !== "DONE") {
    const m = String(cursorRow.last_status).match(/^(\d+):(\d+)$/);
    if (m) {
      const sid = Number(m[1]);
      const idx = statusIds.indexOf(sid);
      if (idx >= 0) {
        curStatusIdx = idx;
        curPageNo = Math.max(1, Number(m[2]) || 1);
      }
    }
  }

  let processedPages = 0;
  let newOrders = 0;
  let newLines = 0;
  let totalApiOrders = 0;
  let belowFloorHits = 0;
  const errors: string[] = [];

  while (!timeOut() && processedPages < maxPagesPerRun && curStatusIdx < statusIds.length) {
    const statusId = statusIds[curStatusIdx];
    const url = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&Limit=${PAGE_SIZE}&PageNo=${curPageNo}`;
    let pageOrders: any[] = [];
    try {
      const r = await fetch(url, { headers: { "ms-apikey": apiKey, "Content-Type": "application/json" } });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        errors.push(`status ${statusId} p${curPageNo}: ${r.status} ${txt.slice(0, 80)}`);
        curStatusIdx++; curPageNo = 1; continue;
      }
      const json = await r.json();
      pageOrders = Array.isArray(json) ? json : (json?.Items ?? json?.Results ?? []);
    } catch (e) {
      errors.push(`status ${statusId} p${curPageNo}: ${(e as Error).message}`);
      curStatusIdx++; curPageNo = 1; continue;
    }

    processedPages++;
    totalApiOrders += pageOrders.length;

    if (pageOrders.length === 0) {
      // Status exhausted
      curStatusIdx++; curPageNo = 1; continue;
    }

    // Mintsoft returns most-recent first. If the OLDEST on this page is below
    // the floor, the next page will definitely be too — stop this status.
    const oldestOnPage = pageOrders.reduce((acc: Date | null, o: any) => {
      const d = new Date(o.OrderDate ?? o.CreatedDate ?? 0);
      if (isNaN(d.getTime())) return acc;
      return acc == null || d < acc ? d : acc;
    }, null as Date | null);
    const stopAfterPage = oldestOnPage != null && oldestOnPage < HISTORICAL_FLOOR;

    // Only consider orders at/after floor
    const inWindow = pageOrders.filter((o: any) => {
      const d = new Date(o.OrderDate ?? o.CreatedDate ?? 0);
      return !isNaN(d.getTime()) && d >= HISTORICAL_FLOOR;
    });

    if (inWindow.length > 0) {
      const orderIds = inWindow.map((o: any) => Number(o.ID ?? o.Id ?? o.OrderId ?? o.OrderID)).filter(Boolean);
      const { data: existing } = await supabase
        .from("order_lines").select("mintsoft_order_id").in("mintsoft_order_id", orderIds);
      const existingIds = new Set((existing ?? []).map((r: any) => r.mintsoft_order_id));
      const missing = inWindow.filter((o: any) => {
        const id = Number(o.ID ?? o.Id ?? o.OrderId ?? o.OrderID);
        return id && !existingIds.has(id);
      });

      for (const order of missing) {
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
          // Mintsoft fields: Channel: { Name }, CustomerName (single string), ExternalOrderReference
          const channel = (order.Channel && typeof order.Channel === "object" && order.Channel.Name)
            ? order.Channel.Name
            : (typeof order.Channel === "string" ? order.Channel : (order.OrderSourceName ?? order.OrderSource ?? null));
          const channelOrderRef = order.ExternalOrderReference ?? order.ChannelOrderRef ?? null;
          const customerName = order.CustomerName
            ?? ([order.FirstName, order.LastName].filter(Boolean).join(" ") || null);
          const orderStatus = order.OrderStatus ?? statusNames.get(statusId) ?? "DESPATCHED";
          const orderStatusId = Number(order.OrderStatusId ?? order.StatusId ?? statusId) || statusId;
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
              sku, qty, order_date: orderDate,
              channel, channel_order_ref: channelOrderRef,
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
            .from("order_lines").upsert(rows, { onConflict: "mintsoft_order_id,line_index", ignoreDuplicates: true });
          if (insErr) errors.push(`insert ${orderId}: ${insErr.message}`);
          else { newOrders++; newLines += rows.length; }
        } catch (e) {
          errors.push(`order ${orderId}: ${(e as Error).message}`);
        }
      }
    }

    // Advance pagination
    if (stopAfterPage || pageOrders.length < PAGE_SIZE || curPageNo >= 500) {
      if (stopAfterPage) belowFloorHits++;
      curStatusIdx++; curPageNo = 1;
    } else {
      curPageNo++;
    }
  }

  const done = curStatusIdx >= statusIds.length;
  const newCursor = done ? "DONE" : `${statusIds[curStatusIdx]}:${curPageNo}`;

  await supabase.from("ingest_run_state").upsert({
    id: CURSOR_ID,
    last_status: newCursor,
    last_run_at: new Date().toISOString(),
    last_ok_at: errors.length === 0 ? new Date().toISOString() : null,
  });

  await supabase.from("edge_function_runs").insert({
    function_name: "backfill-historical-orders",
    started_at: new Date(START).toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - START,
    status: done ? "succeeded" : (errors.length > 0 ? "partial" : "running"),
    message: `${newOrders} new orders, ${newLines} lines, ${processedPages} pages (${totalApiOrders} api), floor-hits=${belowFloorHits}, cursor=${newCursor}${errors.length ? `, ${errors.length} errors` : ""}`,
    details: { done, pages: processedPages, new_orders: newOrders, new_lines: newLines, api_orders: totalApiOrders, cursor: newCursor, errors: errors.slice(0, 10) },
  });

  return new Response(JSON.stringify({
    ok: true, done,
    processed_pages: processedPages,
    new_orders: newOrders, new_lines: newLines,
    api_orders_seen: totalApiOrders,
    floor_hits: belowFloorHits,
    cursor: newCursor,
    status_walked: statusIds[Math.min(curStatusIdx, statusIds.length - 1)],
    errors: errors.slice(0, 10),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
