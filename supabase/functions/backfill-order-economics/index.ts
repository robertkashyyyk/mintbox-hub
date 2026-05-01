// Backfills unit_price, line_total, discount, currency, courier_service on
// existing order_lines by re-fetching items + headers from Mintsoft.
// Designed to be invoked repeatedly (each run processes ONE chunk and
// returns next_offset). 50s budget per call.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const START = Date.now();
const MAX_MS = 50_000;
const timeOut = () => Date.now() - START > MAX_MS;

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
  const weeksBack = Math.max(1, Math.min(12, Number(body.weeks_back ?? 4)));
  const chunkSize = Math.max(10, Math.min(100, Number(body.chunk_size ?? 50)));
  const offset = Math.max(0, Number(body.offset ?? 0));

  const { data: settings } = await supabase
    .from("mintsoft_settings")
    .select("base_url")
    .limit(1).single();
  if (!settings?.base_url) {
    return new Response(JSON.stringify({ error: "Mintsoft settings missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - weeksBack * 7);
  const fromIso = fromDate.toISOString();

  // Find DISTINCT order ids in the window where price is missing
  const { data: missingRows, error: qErr } = await supabase
    .from("order_lines")
    .select("mintsoft_order_id")
    .gte("order_date", fromIso)
    .is("unit_price", null)
    .order("mintsoft_order_id", { ascending: true })
    .range(offset, offset + chunkSize * 50); // pull headroom; we'll dedupe

  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const allIds = [...new Set((missingRows ?? []).map(r => r.mintsoft_order_id))];
  const orderIds = allIds.slice(0, chunkSize);

  let updated = 0, fetched = 0, errors = 0;

  for (const orderId of orderIds) {
    if (timeOut()) break;

    try {
      // Fetch order header (for courier + currency) and items in parallel
      const [hdrResp, itemsResp] = await Promise.all([
        fetch(`${settings.base_url}/api/Order/${orderId}`, {
          headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
        }),
        fetch(`${settings.base_url}/api/Order/${orderId}/Items`, {
          headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
        }),
      ]);
      fetched++;
      if (!itemsResp.ok) { errors++; continue; }

      const items: any[] = await itemsResp.json();
      const header: any = hdrResp.ok ? await hdrResp.json() : {};
      const courier = extractCourier(header);
      const currency = header?.Currency || 'GBP';

      // Fetch existing lines so we can map by SKU → line_index
      const { data: existing } = await supabase
        .from("order_lines")
        .select("line_index, sku")
        .eq("mintsoft_order_id", orderId);
      if (!existing?.length) continue;

      // Apply targeted UPDATEs (avoid upsert which would attempt insert and fail on NOT NULL columns)
      let posIdx = 0;
      const seenLineIdx = new Set<number>();
      for (const item of items) {
        const sku = item?.SKU;
        const unitPrice = num(item.Price) ?? num(item.UnitValue);
        const qty = Number(item.Quantity) || 0;
        const lineTotal = num(item.LineTotal) ?? num(item.LinePrice) ?? (unitPrice !== null ? unitPrice * qty : null);
        const discount = num(item.Discount) ?? num(item.DiscountAmount) ?? 0;

        let match = existing.find(l => l.sku === sku && !seenLineIdx.has(l.line_index));
        if (!match) match = existing[posIdx];
        posIdx++;
        if (!match) continue;
        seenLineIdx.add(match.line_index);

        const { error: upErr } = await supabase
          .from("order_lines")
          .update({
            unit_price: unitPrice,
            line_total: lineTotal,
            discount,
            currency,
            courier_service: courier,
          })
          .eq("mintsoft_order_id", orderId)
          .eq("line_index", match.line_index);
        if (upErr) { errors++; console.error(`update ${orderId}.${match.line_index}:`, upErr.message); }
        else updated++;
      }
    } catch (e) {
      errors++;
      console.error(`order ${orderId} failed:`, (e as Error).message);
    }
  }

  const processedOrderIds = orderIds.length;
  const nextOffset = offset + processedOrderIds;
  const done = processedOrderIds < chunkSize && allIds.length <= chunkSize;

  // Log
  await supabase.from("edge_function_runs").insert({
    function_name: "backfill-order-economics",
    started_at: new Date(START).toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - START,
    status: done ? "succeeded" : "partial",
    message: `${updated} lines updated, ${fetched} orders fetched, ${errors} errors`,
    details: { weeks_back: weeksBack, offset, next_offset: nextOffset, processed: processedOrderIds, done },
  });

  return new Response(JSON.stringify({
    ok: true,
    weeks_back: weeksBack,
    processed_orders: processedOrderIds,
    lines_updated: updated,
    errors,
    offset,
    next_offset: nextOffset,
    done,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
