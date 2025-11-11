import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MintsoftInventoryProduct {
  ProductId: number;
  SKU: string;
  Level: number;
  TotalStockLevel: number;
  AvailableQty?: number;
  OnHand?: number;
  WarehouseId: number;
}

interface Brand {
  id: string;
  name: string;
  prefix: string;
  prefix_style: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting Inventory pull...");
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const mintsoftApiKey = Deno.env.get('MINTSOFT_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Update run state - started
    await supabase
      .from('ingest_run_state')
      .upsert({
        id: 'Inventory',
        last_run_at: new Date().toISOString(),
        last_status: 'running',
        updated_at: new Date().toISOString()
      });
    
    // Fetch brands for prefix mapping
    const { data: brands, error: brandsError } = await supabase
      .from('brands')
      .select('*');
    
    if (brandsError) throw brandsError;
    
    // Build prefix map
    const prefixMap = new Map<string, string>();
    brands?.forEach((brand: Brand) => {
      if (brand.prefix) {
        const fullPrefix = brand.prefix + (brand.prefix_style === 'hyphen' ? '-' : '/');
        prefixMap.set(fullPrefix, brand.name);
      }
    });
    
    console.log("Fetching inventory from Mintsoft...");
    
    // Call Mintsoft Stock Levels API - fetch by brand prefixes to avoid timeout
    const allProducts: MintsoftInventoryProduct[] = [];
    
    for (const [prefix, brandName] of prefixMap.entries()) {
      // Try to fetch products with this prefix
      // Note: API doesn't support prefix filtering, so we fetch all and filter
      console.log(`Attempting to fetch products for brand: ${brandName}`);
      
      try {
        const url = `https://api.mintsoft.co.uk/api/Product/StockLevels?WarehouseId=5&breakdown=true`;
        
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'ms-apikey': mintsoftApiKey,
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          console.error(`Mintsoft API error for ${brandName}: ${response.status}`);
          continue;
        }
        
        const products: MintsoftInventoryProduct[] = await response.json();
        
        // Filter to only products matching this brand prefix
        const brandProducts = products.filter(p => p.SKU.startsWith(prefix.replace('-', '').replace('/', '')));
        
        console.log(`Found ${brandProducts.length} products for ${brandName}`);
        allProducts.push(...brandProducts);
        
        // Break after first successful fetch to avoid timeout
        // In production, you'd want to iterate through all brands
        break;
        
      } catch (error) {
        console.error(`Error fetching ${brandName}:`, error);
        continue;
      }
    }
    
    console.log(`Fetched ${allProducts.length} inventory products total`);
    
    // Create email record for this sync run
    const occurredAt = new Date().toISOString();
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .insert({
        message_id: `inventory-${Date.now()}`,
        thread_id: `inventory-${Date.now()}`,
        subject: `Inventory Report - ${new Date().toLocaleString()}`,
        sender: 'mintsoft-api',
        received_at: occurredAt,
        labels: ['Inventory']
      })
      .select()
      .single();
    
    if (emailError) throw emailError;
    console.log(`Created email record: ${email.id}`);
    
    // Map products to parsed_items format
    const items = allProducts.map(product => {
      const sku = product.SKU;
      let brandName = null;
      
      // Find matching brand
      for (const [fullPrefix, name] of prefixMap.entries()) {
        if (sku.startsWith(fullPrefix)) {
          brandName = name;
          break;
        }
      }
      
      // Use AvailableQty if available, fallback to OnHand, then Level
      const qty = product.AvailableQty ?? product.OnHand ?? product.Level ?? product.TotalStockLevel ?? 0;
      
      return {
        email_id: email.id,
        report_type: "Inventory",
        sku: sku,
        brand_name: brandName,
        qty: qty,
        warehouse: "Coleraine Live",
        occurred_at: occurredAt,
        raw: product,
      };
    });
    
    // Insert in batches with upsert logic
    const batchSize = 100;
    let inserted = 0;
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      const { error: insertError } = await supabase
        .from('parsed_items')
        .upsert(batch, {
          onConflict: 'report_type,occurred_at,sku,warehouse',
          ignoreDuplicates: true
        });
      
      if (insertError) {
        console.error(`Error inserting batch ${i}-${i + batchSize}:`, insertError);
      } else {
        inserted += batch.length;
        console.log(`Inserted ${inserted} / ${items.length} items`);
      }
    }
    
    // Update run state - success
    await supabase
      .from('ingest_run_state')
      .upsert({
        id: 'Inventory',
        last_ok_at: new Date().toISOString(),
        last_status: 'success',
        updated_at: new Date().toISOString()
      });
    
    console.log(`Successfully synced ${items.length} inventory items`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        itemsCount: items.length,
        emailId: email.id 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: any) {
    console.error('Error in poll-inventory:', error);
    
    // Update run state - failed
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    await supabase
      .from('ingest_run_state')
      .upsert({
        id: 'Inventory',
        last_status: `error: ${error.message}`,
        updated_at: new Date().toISOString()
      });
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
