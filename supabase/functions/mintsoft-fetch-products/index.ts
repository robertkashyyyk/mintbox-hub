import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftProduct {
  ID: number;
  SKU: string;
  Name: string;
  EANBarcode?: string;
  UPCBarcode?: string;
  CostPrice?: number;
  Weight?: number;
  Height?: number;
  Length?: number;
  Depth?: number;
  Discontinued?: boolean;
  LowStockAlertLevel?: number;
  HandlingTime?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { prefix, mode, userId } = await req.json();

    if (!prefix || typeof prefix !== "string") {
      return new Response(
        JSON.stringify({ error: "Prefix is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!mode || (mode !== "preview" && mode !== "import")) {
      return new Response(
        JSON.stringify({ error: "Mode must be 'preview' or 'import'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Mintsoft credentials from Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch mintsoft settings
    const { data: settings, error: settingsError } = await supabase
      .from("mintsoft_settings")
      .select("base_url")
      .single();

    if (settingsError || !settings) {
      console.error("Failed to fetch Mintsoft settings:", settingsError);
      return new Response(
        JSON.stringify({ error: "Mintsoft settings not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = settings.base_url;
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Mintsoft API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch products from Mintsoft with pagination
    const allProducts: MintsoftProduct[] = [];
    let page = 1;
    const limit = 100;
    let hasMore = true;

    console.log(`Fetching products with prefix: ${prefix}`);

    while (hasMore) {
      const url = `${baseUrl}/api/Product?PageNo=${page}&Limit=${limit}&ApiKey=${apiKey}`;
      console.log(`Fetching page ${page}...`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Mintsoft API error: ${response.status} - ${errorText}`);
        throw new Error(`Mintsoft API error: ${response.status}`);
      }

      const products: MintsoftProduct[] = await response.json();
      
      // Filter by prefix
      const filtered = products.filter((p) => p.SKU?.startsWith(prefix));
      allProducts.push(...filtered);

      console.log(`Page ${page}: Found ${products.length} products, ${filtered.length} match prefix`);

      hasMore = products.length === limit;
      page++;

      // Safety limit to prevent infinite loops
      if (page > 500) {
        console.warn("Reached maximum page limit");
        break;
      }
    }

    console.log(`Total products matching prefix "${prefix}": ${allProducts.length}`);

    // Preview mode - return count and sample
    if (mode === "preview") {
      return new Response(
        JSON.stringify({
          count: allProducts.length,
          sample: allProducts.slice(0, 5).map((p) => ({
            sku: p.SKU,
            name: p.Name,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Import mode - upsert to products_cache
    if (allProducts.length === 0) {
      return new Response(
        JSON.stringify({
          imported: 0,
          message: "No products found matching the prefix",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch upsert products
    const productsToUpsert = allProducts.map((p) => ({
      sku: p.SKU,
      name: p.Name || p.SKU,
      barcode: p.EANBarcode || p.UPCBarcode || null,
      mintsoft_product_id: p.ID,
      cost_price: p.CostPrice || null,
      weight: p.Weight || null,
      height: p.Height || null,
      length: p.Length || null,
      depth: p.Depth || null,
      discontinued: p.Discontinued || false,
      low_stock_alert_level: p.LowStockAlertLevel || null,
      handling_time: p.HandlingTime || null,
    }));

    // Upsert in batches of 100
    const batchSize = 100;
    let totalImported = 0;

    for (let i = 0; i < productsToUpsert.length; i += batchSize) {
      const batch = productsToUpsert.slice(i, i + batchSize);
      const { error: upsertError } = await supabase
        .from("products_cache")
        .upsert(batch, { onConflict: "sku" });

      if (upsertError) {
        console.error("Upsert error:", upsertError);
        throw new Error(`Failed to upsert products: ${upsertError.message}`);
      }

      totalImported += batch.length;
    }

    // Log to upload_history
    if (userId) {
      const { error: historyError } = await supabase
        .from("upload_history")
        .insert({
          user_id: userId,
          upload_name: `Mintsoft Pull: ${prefix}`,
          items_imported: totalImported,
          status: "success",
          source: "pull",
          prefix: prefix,
        });

      if (historyError) {
        console.error("Failed to log upload history:", historyError);
      }
    }

    return new Response(
      JSON.stringify({
        imported: totalImported,
        message: `Successfully imported ${totalImported} products with prefix "${prefix}"`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
