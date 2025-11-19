import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.80.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate API key
    const apiKey = req.headers.get('x-api-key');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'API key required' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify API key
    const { data: keyData, error: keyError } = await supabaseClient
      .from('api_keys')
      .select('id, active')
      .eq('key', apiKey)
      .eq('active', true)
      .maybeSingle();

    if (keyError || !keyData) {
      console.error('Invalid API key:', keyError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid API key' }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401,
        }
      );
    }

    // Update last_used_at
    await supabaseClient
      .from('api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyData.id);

    console.log('Fetching queued price checks...');

    // Fetch all products with ph_status = 'queued'
    const { data: products, error } = await supabaseClient
      .from('products_cache')
      .select('id, sku, ph_search_term, ph_brand')
      .eq('ph_status', 'queued')
      .order('sku');

    if (error) {
      console.error('Error fetching queued products:', error);
      throw error;
    }

    console.log(`Found ${products?.length || 0} queued products`);

    // Return the queued products
    return new Response(
      JSON.stringify({
        success: true,
        count: products?.length || 0,
        products: products || [],
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in fetch-queued-price-checks:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
