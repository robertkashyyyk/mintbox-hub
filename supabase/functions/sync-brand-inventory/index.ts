import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";

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
        
        console.log(`Fetching inventory for brand: ${job.brands.name}`);
        
        // Build brand prefix
        const brandPrefix = job.brands.prefix + (job.brands.prefix_style === 'hyphen' ? '-' : '/');
        
        // Fetch inventory from Mintsoft
        const url = `https://api.mintsoft.co.uk/api/Product/StockLevels?WarehouseId=5&breakdown=true`;
        
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
        
        const allProducts: MintsoftInventoryProduct[] = await response.json();
        
        // Filter to only products matching this brand prefix
        const brandProducts = allProducts.filter(p => 
          p.SKU.startsWith(brandPrefix.replace('-', '').replace('/', ''))
        );
        
        console.log(`Found ${brandProducts.length} products for ${job.brands.name}`);
        
        // Create email record for this sync
        const occurredAt = new Date().toISOString();
        const { data: email, error: emailError } = await supabase
          .from('emails')
          .insert({
            message_id: `inventory-${job_id}`,
            thread_id: `inventory-${job_id}`,
            subject: `Inventory Sync - ${job.brands.name}`,
            sender: 'sync-job',
            received_at: occurredAt,
            labels: ['Inventory', job.brands.name]
          })
          .select()
          .single();
        
        if (emailError) throw emailError;
        
        // Map products to parsed_items format
        const items = brandProducts.map(product => {
          const qty = product.AvailableQty ?? product.OnHand ?? product.Level ?? product.TotalStockLevel ?? 0;
          
          return {
            email_id: email.id,
            report_type: job.report_type,
            sku: product.SKU,
            brand_name: job.brands.name,
            qty: qty,
            warehouse: "Coleraine Live",
            occurred_at: occurredAt,
            raw: product,
          };
        });
        
        // Insert in batches
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
            console.error(`Error inserting batch:`, insertError);
          } else {
            inserted += batch.length;
            console.log(`Inserted ${inserted} / ${items.length} items`);
          }
        }
        
        // Update job status to complete
        await supabase
          .from('sync_jobs')
          .update({ 
            status: 'complete',
            items_count: items.length,
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', job_id);
        
        // Create notification
        await supabase
          .from('notifications')
          .insert({
            user_id: job.user_id,
            title: 'Sync Complete',
            message: `Successfully synced ${items.length} items for ${job.brands.name}`,
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
            from: 'Inventory Sync <onboarding@resend.dev>',
            to: [userEmail],
            subject: `✅ Inventory Sync Complete - ${job.brands.name}`,
            html: `
              <h1>Inventory Sync Completed</h1>
              <p>Your inventory sync for <strong>${job.brands.name}</strong> has finished successfully.</p>
              <p><strong>Details:</strong></p>
              <ul>
                <li>Brand: ${job.brands.name}</li>
                <li>Items Processed: ${items.length}</li>
                <li>Completed: ${completedTime}</li>
              </ul>
              <p>You can view the updated inventory in your <a href="${supabaseUrl.replace('https://zadsuqxcchpnegcynflb.supabase.co', 'your-app-url')}/dashboard">dashboard</a>.</p>
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
