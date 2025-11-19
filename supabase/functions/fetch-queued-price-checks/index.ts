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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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
