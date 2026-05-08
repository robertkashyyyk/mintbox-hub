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

    // Optional scope: refresh only this list of SKUs (used by per-supplier "Refresh stock" buttons).
    let scopeSkus: string[] | null = null;
    try {
      if (req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (body && Array.isArray(body.skus) && body.skus.length > 0) {
          scopeSkus = body.skus.map((s: unknown) => String(s)).filter(Boolean);
          console.log(`Scoped sync requested for ${scopeSkus.length} SKUs`);
        }
      }
    } catch (_) { /* no body */ }

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

    // Build the list of SKUs we will accept updates for.
    const allSkus: string[] = [];
    if (scopeSkus) {
      allSkus.push(...scopeSkus);
    } else {
      // Page through to bypass PostgREST's default 1000-row cap.
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: page, error: pErr } = await supabase
          .from("products_cache")
          .select("sku")
          .order("sku", { ascending: true })
          .range(from, from + pageSize - 1);
        if (pErr) throw pErr;
        if (!page || page.length === 0) break;
        for (const p of page) allSkus.push(p.sku);
        if (page.length < pageSize) break;
        from += pageSize;
      }
    }
    const products = allSkus.map((sku) => ({ sku }));

    if (products.length === 0) {
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
