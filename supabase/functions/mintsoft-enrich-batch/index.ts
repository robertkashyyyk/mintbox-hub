import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ProductToEnrich {
  id: string;
  sku: string;
  mintsoft_product_id: number;
  cost_price_source?: string | null;
}

interface MintsoftProductDetails {
  ID: number;
  SKU: string;
  Name: string;
  CostPrice?: number;
  Weight?: number;
  Height?: number;
  Length?: number;
  Depth?: number;
  EAN?: string;
  UPC?: string;
  LowStockAlertLevel?: number;
  HandlingTime?: number;
  Discontinued?: boolean;
}

const BATCH_SIZE = 500;
const STALE_DAYS = 7;

interface Brand {
  id: string;
  prefix: string;
  prefix_style: "hyphen" | "slash" | null;
}

function resolveBrandId(sku: string, brands: Brand[]): string | null {
  for (const brand of brands) {
    if (!brand.prefix) continue;
    const separator = brand.prefix_style === "slash" ? "/" : "-";
    if (sku.startsWith(`${brand.prefix}${separator}`)) {
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const mintsoftApiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftApiKey) {
      throw new Error("MINTSOFT_API_KEY not configured");
    }

    // Get Mintsoft settings
    const { data: settings, error: settingsError } = await supabase
      .from("mintsoft_settings")
      .select("base_url")
      .single();

    if (settingsError || !settings?.base_url) {
      throw new Error("Mintsoft settings not configured");
    }

    console.log("Starting enrichment batch...");

    // Fetch all brands for prefix matching
    const { data: brands } = await supabase
      .from("brands")
      .select("id, prefix, prefix_style")
      .not("prefix", "is", null);

    const brandList: Brand[] = brands || [];
    console.log(`Loaded ${brandList.length} brands for prefix matching`);

    // Find products needing enrichment:
    // 1. Has mintsoft_product_id but never synced (last_stock_sync IS NULL)
    // 2. Or last_stock_sync is stale (> 7 days old)
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - STALE_DAYS);

    // Optional { prefix } body → targeted enrichment of one brand/prefix (e.g. "NBA-"),
    // ignoring the staleness filter so it re-enriches the whole prefix in one pass.
    let prefix: string | null = null;
    try { prefix = (await req.json())?.prefix ?? null; } catch { /* no body = scheduled run */ }

    let query = supabase
      .from("products_cache")
      .select("id, sku, mintsoft_product_id, cost_price_source")
      .not("mintsoft_product_id", "is", null);
    if (prefix) {
      query = query.ilike("sku", `${prefix}%`);
    } else {
      query = query.or(`last_stock_sync.is.null,last_stock_sync.lt.${staleDate.toISOString()}`);
    }
    // Order by staleness always (oldest/never-synced first) so repeated runs drain a
    // prefix that's larger than one edge run can finish, without redoing fresh ones.
    query = query.order("last_stock_sync", { ascending: true, nullsFirst: true });
    const { data: products, error: productsError } = await query.limit(BATCH_SIZE);

    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`);
    }

    if (!products || products.length === 0) {
      console.log("No products need enrichment");
      
      // Update ingest state
      await supabase
        .from("ingest_run_state")
        .upsert({
          id: "mintsoft_enrich_batch",
          last_run_at: new Date().toISOString(),
          last_ok_at: new Date().toISOString(),
          last_status: "ok - no products needed",
          updated_at: new Date().toISOString(),
        });

      return new Response(
        JSON.stringify({ message: "No products need enrichment", enriched: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${products.length} products to enrich`);

    let enrichedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Process each product
    for (const product of products as ProductToEnrich[]) {
      try {
        // Fetch product details from Mintsoft
        const productUrl = `${settings.base_url}/api/Product/${product.mintsoft_product_id}`;
        
        const response = await fetch(productUrl, {
          headers: {
            "ms-apikey": mintsoftApiKey,
            "Accept": "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Mintsoft API error for ${product.sku}: ${response.status} - ${errorText}`);
          errors.push(`${product.sku}: ${response.status}`);
          errorCount++;

          // 404 means the Mintsoft product was deleted/merged. Mark as discontinued
          // and stamp last_stock_sync so it stops cycling through every batch forever.
          if (response.status === 404) {
            await supabase
              .from("products_cache")
              .update({
                discontinued: true,
                last_stock_sync: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id);
          }
          continue;
        }

        const productDetails: MintsoftProductDetails = await response.json();

        // Now fetch inventory for stock levels
        const inventoryUrl = `${settings.base_url}/api/Product/${product.mintsoft_product_id}/Inventory?breakdown=true`;
        let currentStock = 0;
        let onOrder = 0;
        let backOrderQty = 0;
        let inventoryOk = false;  // only overwrite stock when we actually read inventory

        try {
          const inventoryResponse = await fetch(inventoryUrl, {
            headers: {
              "ms-apikey": mintsoftApiKey,
              "Accept": "application/json",
            },
          });

          if (inventoryResponse.ok) {
            const inventoryData = await inventoryResponse.json();
            if (Array.isArray(inventoryData)) {
              inventoryOk = true;
              // current_stock = our Coleraine warehouse (WarehouseId=5) StockLevel only.
              // on_order / back_orders are global (PO + customer demand) — sum across warehouses.
              // NB: Mintsoft Inventory fields are StockLevel / OnOrder / RequiredByBackOrder
              // (there is NO "Available"/"OnBackOrder" field — reading those zeroed real stock).
              for (const inv of inventoryData) {
                if (inv.WarehouseId === 5) {
                  currentStock += inv.StockLevel || 0;
                }
                onOrder += inv.OnOrder || 0;
                backOrderQty += inv.RequiredByBackOrder || 0;
              }
            }
          }
        } catch (invError) {
          console.warn(`Could not fetch inventory for ${product.sku}:`, invError);
        }

        // Determine barcode (Mintsoft has separate EAN/UPC fields)
        let barcode = productDetails.EAN || productDetails.UPC || null;
        let barcodeTypeId: string | null = null;

        if (barcode) {
          barcode = barcode.replace(/\D/g, "");
          
          // Get barcode type based on length
          const { data: barcodeTypes } = await supabase
            .from("barcode_types")
            .select("id, digit_count")
            .or(`digit_count.eq.${barcode.length},type_name.eq.Other`);

          if (barcodeTypes && barcodeTypes.length > 0) {
            const exactMatch = barcodeTypes.find(bt => bt.digit_count === barcode!.length);
            barcodeTypeId = exactMatch?.id || barcodeTypes[0]?.id || null;
          }
        }

        // Resolve brand_id from SKU prefix
        const brandId = resolveBrandId(product.sku, brandList);

        // Extract Mintsoft categories — API may return Categories: [{Name}] or [string]
        let mintsoftCategories: string[] = [];
        const rawCats = (productDetails as any).Categories ?? (productDetails as any).ProductCategories;
        if (Array.isArray(rawCats)) {
          mintsoftCategories = rawCats
            .map((c: any) => {
              if (typeof c === "string") return c;
              if (c && typeof c === "object") return c.Name ?? c.CategoryName ?? c.name ?? null;
              return null;
            })
            .filter((s: any): s is string => typeof s === "string" && s.trim().length > 0)
            .map((s: string) => s.trim());
          // de-duplicate, preserve order
          mintsoftCategories = Array.from(new Set(mintsoftCategories));
        }

        // Guard: never overwrite a manually-edited cost price.
        // If user set it via the UI, we keep their value regardless of what Mintsoft returns.
        const preserveManualCost = product.cost_price_source === "manual_ui";
        const incomingCost = productDetails.CostPrice ?? null;

        // Update product with enriched data
        const updatePayload: Record<string, unknown> = {
            name: productDetails.Name || product.sku,
            // Mintsoft weight is in KG; the Hub convention is GRAMS (dims search + the push
            // both use grams) — so convert kg -> g on the way in.
            weight: productDetails.Weight ? Number(productDetails.Weight) * 1000 : null,
            height: productDetails.Height || null,
            // Mintsoft holds the length dimension in 'Width' (documented quirk). Prefer Width,
            // fall back to Length for any product that bucked the quirk.
            length: productDetails.Width ?? productDetails.Length ?? null,
            depth: productDetails.Depth || null,
            barcode: barcode,
            barcode_type_id: barcodeTypeId,
            low_stock_alert_level: productDetails.LowStockAlertLevel || 0,
            handling_time: productDetails.HandlingTime || null,
            discontinued: productDetails.Discontinued || false,
            brand_id: brandId,
            mintsoft_categories: mintsoftCategories,
            last_stock_sync: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };

        // Only overwrite stock fields when the inventory read actually succeeded —
        // never zero real stock because a fetch failed or returned an unexpected shape.
        if (inventoryOk) {
          updatePayload.current_stock = currentStock;
          updatePayload.on_order = onOrder;
          updatePayload.back_order_qty = backOrderQty;
        }

        // Only set cost_price when not preserving a manual edit, and only if we got a value
        if (!preserveManualCost && incomingCost !== null) {
          updatePayload.cost_price = incomingCost;
          updatePayload.cost_price_updated_at = new Date().toISOString();
          updatePayload.cost_price_source = "mintsoft_sync";
        }

        const { error: updateError } = await supabase
          .from("products_cache")
          .update(updatePayload)
          .eq("id", product.id);

        if (updateError) {
          console.error(`Failed to update ${product.sku}:`, updateError);
          errors.push(`${product.sku}: update failed`);
          errorCount++;
        } else {
          enrichedCount++;
          console.log(`Enriched ${product.sku}`);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (productError) {
        console.error(`Error processing ${product.sku}:`, productError);
        errors.push(`${product.sku}: ${productError instanceof Error ? productError.message : "unknown error"}`);
        errorCount++;
      }
    }

    // Update ingest state
    const status = errorCount === 0 
      ? `ok - enriched ${enrichedCount} products`
      : `partial - enriched ${enrichedCount}, errors: ${errorCount}`;

    await supabase
      .from("ingest_run_state")
      .upsert({
        id: "mintsoft_enrich_batch",
        last_run_at: new Date().toISOString(),
        last_ok_at: errorCount === 0 ? new Date().toISOString() : undefined,
        last_status: status,
        updated_at: new Date().toISOString(),
      });

    console.log(`Enrichment complete: ${enrichedCount} enriched, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        message: "Enrichment batch complete",
        enriched: enrichedCount,
        errors: errorCount,
        errorDetails: errors.slice(0, 10), // Return first 10 errors
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Enrichment batch failed:", error);
    
    // Try to update ingest state with error
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      
      await supabase
        .from("ingest_run_state")
        .upsert({
          id: "mintsoft_enrich_batch",
          last_run_at: new Date().toISOString(),
          last_status: `error: ${error instanceof Error ? error.message : "unknown"}`,
          updated_at: new Date().toISOString(),
        });
    } catch {}

    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
