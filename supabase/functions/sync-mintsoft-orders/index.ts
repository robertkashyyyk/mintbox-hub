import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftOrder {
  ID: number;
  OrderDate: string;
  OrderStatusId?: number;
  OrderStatus?: string;
  CustomerName?: string;
  Channel: { Name: string } | null;
  ExternalOrderReference: string;
  WarehouseId?: number;
}

interface MintsoftOrderItem {
  SKU: string;
  Quantity: number;
  Name?: string;
}

interface Brand {
  id: string;
  prefix: string;
  prefix_style: "hyphen" | "slash";
}

function resolveBrandFromSKU(sku: string, brands: Brand[]): string | null {
  for (const brand of brands) {
    const separator = brand.prefix_style === "slash" ? "/" : "-";
    const pattern = `${brand.prefix}${separator}`;
    if (sku.toUpperCase().startsWith(pattern.toUpperCase())) return brand.id;
  }
  return null;
}

async function fetchOrderItems(baseUrl: string, apiKey: string, orderId: number): Promise<MintsoftOrderItem[]> {
  const resp = await fetch(`${baseUrl}/api/Order/${orderId}/Items`, {
    headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
  });
  if (!resp.ok) return [];
  return await resp.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("Starting Mintsoft orders sync...");
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: settings } = await supabase.from("mintsoft_settings").select("base_url, dispatched_status_ids").limit(1).single();
    if (!settings) throw new Error("Mintsoft settings not found");

    const dispatchedStatusIds = settings.dispatched_status_ids || [40];
    const mintsoftApiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftApiKey) throw new Error("MINTSOFT_API_KEY not configured");

    let fromDate: string;
    try { const body = await req.json(); fromDate = body.fromDate; } catch {
      const d = new Date(); d.setDate(d.getDate() - 7);
      fromDate = d.toISOString().split('T')[0];
    }
    const fromDateObj = new Date(`${fromDate}T00:00:00Z`);
    console.log(`Filtering orders since ${fromDate}`);

    const { data: brands, error: brandsError } = await supabase.from("brands").select("id, prefix, prefix_style");
    if (brandsError) throw brandsError;
    if (!brands?.length) throw new Error("No brands found");

    // 1. Fetch order headers (fast — no items)
    let allOrders: MintsoftOrder[] = [];
    for (const statusId of dispatchedStatusIds) {
      let pageNo = 1;
      while (true) {
        const resp = await fetch(`${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&Limit=100&PageNo=${pageNo}`, {
          headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
        });
        if (!resp.ok) break;
        const orders: MintsoftOrder[] = await resp.json();
        if (orders.length === 0) break;
        const filtered = orders.filter(o => new Date(o.OrderDate) >= fromDateObj);
        allOrders = allOrders.concat(filtered);
        if (filtered.length === 0 || orders.length < 100 || pageNo >= 50) break;
        pageNo++;
      }
    }
    console.log(`Fetched ${allOrders.length} order headers`);

    // 2. Find which orders we already have lines for
    const orderIds = [...new Set(allOrders.map(o => o.ID))];
    const knownOrderIds = new Set<number>();
    const existingLineMap = new Map<string, { order_status_id: number | null; times_seen: number }>();
    
    for (let i = 0; i < orderIds.length; i += 500) {
      const batch = orderIds.slice(i, i + 500);
      const { data: existing } = await supabase
        .from("order_lines")
        .select("mintsoft_order_id, line_index, order_status_id, times_seen")
        .in("mintsoft_order_id", batch);
      for (const line of existing || []) {
        knownOrderIds.add(line.mintsoft_order_id);
        existingLineMap.set(`${line.mintsoft_order_id}-${line.line_index}`, {
          order_status_id: line.order_status_id,
          times_seen: line.times_seen || 1,
        });
      }
    }

    const newOrders = allOrders.filter(o => !knownOrderIds.has(o.ID));
    const existingOrders = allOrders.filter(o => knownOrderIds.has(o.ID));
    console.log(`${newOrders.length} new orders need item fetch, ${existingOrders.length} existing orders for status update`);

    const now = new Date().toISOString();
    let linesProcessed = 0, linesInserted = 0, linesSkipped = 0, productsCreated = 0;

    // 3. For EXISTING orders — bulk update status fields only (no item fetch needed)
    if (existingOrders.length > 0) {
      const updatePayloads: Record<string, unknown>[] = [];
      for (const order of existingOrders) {
        // We need to update each line for this order
        const lineKeys = [...existingLineMap.keys()].filter(k => k.startsWith(`${order.ID}-`));
        for (const key of lineKeys) {
          const existing = existingLineMap.get(key)!;
          const [, lineIndexStr] = key.split('-');
          const statusChanged = existing.order_status_id !== (order.OrderStatusId ?? null);
          
          const payload: Record<string, unknown> = {
            mintsoft_order_id: order.ID,
            line_index: parseInt(lineIndexStr),
            last_seen_at: now,
            times_seen: (existing.times_seen || 1) + 1,
            order_status: order.OrderStatus || null,
            order_status_id: order.OrderStatusId ?? null,
            customer_name: order.CustomerName || null,
          };
          if (statusChanged) payload.last_status_change_at = now;
          updatePayloads.push(payload);
        }
      }
      
      // Batch update via upsert
      for (let i = 0; i < updatePayloads.length; i += 500) {
        const batch = updatePayloads.slice(i, i + 500);
        const { error } = await supabase.from("order_lines").upsert(batch, { onConflict: "mintsoft_order_id,line_index" });
        if (error) console.error("Status update error:", error);
        else linesInserted += batch.length;
      }
      console.log(`Updated ${linesInserted} existing lines with status info`);
    }

    // 4. For NEW orders — fetch items and create lines (this is the slow part)
    const CONCURRENCY = 10;
    const CHUNK = 50;

    for (let c = 0; c < newOrders.length; c += CHUNK) {
      const chunk = newOrders.slice(c, c + CHUNK);

      // Fetch items in parallel
      const itemsMap = new Map<number, MintsoftOrderItem[]>();
      for (let i = 0; i < chunk.length; i += CONCURRENCY) {
        const batch = chunk.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async o => ({
          id: o.ID,
          items: await fetchOrderItems(settings.base_url, mintsoftApiKey, o.ID),
        })));
        for (const r of results) itemsMap.set(r.id, r.items);
      }

      const upsertPayloads: Record<string, unknown>[] = [];
      const newSkus: { sku: string; brand_id: string }[] = [];

      for (const order of chunk) {
        const items = itemsMap.get(order.ID) || [];
        let lineIndex = 1;
        for (const item of items) {
          linesProcessed++;
          const brandId = resolveBrandFromSKU(item.SKU, brands);
          if (!brandId) { linesSkipped++; lineIndex++; continue; }
          newSkus.push({ sku: item.SKU, brand_id: brandId });

          upsertPayloads.push({
            mintsoft_order_id: order.ID,
            line_index: lineIndex,
            sku: item.SKU,
            qty: item.Quantity,
            order_date: order.OrderDate,
            channel: order.Channel?.Name || null,
            channel_order_ref: order.ExternalOrderReference || null,
            warehouse_id: order.WarehouseId?.toString() || null,
            brand_id: brandId,
            order_status: order.OrderStatus || null,
            order_status_id: order.OrderStatusId ?? null,
            product_name: item.Name || null,
            customer_name: order.CustomerName || null,
            first_seen_at: now,
            last_seen_at: now,
            last_status_change_at: now,
            times_seen: 1,
          });
          lineIndex++;
        }
      }

      // Auto-create products
      const uniqueSkus = [...new Map(newSkus.map(s => [s.sku, s])).values()];
      if (uniqueSkus.length > 0) {
        const { data: ep } = await supabase.from("products_cache").select("sku").in("sku", uniqueSkus.map(s => s.sku));
        const existSet = new Set((ep || []).map(p => p.sku));
        const np = uniqueSkus.filter(s => !existSet.has(s.sku)).map(s => ({ sku: s.sku, name: s.sku, brand_id: s.brand_id, discovery_source: 'order' }));
        if (np.length > 0) {
          const { error } = await supabase.from("products_cache").upsert(np, { onConflict: 'sku', ignoreDuplicates: true });
          if (!error) productsCreated += np.length;
        }
      }

      // Upsert lines
      if (upsertPayloads.length > 0) {
        const { error } = await supabase.from("order_lines").upsert(upsertPayloads, { onConflict: "mintsoft_order_id,line_index" });
        if (error) console.error("Upsert error:", error);
        else linesInserted += upsertPayloads.length;
      }

      console.log(`Chunk ${c + CHUNK}/${newOrders.length}: ${linesInserted} lines saved so far`);
    }

    console.log(`Done. Lines: ${linesInserted}, Skipped: ${linesSkipped}, Products: ${productsCreated}`);

    // Trigger evaluate-order-issues
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evaluate-order-issues`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ triggered_by: "sync-mintsoft-orders" }),
      });
    } catch (e) { console.error("eval trigger failed:", e); }

    return new Response(JSON.stringify({
      success: true,
      orders_fetched: allOrders.length,
      new_orders: newOrders.length,
      existing_orders_updated: existingOrders.length,
      lines_inserted: linesInserted,
      lines_skipped: linesSkipped,
      products_created: productsCreated,
      message: `Synced ${allOrders.length} orders (${newOrders.length} new, ${existingOrders.length} updated)`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Orders sync error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
