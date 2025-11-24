import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Validate API key
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: keyData, error: keyError } = await supabase
      .from('api_keys')
      .select('*')
      .eq('key', apiKey)
      .eq('active', true)
      .single();

    if (keyError || !keyData) {
      return new Response(
        JSON.stringify({ error: 'Invalid API key' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update last_used_at for the API key
    await supabase
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id);

    // Parse request body
    const { automation_id } = await req.json();

    if (!automation_id) {
      return new Response(
        JSON.stringify({ error: 'automation_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch automation
    const { data: automation, error: automationError } = await supabase
      .from('price_hunter_automations')
      .select('*')
      .eq('id', automation_id)
      .single();

    if (automationError || !automation) {
      return new Response(
        JSON.stringify({ error: 'Automation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build query for products to queue
    let query = supabase
      .from('products_cache')
      .select('id, sku')
      .eq('ph_excluded', false);

    // Filter by brand - match SKUs that start with the brand prefix
    const { data: brand, error: brandError } = await supabase
      .from('brands')
      .select('prefix, prefix_style')
      .eq('id', automation.brand_id)
      .single();

    if (brandError || !brand || !brand.prefix) {
      return new Response(
        JSON.stringify({ error: 'Brand not found or has no prefix' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const separator = brand.prefix_style === 'slash' ? '/' : '-';
    const brandPattern = `${brand.prefix}${separator}%`;
    query = query.ilike('sku', brandPattern);

    // Apply filters
    if (automation.include_only_in_stock) {
      query = query.gt('current_stock', 0);
    }

    if (automation.include_fire_sale_only) {
      query = query.eq('fire_sale', true);
    }

    const { data: products, error: productsError } = await query;

    if (productsError) {
      console.error('Error fetching products:', productsError);
      return new Response(
        JSON.stringify({ error: productsError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const productIds = products?.map(p => p.id) || [];
    const queuedCount = productIds.length;

    // Queue products
    if (queuedCount > 0) {
      const { error: updateError } = await supabase
        .from('products_cache')
        .update({
          ph_status: 'queued',
          ph_error_message: null,
        })
        .in('id', productIds);

      if (updateError) {
        console.error('Error queueing products:', updateError);
        return new Response(
          JSON.stringify({ error: updateError.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Update automation
    const now = new Date();
    const nextRunAt = new Date(now.getTime() + automation.interval_days * 24 * 60 * 60 * 1000);

    const { error: automationUpdateError } = await supabase
      .from('price_hunter_automations')
      .update({
        last_run_at: now.toISOString(),
        last_run_sku_count: queuedCount,
        next_run_at: nextRunAt.toISOString(),
      })
      .eq('id', automation_id);

    if (automationUpdateError) {
      console.error('Error updating automation:', automationUpdateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        automation_id,
        queued_count: queuedCount,
        xasks_for_this_run: queuedCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unexpected error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});