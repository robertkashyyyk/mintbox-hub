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

    // Build a SKU set we already track
    const knownSkus = new Set(products.map((p) => p.sku));
    const now = new Date().toISOString();

    // Compose update payloads for all SKUs we know about that Mintsoft returned.
    // Use chunked upserts (sku is unique) instead of per-SKU UPDATEs — this drops
    // a 10k-product sync from ~minutes to ~seconds and lets us run inline from a
    // user "Refresh stock" click.
    const updates = stockData
      .filter((it) => knownSkus.has(it.SKU))
      .map((it) => ({
        sku: it.SKU,
        current_stock: it.AvailableQuantity || 0,
        back_order_qty: it.BackOrderQuantity || 0,
        on_order: it.OnOrderQuantity || 0,
        last_stock_sync: now,
      }));

    let updated = 0;
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const { error: upErr } = await supabase
        .from("products_cache")
        .upsert(batch, { onConflict: "sku" });
      if (upErr) {
        console.error("Batch upsert error:", upErr);
      } else {
        updated += batch.length;
      }
      console.log(`Upserted ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
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
