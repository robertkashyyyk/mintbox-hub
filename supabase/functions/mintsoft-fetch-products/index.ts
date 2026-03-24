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

// Normalize prefix for matching - strip trailing separators
function normalizePrefix(prefix: string): { original: string; normalized: string } {
  const original = prefix.trim().toUpperCase();
  const normalized = original.replace(/[-/]+$/, ""); // Remove trailing - or /
  return { original, normalized };
}

// Check if SKU matches the prefix (handles both ZAP- and ZAP formats)
function skuMatchesPrefix(sku: string, prefixes: { original: string; normalized: string }): boolean {
  const skuUpper = sku.toUpperCase();
  return skuUpper.startsWith(prefixes.original) || skuUpper.startsWith(prefixes.normalized);
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

    // Normalize the prefix for flexible matching
    const prefixes = normalizePrefix(prefix);
    console.log(`Prefix matching: original="${prefixes.original}", normalized="${prefixes.normalized}"`);

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

    // Configuration
    const limit = 100;
    const MAX_PAGES = 200; // Safety cap for pagination

    // Use Mintsoft Search endpoint for server-side filtering
    const allProducts: MintsoftProduct[] = [];
    let page = 1;
    let hasMore = true;
    let truncated = false;

    console.log(`Searching products with prefix: ${prefix} (mode: ${mode}) using Search endpoint`);

    while (hasMore && page <= MAX_PAGES) {
      const url = `${baseUrl}/api/Product/List?SearchTerm=${encodeURIComponent(prefix)}&PageNo=${page}&Limit=${limit}`;
      console.log(`Fetching search page ${page}...`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "ms-apikey": apiKey,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Mintsoft API error: ${response.status} - ${errorText}`);
        return new Response(
          JSON.stringify({ 
            error: `Mintsoft API error: ${response.status} ${response.statusText}`,
            detail: errorText.substring(0, 200),
          }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const products: MintsoftProduct[] = await response.json();
      
      // Still apply client-side prefix filter to ensure exact prefix matches
      const filtered = products.filter((p) => p.SKU && skuMatchesPrefix(p.SKU, prefixes));
      allProducts.push(...filtered);

      console.log(`Page ${page}: Found ${products.length} results, ${filtered.length} match prefix exactly`);

      hasMore = products.length === limit;
      page++;

      // For preview mode, stop once we have enough samples
      if (mode === "preview" && allProducts.length >= 5) {
        truncated = hasMore;
        break;
      }
    }

    // Check if we hit the page limit
    if (page > maxPages && hasMore) {
      truncated = true;
    }

    console.log(`Total products matching prefix "${prefix}": ${allProducts.length} (pages scanned: ${page - 1}, truncated: ${truncated})`);

    // Preview mode - return count and sample
    if (mode === "preview") {
      const hint = allProducts.length === 0 
        ? `No products found matching "${prefixes.original}" or "${prefixes.normalized}". Try a different prefix.`
        : null;

      return new Response(
        JSON.stringify({
          count: allProducts.length,
          sample: allProducts.slice(0, 5).map((p) => ({
            sku: p.SKU,
            name: p.Name,
          })),
          truncated,
          pagesScanned: page - 1,
          hint,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Import mode - upsert to products_cache
    if (allProducts.length === 0) {
      return new Response(
        JSON.stringify({
          imported: 0,
          message: `No products found matching prefix "${prefixes.original}" or "${prefixes.normalized}"`,
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
        truncated,
        pagesScanned: page - 1,
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
