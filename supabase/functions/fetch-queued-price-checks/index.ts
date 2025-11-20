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

    // Fetch brands for matching
    const { data: brands, error: brandsError } = await supabaseClient
      .from('brands')
      .select('name, prefix, prefix_style');

    if (brandsError) {
      console.error('Error fetching brands:', brandsError);
      throw brandsError;
    }

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

    // Helper function to derive ph_brand and ph_search_term
    const deriveBrandAndSearchTerm = (sku: string) => {
      const matchingBrand = brands?.find((brand) => {
        if (!brand.prefix) return false;
        const separator = brand.prefix_style === 'slash' ? '/' : '-';
        const pattern = `${brand.prefix}${separator}`;
        return sku.startsWith(pattern);
      });

      if (!matchingBrand) {
        return { ph_brand: null, ph_search_term: sku };
      }

      const separator = matchingBrand.prefix_style === 'slash' ? '/' : '-';
      const parts = sku.split(separator);
      const searchTerm = parts.length > 1 ? parts.slice(1).join(separator) : sku;

      return {
        ph_brand: matchingBrand.name,
        ph_search_term: searchTerm,
      };
    };

    // Auto-backfill null ph_brand or ph_search_term
    const processedProducts = products?.map((product) => {
      let needsUpdate = false;
      let ph_brand = product.ph_brand;
      let ph_search_term = product.ph_search_term;

      if (!ph_brand || !ph_search_term) {
        const derived = deriveBrandAndSearchTerm(product.sku);
        if (!ph_brand && derived.ph_brand) {
          ph_brand = derived.ph_brand;
          needsUpdate = true;
        }
        if (!ph_search_term && derived.ph_search_term) {
          ph_search_term = derived.ph_search_term;
          needsUpdate = true;
        }

        // Update the database if we backfilled
        if (needsUpdate) {
          supabaseClient
            .from('products_cache')
            .update({ ph_brand, ph_search_term })
            .eq('id', product.id)
            .then(({ error: updateError }) => {
              if (updateError) {
                console.error(`Error backfilling product ${product.id}:`, updateError);
              }
            });
        }
      }

      return {
        id: product.id,
        sku: product.sku,
        ph_brand,
        ph_search_term,
      };
    }) || [];

    // Return the queued products with backfilled data
    return new Response(
      JSON.stringify({
        success: true,
        count: processedProducts.length,
        products: processedProducts,
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
