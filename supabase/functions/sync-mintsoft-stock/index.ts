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
          scopeSkus = Array.from(new Set(body.skus.map((s: unknown) => String(s).trim()).filter(Boolean)));
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
    let stockData: MintsoftStockItem[] = [];

    const useBulkFetchForScope = !!scopeSkus && scopeSkus.length > 250;

    if (scopeSkus && scopeSkus.length > 0 && !useBulkFetchForScope) {
      // Per-SKU fetch — pulling the entire warehouse list (~200k rows) just to
      // refresh 40-100 SKUs times out. Hit StockLevels with &SKU= for each one
      // and fan them out in small concurrent batches.
      console.log(`Fetching ${scopeSkus.length} SKUs individually from Mintsoft...`);
      const concurrency = Math.min(32, Math.max(8, Math.ceil(scopeSkus.length / 75)));
      let idx = 0;
      let failed = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const i = idx++;
          if (i >= scopeSkus!.length) return;
          const sku = scopeSkus![i];
          const url = `${settings.base_url}/api/Product/StockLevels?WarehouseId=5&SKU=${encodeURIComponent(sku)}`;
          try {
            const r = await fetch(url, {
              headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
            });
            if (!r.ok) { failed++; continue; }
            const arr = await r.json();
            if (Array.isArray(arr)) {
              for (const it of arr) stockData.push(it);
            }
          } catch (e) {
            failed++;
            console.error(`Fetch failed for ${sku}:`, e);
          }
        }
      });
      await Promise.all(workers);
      console.log(`Per-SKU fetch complete: ${stockData.length} rows, ${failed} failures`);
    } else {
      const stockUrl = `${settings.base_url}/api/Product/StockLevels?WarehouseId=5`;
      if (useBulkFetchForScope) {
        console.log(`Scoped sync is large (${scopeSkus!.length} SKUs) — using bulk warehouse fetch`);
      }
      console.log(`Fetching from Mintsoft: ${stockUrl}`);
      const stockResponse = await fetch(stockUrl, {
        headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
      });
      if (!stockResponse.ok) {
        throw new Error(`Mintsoft API error: ${stockResponse.status} ${stockResponse.statusText}`);
      }
      stockData = await stockResponse.json();
      if (scopeSkus && scopeSkus.length > 0) {
        const scopeSet = new Set(scopeSkus);
        stockData = stockData.filter((it) => scopeSet.has(it.SKU));
        console.log(`Bulk fetch filtered down to ${stockData.length} matching stock rows`);
      }
    }
    console.log(`Received ${stockData.length} stock items from Mintsoft`);

    // Build a SKU set we already track
    const knownSkus = new Set(products.map((p) => p.sku));
    const scopeSkuSet = scopeSkus ? new Set(scopeSkus) : null;
    const now = new Date().toISOString();

    // For scoped syncs, we may receive SKUs that do not yet exist locally.
    // Seed those as lightweight stub rows so stock can still land. For full syncs,
    // only touch rows that already exist in products_cache.
    const candidateSkus = Array.from(new Set(
      stockData
        .map((it) => it.SKU)
        .filter((sku) => scopeSkuSet ? scopeSkuSet.has(sku) : knownSkus.has(sku))
    ));
    const existingSkus = new Set<string>();
    const existingNames = new Map<string, string>();
    if (candidateSkus.length > 0) {
      const chunk = 500;
      for (let i = 0; i < candidateSkus.length; i += chunk) {
        const slice = candidateSkus.slice(i, i + chunk);
        const { data: existing, error: exErr } = await supabase
          .from("products_cache")
          .select("sku, name")
          .in("sku", slice);
        if (exErr) throw exErr;
        for (const r of existing || []) {
          existingSkus.add(r.sku);
          existingNames.set(r.sku, r.name);
        }
      }
    }

    const missingSkus = candidateSkus.filter((s) => !existingSkus.has(s));
    let stubsCreated = 0;
    if (missingSkus.length > 0) {
      console.log(`Creating ${missingSkus.length} stub product rows for new SKUs...`);
      const stubs = missingSkus.map((sku) => ({
        sku,
        name: sku, // placeholder; enrich-batch will overwrite with real name
        discovery_source: "stock_sync_stub",
      }));
      const { error: stubErr, data: stubData } = await supabase
        .from("products_cache")
        .insert(stubs)
        .select("sku");
      if (stubErr) {
        console.error("Stub insert error:", stubErr.message);
      } else {
        stubsCreated = stubData?.length ?? missingSkus.length;
        for (const s of missingSkus) {
          existingSkus.add(s);
          existingNames.set(s, s);
        }
      }
    }

    const updates = stockData
      .filter((it) => existingSkus.has(it.SKU))
      .map((it) => ({
        sku: it.SKU,
        name: existingNames.get(it.SKU) || it.SKU,
        current_stock: it.AvailableQuantity || 0,
        back_order_qty: it.BackOrderQuantity || 0,
        on_order: it.OnOrderQuantity || 0,
        last_stock_sync: now,
      }));

    let updated = 0;
    let lastError: string | null = null;
    const chunkSize = 250;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const slice = updates.slice(i, i + chunkSize);
      const { error: upsertErr, data: upserted } = await supabase
        .from("products_cache")
        .upsert(slice, { onConflict: "sku" })
        .select("sku");
      if (upsertErr) {
        lastError = upsertErr.message;
        console.error(`Batch upsert failed for rows ${i}-${i + slice.length - 1}:`, upsertErr.message);
      } else {
        updated += upserted?.length ?? slice.length;
      }
    }
    if (lastError) console.log(`Last update error: ${lastError}`);

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
