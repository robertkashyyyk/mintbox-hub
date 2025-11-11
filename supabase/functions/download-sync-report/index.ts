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
    
    // Get job details
    const { data: job, error: jobError } = await supabase
      .from('sync_jobs')
      .select('*, brands(name)')
      .eq('id', job_id)
      .single();
    
    if (jobError || !job) {
      throw new Error(`Job not found: ${job_id}`);
    }
    
    if (job.status !== 'complete') {
      throw new Error('Can only download reports for completed syncs');
    }
    
    // Get the email_id that was created for this sync
    const messageId = `inventory-${job_id}`;
    const { data: email, error: emailError } = await supabase
      .from('emails')
      .select('id')
      .eq('message_id', messageId)
      .single();
    
    if (emailError || !email) {
      throw new Error('Email record not found for this sync');
    }
    
    // Get parsed items for this sync
    const { data: items, error: itemsError } = await supabase
      .from('parsed_items')
      .select('*')
      .eq('email_id', email.id)
      .order('sku');
    
    if (itemsError) throw itemsError;
    
    if (!items || items.length === 0) {
      throw new Error('No items found for this sync');
    }
    
    console.log(`Found ${items.length} items for job ${job_id}`);
    
    // Generate CSV based on format
    let csvContent: string;
    let filename: string;
    
    if (format === 'mintsoft') {
      // Mintsoft format (placeholder - you'll provide actual format later)
      csvContent = 'SKU,Quantity,Warehouse\n';
      items.forEach(item => {
        csvContent += `${item.sku},${item.qty || 0},${item.warehouse || 'N/A'}\n`;
      });
      filename = `${job.brands.name}_Mintsoft_${new Date().toISOString().split('T')[0]}.csv`;
    } else {
      // External format (placeholder - you'll provide actual format later)
      csvContent = 'SKU,Brand,Quantity,Warehouse,Occurred At\n';
      items.forEach(item => {
        csvContent += `${item.sku},${item.brand_name || 'N/A'},${item.qty || 0},${item.warehouse || 'N/A'},${item.occurred_at}\n`;
      });
      filename = `${job.brands.name}_External_${new Date().toISOString().split('T')[0]}.csv`;
    }
    
    console.log(`Generated ${format} report with ${items.length} items`);
    
    return new Response(
      JSON.stringify({ 
        content: csvContent,
        filename: filename,
        items_count: items.length
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
