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
  Channel: {
    Name: string;
  } | null;
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
    if (sku.toUpperCase().startsWith(pattern.toUpperCase())) {
      return brand.id;
    }
  }
  return null;
}

async function fetchOrderItems(
  baseUrl: string,
  apiKey: string,
  orderId: number
): Promise<MintsoftOrderItem[]> {
  const url = `${baseUrl}/api/Order/${orderId}/Items`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    console.error(`Failed to fetch items for order ${orderId}: ${response.status}`);
    return [];
  }
  return await response.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting Mintsoft orders sync...");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("base_url, dispatched_status_ids")
      .limit(1)
      .single();

    if (!settings) throw new Error("Mintsoft settings not found");

    const dispatchedStatusIds = settings.dispatched_status_ids || [40];
    console.log(`Using dispatched status IDs: ${dispatchedStatusIds.join(', ')}`);

    const mintsoftApiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftApiKey) throw new Error("MINTSOFT_API_KEY not configured");

    let fromDate: string;
    try {
      const body = await req.json();
      fromDate = body.fromDate;
    } catch {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      fromDate = sevenDaysAgo.toISOString().split('T')[0];
    }

    const fromDateObj = new Date(`${fromDate}T00:00:00Z`);
    console.log(`Fetching orders, filtering for dates since ${fromDate}...`);

    const { data: brands, error: brandsError } = await supabase
      .from("brands")
      .select("id, prefix, prefix_style");

    if (brandsError) throw brandsError;
    if (!brands || brands.length === 0) {
      throw new Error("No brands found for SKU resolution");
    }

    // Fetch all order headers first (this is fast)
    let allOrders: MintsoftOrder[] = [];

    for (const statusId of dispatchedStatusIds) {
      let pageNo = 1;
      let statusTotal = 0;

      while (true) {
        const ordersUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&Limit=100&PageNo=${pageNo}`;
        const ordersResponse = await fetch(ordersUrl, {
          method: "GET",
          headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
        });

        if (!ordersResponse.ok) {
          const errorBody = await ordersResponse.text();
          console.error(`Mintsoft error ${ordersResponse.status}: ${errorBody}`);
          break;
        }

        const orders: MintsoftOrder[] = await ordersResponse.json();
        const filteredOrders = orders.filter(o => new Date(o.OrderDate) >= fromDateObj);

        if (orders.length === 0) break;

        allOrders = allOrders.concat(filteredOrders);
        statusTotal += filteredOrders.length;

        if (filteredOrders.length === 0) {
          console.log(`No orders in date range on page ${pageNo}, stopping status ${statusId}`);
          break;
        }

        if (orders.length < 100) break;
        if (pageNo >= 50) break;
        pageNo++;
      }
      console.log(`Status ${statusId}: ${statusTotal} orders across ${pageNo} page(s)`);
    }

    console.log(`Total orders to process: ${allOrders.length}`);

    // Pre-fetch existing order lines for status change detection
    const orderIds = [...new Set(allOrders.map(o => o.ID))];
    
    // Batch the .in() query to avoid URL length limits
    const existingLineMap = new Map<string, { order_status_id: number | null; times_seen: number }>();
    for (let i = 0; i < orderIds.length; i += 500) {
      const batch = orderIds.slice(i, i + 500);
      const { data: existingLines } = await supabase
        .from("order_lines")
        .select("mintsoft_order_id, line_index, order_status_id, times_seen")
        .in("mintsoft_order_id", batch);

      for (const line of existingLines || []) {
        existingLineMap.set(`${line.mintsoft_order_id}-${line.line_index}`, {
          order_status_id: line.order_status_id,
          times_seen: line.times_seen || 1,
        });
      }
    }

    let linesProcessed = 0;
    let linesInserted = 0;
    let linesSkipped = 0;
    let productsCreated = 0;
    const now = new Date().toISOString();

    // Process orders in chunks of 50 — fetch items + upsert progressively
    const CHUNK_SIZE = 50;
    const CONCURRENCY = 10;

    for (let chunkStart = 0; chunkStart < allOrders.length; chunkStart += CHUNK_SIZE) {
      const chunk = allOrders.slice(chunkStart, chunkStart + CHUNK_SIZE);
      
      // Fetch items for this chunk in parallel
      const itemsMap = new Map<number, MintsoftOrderItem[]>();
      for (let i = 0; i < chunk.length; i += CONCURRENCY) {
        const batch = chunk.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (order) => {
          const items = await fetchOrderItems(settings.base_url, mintsoftApiKey, order.ID);
          return { orderId: order.ID, items };
        });
        const results = await Promise.all(promises);
        for (const { orderId, items } of results) {
          itemsMap.set(orderId, items);
        }
      }

      // Build upsert payloads for this chunk
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

          const key = `${order.ID}-${lineIndex}`;
          const existing = existingLineMap.get(key);
          const statusChanged = existing && existing.order_status_id !== (order.OrderStatusId ?? null);
          const currentTimesSeen = existing ? (existing.times_seen || 1) + 1 : 1;

          const payload: Record<string, unknown> = {
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
            last_seen_at: now,
            times_seen: currentTimesSeen,
          };

          if (statusChanged) payload.last_status_change_at = now;
          if (!existing) {
            payload.first_seen_at = now;
            payload.last_status_change_at = now;
          }

          upsertPayloads.push(payload);
          lineIndex++;
        }
      }

      // Auto-create products for this chunk
      const uniqueSkus = [...new Map(newSkus.map(s => [s.sku, s])).values()];
      if (uniqueSkus.length > 0) {
        const { data: existingProducts } = await supabase
          .from("products_cache")
          .select("sku")
          .in("sku", uniqueSkus.map(s => s.sku));

        const existingSkuSet = new Set((existingProducts || []).map(p => p.sku));
        const newProducts = uniqueSkus
          .filter(s => !existingSkuSet.has(s.sku))
          .map(s => ({ sku: s.sku, name: s.sku, brand_id: s.brand_id, discovery_source: 'order' }));

        if (newProducts.length > 0) {
          const { error: prodErr } = await supabase
            .from("products_cache")
            .upsert(newProducts, { onConflict: 'sku', ignoreDuplicates: true });
          if (prodErr) console.error("Product upsert error:", prodErr);
          else productsCreated += newProducts.length;
        }
      }

      // Upsert order lines for this chunk
      if (upsertPayloads.length > 0) {
        const { error: upsertError } = await supabase
          .from("order_lines")
          .upsert(upsertPayloads, { onConflict: "mintsoft_order_id,line_index" });

        if (upsertError) {
          console.error(`Upsert error at chunk ${chunkStart}:`, upsertError);
        } else {
          linesInserted += upsertPayloads.length;
        }
      }

      if ((chunkStart + CHUNK_SIZE) % 200 === 0 || chunkStart + CHUNK_SIZE >= allOrders.length) {
        console.log(`Progress: ${Math.min(chunkStart + CHUNK_SIZE, allOrders.length)}/${allOrders.length} orders, ${linesInserted} lines saved`);
      }
    }

    console.log(`Sync complete. Processed: ${linesProcessed}, Inserted: ${linesInserted}, Skipped: ${linesSkipped}, Products: ${productsCreated}`);

    // Trigger evaluate-order-issues
    try {
      const evalUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/evaluate-order-issues`;
      await fetch(evalUrl, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ triggered_by: "sync-mintsoft-orders" }),
      });
      console.log("Triggered evaluate-order-issues");
    } catch (evalErr) {
      console.error("Failed to trigger evaluate-order-issues:", evalErr);
    }

    return new Response(
      JSON.stringify({
        success: true,
        orders_fetched: allOrders.length,
        lines_processed: linesProcessed,
        lines_inserted: linesInserted,
        lines_skipped: linesSkipped,
        products_created: productsCreated,
        status_ids_used: dispatchedStatusIds,
        message: `Synced ${allOrders.length} orders with ${linesInserted} lines`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Orders sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
