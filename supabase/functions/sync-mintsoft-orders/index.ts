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

// Fetch items for multiple orders with concurrency control
async function fetchItemsBatch(
  baseUrl: string,
  apiKey: string,
  orders: MintsoftOrder[],
  concurrency: number = 5
): Promise<Map<number, MintsoftOrderItem[]>> {
  const results = new Map<number, MintsoftOrderItem[]>();
  
  for (let i = 0; i < orders.length; i += concurrency) {
    const batch = orders.slice(i, i + concurrency);
    const promises = batch.map(async (order) => {
      const items = await fetchOrderItems(baseUrl, apiKey, order.ID);
      return { orderId: order.ID, items };
    });
    
    const batchResults = await Promise.all(promises);
    for (const { orderId, items } of batchResults) {
      results.set(orderId, items);
    }
    
    if (i % 50 === 0 && i > 0) {
      console.log(`Fetched items for ${i}/${orders.length} orders...`);
    }
  }
  
  return results;
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

    // Parse request body for optional fromDate — default to 7 days ago
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

    // Fetch orders from Mintsoft — increased page cap to 50
    let allOrders: MintsoftOrder[] = [];

    for (const statusId of dispatchedStatusIds) {
      let pageNo = 1;
      let statusTotal = 0;

      while (true) {
        const ordersUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&Limit=100&PageNo=${pageNo}`;
        console.log(`Fetching: ${ordersUrl}`);

        const ordersResponse = await fetch(ordersUrl, {
          method: "GET",
          headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
        });

        console.log(`Response status: ${ordersResponse.status}`);

        if (!ordersResponse.ok) {
          const errorBody = await ordersResponse.text();
          console.error(`Mintsoft error ${ordersResponse.status}: ${errorBody}`);
          break;
        }

        const orders: MintsoftOrder[] = await ordersResponse.json();
        const filteredOrders = orders.filter(o => new Date(o.OrderDate) >= fromDateObj);

        console.log(`Page ${pageNo}: ${orders.length} orders, ${filteredOrders.length} after date filter (status ${statusId})`);

        if (orders.length === 0) break;

        allOrders = allOrders.concat(filteredOrders);
        statusTotal += filteredOrders.length;

        // If no orders pass the date filter, we've gone past our date window
        if (filteredOrders.length === 0) {
          console.log(`No orders in date range on page ${pageNo}, stopping status ${statusId}`);
          break;
        }

        if (orders.length < 100) break;
        if (pageNo >= 50) {
          console.log(`Reached page cap (50) for status ${statusId}, stopping`);
          break;
        }
        pageNo++;
      }

      console.log(`Status ${statusId} total: ${statusTotal} orders across ${pageNo} page(s)`);
    }

    console.log(`Total orders to process: ${allOrders.length}`);

    // Batch-fetch all order items with concurrency of 10
    console.log("Fetching order items in parallel batches...");
    const orderItemsMap = await fetchItemsBatch(settings.base_url, mintsoftApiKey, allOrders, 10);
    console.log(`Fetched items for ${orderItemsMap.size} orders`);

    // Pre-fetch existing order lines for status change detection (batch query)
    const orderIds = [...new Set(allOrders.map(o => o.ID))];
    const { data: existingLines } = await supabase
      .from("order_lines")
      .select("mintsoft_order_id, line_index, order_status_id, times_seen")
      .in("mintsoft_order_id", orderIds);

    const existingLineMap = new Map<string, { order_status_id: number | null; times_seen: number }>();
    for (const line of existingLines || []) {
      existingLineMap.set(`${line.mintsoft_order_id}-${line.line_index}`, {
        order_status_id: line.order_status_id,
        times_seen: line.times_seen || 1,
      });
    }

    let linesProcessed = 0;
    let linesInserted = 0;
    let linesSkipped = 0;
    let productsCreated = 0;

    // Build all upsert payloads in memory, then batch-upsert
    const upsertPayloads: Record<string, unknown>[] = [];
    const newSkus: { sku: string; brand_id: string }[] = [];
    const now = new Date().toISOString();

    for (const order of allOrders) {
      const items = orderItemsMap.get(order.ID) || [];
      let lineIndex = 1;

      for (const item of items) {
        linesProcessed++;

        const brandId = resolveBrandFromSKU(item.SKU, brands);
        if (!brandId) {
          linesSkipped++;
          lineIndex++;
          continue;
        }

        // Track new SKUs for auto-creation
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

        if (statusChanged) {
          payload.last_status_change_at = now;
        }

        if (!existing) {
          payload.first_seen_at = now;
          payload.last_status_change_at = now;
        }

        upsertPayloads.push(payload);
        lineIndex++;
      }
    }

    // Batch auto-create products (deduplicated)
    const uniqueSkus = [...new Map(newSkus.map(s => [s.sku, s])).values()];
    const { data: existingProducts } = await supabase
      .from("products_cache")
      .select("sku")
      .in("sku", uniqueSkus.map(s => s.sku));

    const existingSkuSet = new Set((existingProducts || []).map(p => p.sku));
    const newProducts = uniqueSkus
      .filter(s => !existingSkuSet.has(s.sku))
      .map(s => ({ sku: s.sku, name: s.sku, brand_id: s.brand_id, discovery_source: 'order' }));

    if (newProducts.length > 0) {
      for (let i = 0; i < newProducts.length; i += 500) {
        const batch = newProducts.slice(i, i + 500);
        const { error: prodErr } = await supabase
          .from("products_cache")
          .upsert(batch, { onConflict: 'sku', ignoreDuplicates: true });
        if (prodErr) console.error("Product upsert error:", prodErr);
        else productsCreated += batch.length;
      }
      console.log(`Auto-created ${productsCreated} products`);
    }

    // Batch upsert order lines in chunks of 500
    for (let i = 0; i < upsertPayloads.length; i += 500) {
      const batch = upsertPayloads.slice(i, i + 500);
      const { error: upsertError } = await supabase
        .from("order_lines")
        .upsert(batch, { onConflict: "mintsoft_order_id,line_index" });

      if (upsertError) {
        console.error(`Error upserting batch ${Math.floor(i / 500) + 1}:`, upsertError);
      } else {
        linesInserted += batch.length;
      }
    }

    console.log(`Sync complete. Processed: ${linesProcessed}, Inserted: ${linesInserted}, Skipped: ${linesSkipped}, Products created: ${productsCreated}`);

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
        message: `Synced ${allOrders.length} orders with ${linesInserted} lines using status IDs: ${dispatchedStatusIds.join(', ')}`,
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
