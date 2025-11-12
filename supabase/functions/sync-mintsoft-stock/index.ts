import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftStockItem {
  SKU: string;
  AvailableQuantity: number;
  BackOrderQuantity: number;
  OnOrderQuantity: number;
  WarehouseId: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting stock sync from Mintsoft...");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Get Mintsoft credentials
    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("*")
      .limit(1)
      .single();

    if (!settings) {
      throw new Error("Mintsoft settings not found");
    }

    const mintsoftApiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftApiKey) {
      throw new Error("MINTSOFT_API_KEY not configured");
    }

    // Get all SKUs from products_cache that need syncing
    const { data: products, error: productsError } = await supabase
      .from("products_cache")
      .select("sku");

    if (productsError) throw productsError;

    if (!products || products.length === 0) {
      console.log("No products found to sync");
      return new Response(
        JSON.stringify({ message: "No products to sync" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Syncing stock for ${products.length} products...`);

    // Fetch stock levels from Mintsoft
    // WarehouseId=5 is 'Coleraine Live'
    const stockUrl = `${settings.base_url}/api/Product/StockLevels?WarehouseId=5`;
    
    console.log(`Fetching from Mintsoft: ${stockUrl}`);
    
    const stockResponse = await fetch(stockUrl, {
      headers: {
        "ms-apikey": mintsoftApiKey,
        "Content-Type": "application/json",
      },
    });

    if (!stockResponse.ok) {
      throw new Error(`Mintsoft API error: ${stockResponse.status} ${stockResponse.statusText}`);
    }

    const stockData: MintsoftStockItem[] = await stockResponse.json();
    console.log(`Received ${stockData.length} stock items from Mintsoft`);

    // Create a map of SKU to stock data
    const stockMap = new Map(
      stockData.map((item) => [item.SKU, item])
    );

    // Update products in batches
    let updated = 0;
    const batchSize = 50;

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      
      for (const product of batch) {
        const stockInfo = stockMap.get(product.sku);
        
        if (stockInfo) {
          const { error: updateError } = await supabase
            .from("products_cache")
            .update({
              current_stock: stockInfo.AvailableQuantity || 0,
              back_order_qty: stockInfo.BackOrderQuantity || 0,
              on_order: stockInfo.OnOrderQuantity || 0,
              last_stock_sync: new Date().toISOString(),
            })
            .eq("sku", product.sku);

          if (updateError) {
            console.error(`Error updating SKU ${product.sku}:`, updateError);
          } else {
            updated++;
          }
        }
      }
      
      console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(products.length / batchSize)}`);
    }

    console.log(`Stock sync complete. Updated ${updated} products.`);

    return new Response(
      JSON.stringify({
        success: true,
        updated,
        total: products.length,
        message: `Successfully synced stock for ${updated} products`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Stock sync error:", error);
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
