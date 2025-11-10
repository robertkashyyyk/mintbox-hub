import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MINTSOFT_API_KEY = Deno.env.get("MINTSOFT_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftProduct {
  SKU: string;
  Name?: string;
  AvailableQuantity?: number;
  WarehouseCode?: string;
  StockOnHand?: number;
  [key: string]: any;
}

async function fetchMintsoftInventory(apiKey: string): Promise<MintsoftProduct[]> {
  console.log("Fetching inventory from Mintsoft...");
  
  // Try WarehouseStock endpoint
  const response = await fetch("https://api.mintsoft.co.uk/api/WarehouseStock", {
    method: "POST",
    headers: {
      "APIKey": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      PageNo: 1,
      Limit: 10000
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Mintsoft inventory fetch failed:", response.status, errorText);
    throw new Error(`Failed to fetch inventory: ${response.status} - ${errorText}`);
  }

  const products: MintsoftProduct[] = await response.json();
  console.log(`Fetched ${products.length} products from Mintsoft`);
  return products;
}

function extractBrandFromSKU(sku: string): string | null {
  const match = sku.match(/^([A-Z]{2,4})-/);
  return match ? match[1] : null;
}

async function syncInventoryToDatabase(products: MintsoftProduct[]) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  
  // Get brand configurations
  const { data: brands, error: brandError } = await supabase
    .from("brands")
    .select("name, prefix, prefix_style")
    .not("prefix", "is", null);
  
  if (brandError) {
    console.error("Error fetching brands:", brandError);
    throw brandError;
  }

  // Create prefix map with full prefix (including separator)
  const prefixMap = new Map(
    brands?.map(b => {
      const separator = b.prefix_style === 'slash' ? '/' : '-';
      const fullPrefix = `${b.prefix}${separator}`;
      return [fullPrefix, b.name];
    }) || []
  );

  // Create a synthetic email record for this sync
  const emailData = {
    message_id: `mintsoft-api-sync-${Date.now()}`,
    thread_id: `mintsoft-api-sync-${Date.now()}`,
    subject: "Mintsoft API Inventory Sync",
    sender: "api@mintsoft.co.uk",
    received_at: new Date().toISOString(),
    body: "Automated inventory sync from Mintsoft API",
    labels: ["api-sync", "inventory"],
  };

  const { data: email, error: emailError } = await supabase
    .from("emails")
    .upsert(emailData, { onConflict: "message_id" })
    .select()
    .single();

  if (emailError) {
    console.error("Error creating email record:", emailError);
    throw emailError;
  }

  console.log(`Created email record: ${email.id}`);

  // Parse and insert inventory items - only for brands we track
  const items = products
    .map(product => {
      const sku = product.SKU || "";
      
      // Check if SKU starts with any of our tracked prefixes
      let brandName = null;
      let skuCore = sku;
      
      for (const [fullPrefix, name] of prefixMap.entries()) {
        if (sku.startsWith(fullPrefix)) {
          brandName = name;
          skuCore = sku.substring(fullPrefix.length);
          break;
        }
      }
      
      // Only include items that match our tracked brands
      if (!brandName) return null;
      
      return {
        email_id: email.id,
        report_type: "Inventory",
        sku: sku,
        sku_core: skuCore,
        brand_name: brandName,
        qty: product.AvailableQuantity || product.StockOnHand || 0,
        warehouse: product.WarehouseCode || "Main",
        occurred_at: email.received_at,
        raw: product,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  // Insert in batches to avoid memory issues
  const batchSize = 1000;
  let insertedCount = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    const { error: insertError } = await supabase
      .from("parsed_items")
      .insert(batch);

    if (insertError) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, insertError);
      throw insertError;
    }

    insertedCount += batch.length;
    console.log(`Inserted ${insertedCount} / ${items.length} items`);
  }

  // Log the sync
  await supabase.from("ingest_logs").insert({
    source: "mintsoft-api",
    status: "success",
    detail: `Synced ${items.length} products from Mintsoft API`,
  });

  console.log(`Successfully synced ${items.length} inventory items`);
  
  return { itemsCount: items.length, emailId: email.id };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!MINTSOFT_API_KEY) {
      throw new Error("Mintsoft API key not configured");
    }

    console.log("Starting Mintsoft inventory sync...");

    // Fetch inventory using static API key
    const products = await fetchMintsoftInventory(MINTSOFT_API_KEY);

    // Sync to database
    const result = await syncInventoryToDatabase(products);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Inventory synced successfully",
        ...result,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Mintsoft sync error:", error);
    
    // Log the failure
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabase.from("ingest_logs").insert({
      source: "mintsoft-api",
      status: "error",
      detail: error instanceof Error ? error.message : "Unknown error",
    });

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
