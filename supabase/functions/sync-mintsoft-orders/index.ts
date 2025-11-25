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
  OrderItems: MintsoftOrderItem[];
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

    if (!settings) {
      throw new Error("Mintsoft settings not found");
    }

    const dispatchedStatusIds = settings.dispatched_status_ids || [40];
    console.log(`Using dispatched status IDs: ${dispatchedStatusIds.join(', ')}`);

    const mintsoftApiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftApiKey) {
      throw new Error("MINTSOFT_API_KEY not configured");
    }

    // Parse request body for optional fromDate
    let fromDate: string;
    try {
      const body = await req.json();
      fromDate = body.fromDate;
    } catch {
      // Default to 1 day ago if no body provided
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      fromDate = yesterday.toISOString().split('T')[0];
    }

    console.log(`Fetching orders from ${fromDate}...`);

    // Fetch brands for SKU resolution
    const { data: brands, error: brandsError } = await supabase
      .from("brands")
      .select("id, prefix, prefix_style");

    if (brandsError) throw brandsError;
    if (!brands || brands.length === 0) {
      throw new Error("No brands found for SKU resolution");
    }

    // Fetch orders from Mintsoft for each dispatched status ID
    let allOrders: MintsoftOrder[] = [];
    
    for (const statusId of dispatchedStatusIds) {
      const ordersUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&SinceDate=${fromDate}T00:00:00Z&IncludeOrderItems=true&Limit=100`;
      
      console.log(`Fetching orders with status ${statusId} from: ${ordersUrl}`);
      
      const ordersResponse = await fetch(ordersUrl, {
        method: "GET",
        headers: {
          "ms-apikey": mintsoftApiKey,
          "Content-Type": "application/json",
        },
      });

      if (!ordersResponse.ok) {
        const errorBody = await ordersResponse.text();
        console.error(`Mintsoft error for status ${statusId}: ${errorBody}`);
        // Continue with other statuses instead of failing completely
        continue;
      }

      const orders: MintsoftOrder[] = await ordersResponse.json();
      console.log(`Received ${orders.length} orders with status ${statusId}`);
      allOrders = allOrders.concat(orders);
    }

    console.log(`Total orders fetched across all statuses: ${allOrders.length}`);

    let linesProcessed = 0;
    let linesInserted = 0;
    let linesSkipped = 0;
    let productsCreated = 0;

    // Process each order
    for (const order of allOrders) {
      let lineIndex = 1;

      for (const item of order.OrderItems || []) {
        linesProcessed++;

        // Resolve brand_id from SKU
        const brandId = resolveBrandFromSKU(item.SKU, brands);

        if (!brandId) {
          console.log(`Skipping line: SKU ${item.SKU} - no brand match`);
          linesSkipped++;
          continue;
        }

        // Check if product exists in products_cache
        const { data: existingProduct } = await supabase
          .from("products_cache")
          .select("id")
          .eq("sku", item.SKU)
          .maybeSingle();

        if (!existingProduct) {
          // Auto-create minimal product record with discovery tracking
          const { error: productError } = await supabase
            .from("products_cache")
            .upsert({
              sku: item.SKU,
              name: item.SKU,
              brand_id: brandId,
              discovery_source: 'order',
            }, {
              onConflict: 'sku',
              ignoreDuplicates: true
            });
          
          if (productError) {
            console.log(`Could not auto-create product for SKU ${item.SKU}:`, productError);
          } else {
            productsCreated++;
            console.log(`Auto-created product for SKU: ${item.SKU} (brand: ${brandId})`);
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
          console.error(`Error upserting line for order ${order.ID}, line ${lineIndex}:`, upsertError);
        } else {
          linesInserted++;
        }

        lineIndex++;
      }
    }

    console.log(`Orders sync complete. Processed: ${linesProcessed}, Inserted: ${linesInserted}, Skipped: ${linesSkipped}`);

    return new Response(
      JSON.stringify({
        success: true,
        orders_fetched: allOrders.length,
        lines_processed: linesProcessed,
        lines_inserted: linesInserted,
        lines_skipped: linesSkipped,
        products_created: productsCreated,
        status_ids_used: dispatchedStatusIds,
        message: `Successfully synced ${allOrders.length} orders with ${linesInserted} lines using status IDs: ${dispatchedStatusIds.join(', ')}`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Orders sync error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
