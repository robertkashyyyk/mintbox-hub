import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MintsoftLowStockProduct {
  ProductId: number;
  SKU: string;
  Level: number;
  LowStockLevel: number;
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
    console.log("Starting LowStock pull...");
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const mintsoftApiKey = Deno.env.get('MINTSOFT_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Update run state - started
    await supabase
      .from('ingest_run_state')
      .upsert({
        id: 'LowStock',
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
    
    console.log("Fetching low stock from Mintsoft...");
    
    // Call Mintsoft Low Stock API
    const url = `https://api.mintsoft.co.uk/api/Product/LowStock?WarehouseId=5`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'ms-apikey': mintsoftApiKey,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Mintsoft API error: ${response.status} ${response.statusText}`);
    }
    
    const products: MintsoftLowStockProduct[] = await response.json();
    console.log(`Fetched ${products.length} low stock products`);
    
    // Create email record for this sync run
    const occurredAt = new Date().toISOString();
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .insert({
        message_id: `lowstock-${Date.now()}`,
        thread_id: `lowstock-${Date.now()}`,
        subject: `Low Stock Report - ${new Date().toLocaleString()}`,
        sender: 'mintsoft-api',
        received_at: occurredAt,
        labels: ['LowStock']
      })
      .select()
      .single();
    
    if (emailError) throw emailError;
    console.log(`Created email record: ${email.id}`);
    
    // Map products to parsed_items format
    const items = products.map(product => {
      const sku = product.SKU;
      let brandName = null;
      
      // Find matching brand
      for (const [fullPrefix, name] of prefixMap.entries()) {
        if (sku.startsWith(fullPrefix)) {
          brandName = name;
          break;
        }
      }
      
      return {
        email_id: email.id,
        report_type: "LowStock",
        sku: sku,
        brand_name: brandName,
        qty: product.Level || 0,
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
        id: 'LowStock',
        last_ok_at: new Date().toISOString(),
        last_status: 'success',
        updated_at: new Date().toISOString()
      });
    
    console.log(`Successfully synced ${items.length} low stock items`);
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        itemsCount: items.length,
        emailId: email.id 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: any) {
    console.error('Error in poll-lowstock:', error);
    
    // Update run state - failed
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    await supabase
      .from('ingest_run_state')
      .upsert({
        id: 'LowStock',
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
