import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, format } = await req.json();
    
    if (!job_id || !format) {
      throw new Error('job_id and format are required');
    }
    
    if (!['mintsoft', 'external'].includes(format)) {
      throw new Error('format must be either "mintsoft" or "external"');
    }
    
    console.log(`Generating ${format} report for job: ${job_id}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get job details with brand info
    const { data: job, error: jobError } = await supabase
      .from('sync_jobs')
      .select('*, brands(*)')
      .eq('id', job_id)
      .single();
    
    if (jobError || !job) {
      throw new Error(`Job not found: ${job_id}`);
    }
    
    if (job.status !== 'complete') {
      throw new Error('Can only download reports for completed syncs');
    }
    
    // Get brand prefix details
    const brandPrefix = job.brands.prefix;
    const prefixStyle = job.brands.prefix_style || 'hyphen';
    const separator = prefixStyle === 'slash' ? '/' : '-';
    const prefixPattern = `${brandPrefix}${separator}%`;

    // Get all products for this brand with stock info
    const { data: products, error: productsError } = await supabase
      .from('products_cache')
      .select('sku, current_stock, back_order_qty, on_order, low_stock_alert_level, cost_price')
      .ilike('sku', prefixPattern);

    if (productsError) throw productsError;

    if (!products || products.length === 0) {
      throw new Error('No products found for this brand');
    }

    // Calculate quantity to order for each product
    const productsWithQty = products.map(product => {
      const backOrder = Number(product.back_order_qty) || 0;
      const currentStock = Number(product.current_stock) || 0;
      const lowStockLevel = Number(product.low_stock_alert_level) || 0;
      const onOrder = Number(product.on_order) || 0;

      const needed = Math.max(lowStockLevel - currentStock, 0);
      const qtyToOrder = Math.max(backOrder + needed - onOrder, 0);

      return {
        ...product,
        qtyToOrder
      };
    }).filter(p => p.qtyToOrder > 0); // Only include products that need ordering

    if (productsWithQty.length === 0) {
      throw new Error('No products need ordering for this brand');
    }
    
    console.log(`Found ${productsWithQty.length} products that need ordering for ${job.brands.name}`);
    
    // Generate CSV based on format
    let csvContent: string;
    let filename: string;
    
    if (format === 'mintsoft') {
      // Mintsoft format: SKU, Quantity, Price, Comments
      csvContent = 'SKU\tQuantity\tPrice\tComments\n';
      
      productsWithQty.forEach(product => {
        const price = product.cost_price ? Number(product.cost_price).toFixed(2) : '0.00';
        csvContent += `${product.sku}\t${product.qtyToOrder}\t${price}\t\n`;
      });
      
      filename = `mintsoft_order_${job.brands.name}_${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      // External format: SKU (with prefix stripped), Quantity
      csvContent = 'SKU\tQuantity\n';
      
      productsWithQty.forEach(product => {
        // Strip the brand prefix and separator from SKU
        const skuWithoutPrefix = product.sku.replace(`${brandPrefix}${separator}`, '');
        csvContent += `${skuWithoutPrefix}\t${product.qtyToOrder}\n`;
      });
      
      filename = `external_order_${job.brands.name}_${new Date().toISOString().split('T')[0]}.csv`;
    }
    
    console.log(`Generated ${format} report with ${productsWithQty.length} items`);
    
    return new Response(
      JSON.stringify({ 
        content: csvContent,
        filename: filename,
        items_count: productsWithQty.length
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json'
        } 
      }
    );
    
  } catch (error: any) {
    console.error('Error in download-sync-report:', error);
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
