import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MintsoftStockItem {
  SKU: string;
  AvailableQuantity: number;
  BackOrderQuantity: number;
  OnOrderQuantity: number;
  WarehouseId: number;
}

// Simple retry with exponential backoff
async function fetchWithRetry(url: string, init: RequestInit, retries = 3, baseDelayMs = 800): Promise<Response> {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= retries) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      // Try to capture response text for better diagnostics
      const text = await res.text().catch(() => "");
      lastErr = new Error(`Mintsoft API error: ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
      // Only retry on 5xx
      if (res.status < 500 || res.status >= 600) break;
    } catch (e) {
      lastErr = e;
    }
    const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
    console.log(`Retrying Mintsoft request (attempt ${attempt + 1} of ${retries}) after ${delay}ms due to:`, lastErr?.message || lastErr);
    await new Promise((r) => setTimeout(r, delay));
    attempt++;
  }
  throw lastErr ?? new Error("Unknown Mintsoft API error");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id } = await req.json();
    
    if (!job_id) {
      throw new Error('job_id is required');
    }
    
    console.log(`Processing sync job: ${job_id}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const mintsoftApiKey = Deno.env.get('MINTSOFT_API_KEY')!;
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Background task for the actual sync work
    const syncTask = async () => {
      try {
        const resend = new Resend(resendApiKey);
        
        // Get job details
        const { data: job, error: jobError } = await supabase
          .from('sync_jobs')
          .select('*, brands(*)')
          .eq('id', job_id)
          .single();
        
        if (jobError || !job) {
          console.error('Job fetch error:', jobError);
          throw new Error(`Job not found: ${job_id}`);
        }
        
        // Update job status to processing
        await supabase
          .from('sync_jobs')
          .update({ 
            status: 'processing',
            started_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
        
        console.log(`Fetching stock for brand: ${job.brands.name}`);
        
        // Build brand prefix pattern for database lookup
        const brandPrefix = job.brands.prefix;
        const prefixStyle = job.brands.prefix_style || 'hyphen';
        const separator = prefixStyle === 'slash' ? '/' : '-';
        const prefixPattern = `${brandPrefix}${separator}%`;
        
        // Get all products from products_cache that match this brand
        const { data: brandProducts, error: productsError } = await supabase
          .from('products_cache')
          .select('sku')
          .ilike('sku', prefixPattern);
        
        if (productsError) {
          throw productsError;
        }
        
        if (!brandProducts || brandProducts.length === 0) {
          throw new Error(`No products found in database for brand ${job.brands.name}`);
        }
        
        console.log(`Found ${brandProducts.length} products in database for ${job.brands.name}`);
        
        // Get Mintsoft settings
        const { data: settings } = await supabase
          .from('mintsoft_settings')
          .select('*')
          .limit(1)
          .single();
        
        if (!settings) {
          throw new Error('Mintsoft settings not found');
        }
        
        // Fetch stock levels from Mintsoft (WarehouseId=5 is 'Coleraine Live')
        const stockUrl = `${settings.base_url}/api/Product/StockLevels?WarehouseId=5`;
        console.log(`Fetching stock from Mintsoft...`);

        let stockResponse: Response;
        try {
          stockResponse = await fetchWithRetry(stockUrl, {
            headers: {
              'ms-apikey': mintsoftApiKey,
              'Content-Type': 'application/json',
            },
          }, 3, 800);
        } catch (e: any) {
          console.error('Mintsoft fetch failed:', e?.message || e);
          throw new Error(e?.message || 'Mintsoft API request failed');
        }

        const allStockData: MintsoftStockItem[] = await stockResponse.json();
        console.log(`Received ${allStockData.length} stock items from Mintsoft`);
        
        // Create a map of SKU to stock data for faster lookup
        const stockMap = new Map(
          allStockData.map((item) => [item.SKU, item])
        );
        
        // Update products_cache with stock data
        let updated = 0;
        const batchSize = 50;
        
        for (let i = 0; i < brandProducts.length; i += batchSize) {
          const batch = brandProducts.slice(i, i + batchSize);
          
          for (const product of batch) {
            const stockInfo = stockMap.get(product.sku);
            
            if (stockInfo) {
              const { error: updateError } = await supabase
                .from('products_cache')
                .update({
                  current_stock: stockInfo.AvailableQuantity || 0,
                  back_order_qty: stockInfo.BackOrderQuantity || 0,
                  on_order: stockInfo.OnOrderQuantity || 0,
                  last_stock_sync: new Date().toISOString(),
                })
                .eq('sku', product.sku);
              
              if (updateError) {
                console.error(`Error updating SKU ${product.sku}:`, updateError);
              } else {
                updated++;
              }
            }
          }
          
          console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(brandProducts.length / batchSize)}`);
        }
        
        console.log(`Updated ${updated} products in products_cache`);
        
        // Update job status to complete
        await supabase
          .from('sync_jobs')
          .update({ 
            status: 'complete',
            items_count: updated,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
        
        // Create notification
        await supabase
          .from('notifications')
          .insert({
            user_id: job.user_id,
            title: 'Stock Sync Complete',
            message: `Successfully synced stock for ${updated} ${job.brands.name} products`,
            type: 'success',
            link: '/dashboard'
          });
        
        // Get user email
        const { data: profile } = await supabase
          .from('profiles')
          .select('email')
          .eq('id', job.user_id)
          .single();
        
        if (!profile) {
          console.error('Profile not found for user:', job.user_id);
          throw new Error('User profile not found');
        }
        
        const userEmail = profile.email;
        const completedTime = new Date().toLocaleString('en-GB', { 
          dateStyle: 'medium', 
          timeStyle: 'short' 
        });
        
        try {
          await resend.emails.send({
            from: 'Stock Sync <noreply@updates.kashyyyk.co.uk>',
            to: [userEmail],
            subject: `✅ Stock Sync Complete - ${job.brands.name}`,
            html: `
              <h1>Stock Sync Completed</h1>
              <p>Your stock sync for <strong>${job.brands.name}</strong> has finished successfully.</p>
              <p><strong>Details:</strong></p>
              <ul>
                <li>Brand: ${job.brands.name}</li>
                <li>Products Updated: ${updated}</li>
                <li>Completed: ${completedTime}</li>
              </ul>
              <p>The stock levels in your SKU Database have been updated.</p>
            `,
          });
          console.log(`Email notification sent to ${userEmail}`);
        } catch (emailError) {
          console.error('Failed to send email notification:', emailError);
          // Don't fail the whole job if email fails
        }
        
        console.log(`Successfully completed sync job ${job_id}`);
      } catch (error: any) {
        console.error('Error in background sync task:', error);
        
        // Update job status to error
        await supabase
          .from('sync_jobs')
          .update({ 
            status: 'error',
            error_message: error.message,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
      }
    };
    
    // Start background task without awaiting
    // @ts-ignore - EdgeRuntime is available at runtime
    EdgeRuntime.waitUntil(syncTask());
    
    // Return immediate response
    return new Response(
      JSON.stringify({ 
        success: true,
        message: 'Sync job started',
        job_id: job_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: any) {
    console.error('Error in sync-brand-inventory:', error);
    
    // Update job status to error if we have job_id
    const { job_id } = await req.json().catch(() => ({}));
    if (job_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      await supabase
        .from('sync_jobs')
        .update({ 
          status: 'error',
          error_message: error.message,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', job_id);
    }
    
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
