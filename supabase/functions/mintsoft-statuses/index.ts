import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch Mintsoft settings
    const { data: settings, error: settingsError } = await supabase
      .from('mintsoft_settings')
      .select('base_url')
      .single();

    if (settingsError || !settings) {
      throw new Error('Mintsoft settings not configured');
    }

    const apiKey = Deno.env.get('MINTSOFT_API_KEY');
    if (!apiKey) {
      throw new Error('MINTSOFT_API_KEY not configured');
    }

    // Fetch order statuses from Mintsoft
    const statusesUrl = `${settings.base_url}/api/Order/Statuses`;
    console.log(`Fetching Mintsoft statuses from: ${statusesUrl}`);

    const response = await fetch(statusesUrl, {
      method: 'GET',
      headers: {
        'ms-apikey': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Mintsoft API error:', response.status, errorText);
      throw new Error(`Mintsoft API error: ${response.status} ${errorText}`);
    }

    const statuses = await response.json();
    console.log(`Fetched ${statuses.length} order statuses from Mintsoft`);

    return new Response(
      JSON.stringify({ statuses }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error in mintsoft-statuses function:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Failed to fetch Mintsoft order statuses'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
