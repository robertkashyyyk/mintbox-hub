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
  ProductId?: number;
  WarehouseId?: number;
  Name?: string;
  Level?: number;
  TotalStockLevel?: number;
  LowStockLevel?: number;
  LastUpdated?: string;
  Breakdown?: Array<{
    Quantity: number;
    BatchNo?: string;
    SerialNo?: string;
    BestBefore?: string;
    Type?: string;
  }>;
  [key: string]: any;
}

interface Brand {
  name: string;
  prefix: string;
  prefix_style: string;
}

async function fetchMintsoftInventoryByBrands(apiKey: string, brands: Brand[]): Promise<MintsoftProduct[]> {
  console.log(`Testing with single SKU: NGK-02412`);
  
  // Test with single SKU first
  const url = "https://api.mintsoft.co.uk/api/Product/StockLevels?WarehouseId=5&breakdown=true&SKU=NGK-02412";
  console.log("Calling URL:", url);
  
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "ms-apikey": apiKey,
      "Content-Type": "application/json",
    },
  });

  console.log("Response status:", response.status);
  
  if (!response.ok) {
    const errorText = await response.text();
    console.error("Mintsoft inventory fetch failed:", response.status, errorText);
    throw new Error(`Failed to fetch inventory: ${response.status} - ${errorText}`);
  }

  const products: MintsoftProduct[] = await response.json();
  console.log(`Response:`, JSON.stringify(products, null, 2));
  console.log(`Fetched ${products.length} products`);
  
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

  // Parse and insert inventory items
  const items = products.map(product => {
    const sku = product.SKU || "";
    
    // Find matching brand
    let brandName = null;
    
    for (const [fullPrefix, name] of prefixMap.entries()) {
      if (sku.startsWith(fullPrefix)) {
        brandName = name;
        break;
      }
    }
    
    return {
      email_id: email.id,
      report_type: "Inventory",
      sku: sku,
      // Don't include sku_core - it's a generated column
      brand_name: brandName,
      qty: product.Level || product.TotalStockLevel || 0,
      warehouse: "Coleraine Live",
      occurred_at: email.received_at,
      raw: product,
    };
  });

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

    // Get brands first
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: brands } = await supabase
      .from("brands")
      .select("name, prefix, prefix_style")
      .not("prefix", "is", null);

    if (!brands || brands.length === 0) {
      throw new Error("No brands configured");
    }

    // Fetch inventory (filtered by brands on client side to reduce data)
    const products = await fetchMintsoftInventoryByBrands(MINTSOFT_API_KEY, brands);

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
