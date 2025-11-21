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

    // Parse the request body
    const body = await req.json();
    console.log('Received price check update:', body);

    const {
      id,
      ph_status,
      ph_last_checked_at,
      ph_plain_best_price,
      ph_plain_best_seller,
      ph_plain_best_item_id,
      ph_brand_best_price,
      ph_brand_best_seller,
      ph_brand_best_item_id,
      ph_our_best_price,
      ph_our_best_seller,
      ph_our_best_item_id,
      ph_error_message,
    } = body;

    // Validate required fields
    if (!id) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required field: id',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }

    // Build update object (only include fields that are provided)
    const updateData: any = {};
    if (ph_status !== undefined) updateData.ph_status = ph_status;
    if (ph_last_checked_at !== undefined) updateData.ph_last_checked_at = ph_last_checked_at;
    if (ph_plain_best_price !== undefined) updateData.ph_plain_best_price = ph_plain_best_price;
    if (ph_plain_best_seller !== undefined) updateData.ph_plain_best_seller = ph_plain_best_seller;
    if (ph_plain_best_item_id !== undefined) updateData.ph_plain_best_item_id = ph_plain_best_item_id;
    if (ph_brand_best_price !== undefined) updateData.ph_brand_best_price = ph_brand_best_price;
    if (ph_brand_best_seller !== undefined) updateData.ph_brand_best_seller = ph_brand_best_seller;
    if (ph_brand_best_item_id !== undefined) updateData.ph_brand_best_item_id = ph_brand_best_item_id;
    if (ph_our_best_price !== undefined) updateData.ph_our_best_price = ph_our_best_price;
    if (ph_our_best_seller !== undefined) updateData.ph_our_best_seller = ph_our_best_seller;
    if (ph_our_best_item_id !== undefined) updateData.ph_our_best_item_id = ph_our_best_item_id;
    if (ph_error_message !== undefined) updateData.ph_error_message = ph_error_message;

    console.log('Updating product with data:', updateData);

    // Update the product
    const { data, error } = await supabaseClient
      .from('products_cache')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating product:', error);
      throw error;
    }

    console.log('Product updated successfully:', data);

    return new Response(
      JSON.stringify({
        success: true,
        product: data,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in update-price-check-results:', error);
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
