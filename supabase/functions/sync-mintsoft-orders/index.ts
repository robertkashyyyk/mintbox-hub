import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftOrder {
  ID: number;
  OrderDate: string;
  Channel: {
    Name: string;
  } | null;
  ExternalOrderReference: string;
  WarehouseId?: number;
}

interface MintsoftOrderItem {
  SKU: string;
  Quantity: number;
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

    // Get Mintsoft credentials and dispatched status IDs
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
    if (!mintsoftApiKey) throw new Error("MINTSOFT_API_KEY not configured");

    // Parse request body for optional fromDate
    let fromDate: string;
    try {
      const body = await req.json();
      fromDate = body.fromDate;
    } catch {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      fromDate = twoDaysAgo.toISOString().split('T')[0];
    }

    const fromDateObj = new Date(`${fromDate}T00:00:00Z`);
    console.log(`Fetching orders, filtering for dates since ${fromDate}...`);

    // Fetch brands for SKU resolution
    const { data: brands, error: brandsError } = await supabase
      .from("brands")
      .select("id, prefix, prefix_style");

    if (brandsError) throw brandsError;
    if (!brands || brands.length === 0) {
      throw new Error("No brands found for SKU resolution");
    }

    // Fetch orders from Mintsoft for each dispatched status ID
    // NOTE: /api/Order/List does NOT support IncludeOrderItems or SinceDate
    // We fetch orders, filter by date client-side, then fetch items per order
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

        // Filter orders by date client-side
        const filteredOrders = orders.filter(o => new Date(o.OrderDate) >= fromDateObj);

        console.log(`Page ${pageNo}: ${orders.length} orders, ${filteredOrders.length} after date filter (status ${statusId})`);

        if (orders.length === 0) break;

        allOrders = allOrders.concat(filteredOrders);
        statusTotal += filteredOrders.length;

        if (orders.length < 100) break;
        if (pageNo >= 20) {
          console.log(`Reached page cap (20) for status ${statusId}, stopping`);
          break;
        }
        pageNo++;
      }

      console.log(`Status ${statusId} total: ${statusTotal} orders across ${pageNo} page(s)`);
    }

    console.log(`Total orders to process: ${allOrders.length}`);

    let linesProcessed = 0;
    let linesInserted = 0;
    let linesSkipped = 0;
    let productsCreated = 0;

    // Process each order — fetch items separately
    for (const order of allOrders) {
      const items = await fetchOrderItems(settings.base_url, mintsoftApiKey, order.ID);
      let lineIndex = 1;

      for (const item of items) {
        linesProcessed++;

        const brandId = resolveBrandFromSKU(item.SKU, brands);
        if (!brandId) {
          linesSkipped++;
          continue;
        }

        // Auto-create product if missing
        const { data: existingProduct } = await supabase
          .from("products_cache")
          .select("id")
          .eq("sku", item.SKU)
          .maybeSingle();

        if (!existingProduct) {
          const { error: productError } = await supabase
            .from("products_cache")
            .upsert(
              { sku: item.SKU, name: item.SKU, brand_id: brandId, discovery_source: 'order' },
              { onConflict: 'sku', ignoreDuplicates: true }
            );
          if (!productError) {
            productsCreated++;
            console.log(`Auto-created product: ${item.SKU}`);
          }
        }

        // Upsert into order_lines
        const { error: upsertError } = await supabase
          .from("order_lines")
          .upsert(
            {
              mintsoft_order_id: order.ID,
              line_index: lineIndex,
              sku: item.SKU,
              qty: item.Quantity,
              order_date: order.OrderDate,
              channel: order.Channel?.Name || null,
              channel_order_ref: order.ExternalOrderReference || null,
              warehouse_id: order.WarehouseId?.toString() || null,
              brand_id: brandId,
            },
            { onConflict: "mintsoft_order_id,line_index" }
          );

        if (upsertError) {
          console.error(`Error upserting order ${order.ID} line ${lineIndex}:`, upsertError);
        } else {
          linesInserted++;
        }
        lineIndex++;
      }
    }

    console.log(`Sync complete. Processed: ${linesProcessed}, Inserted: ${linesInserted}, Skipped: ${linesSkipped}, Products created: ${productsCreated}`);

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
