import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, modelPartNumber } = await req.json();
    console.log(`eBay search requested for: ${brand} ${modelPartNumber}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get eBay credentials
    const ebayAppId = Deno.env.get('EBAY_APP_ID');
    if (!ebayAppId) {
      throw new Error('eBay credentials not configured');
    }

    // Check cache first
    const searchKey = `${brand.toLowerCase()}_${modelPartNumber.toLowerCase()}`;
    const { data: cached } = await supabase
      .from('ebay_search_cache')
      .select('*')
      .eq('search_key', searchKey)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (cached) {
      console.log('Returning cached results');
      return new Response(JSON.stringify({ success: true, data: cached, cached: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get your seller usernames
    const { data: sellers } = await supabase
      .from('ebay_seller_usernames')
      .select('username')
      .eq('active', true);

    const yourUsernames = sellers?.map(s => s.username.toLowerCase()) || [];
    console.log(`Your eBay usernames: ${yourUsernames.join(', ')}`);

    // Build eBay Finding API search query
    const keywords = `${brand} ${modelPartNumber}`.trim();
    const findingApiUrl = new URL('https://svcs.sandbox.ebay.com/services/search/FindingService/v1');
    
    findingApiUrl.searchParams.set('OPERATION-NAME', 'findItemsAdvanced');
    findingApiUrl.searchParams.set('SERVICE-VERSION', '1.0.0');
    findingApiUrl.searchParams.set('SECURITY-APPNAME', ebayAppId);
    findingApiUrl.searchParams.set('RESPONSE-DATA-FORMAT', 'JSON');
    findingApiUrl.searchParams.set('REST-PAYLOAD', '');
    findingApiUrl.searchParams.set('keywords', keywords);
    findingApiUrl.searchParams.set('paginationInput.entriesPerPage', '100');
    findingApiUrl.searchParams.set('sortOrder', 'PricePlusShippingLowest');

    console.log(`Calling eBay Finding API: ${findingApiUrl.toString()}`);
    
    const ebayResponse = await fetch(findingApiUrl.toString());
    const ebayData = await ebayResponse.json();

    const items = ebayData.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
    console.log(`Found ${items.length} eBay listings`);

    if (items.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        data: null,
        message: 'No listings found'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find cheapest overall and cheapest from your sellers
    let cheapestOverall = null;
    let cheapestOwn = null;
    let compatibilityItem = null;

    for (const item of items) {
      const itemId = item.itemId?.[0];
      const title = item.title?.[0];
      const price = parseFloat(item.sellingStatus?.[0]?.currentPrice?.[0]?.__value__ || '0');
      const url = item.viewItemURL?.[0];
      const sellerUsername = item.sellerInfo?.[0]?.sellerUserName?.[0]?.toLowerCase();

      // Track cheapest overall
      if (!cheapestOverall || price < cheapestOverall.price) {
        cheapestOverall = { itemId, title, price, url };
      }

      // Track cheapest from your sellers
      if (yourUsernames.includes(sellerUsername)) {
        if (!cheapestOwn || price < cheapestOwn.price) {
          cheapestOwn = { itemId, title, price, url, seller: sellerUsername };
        }
      }

      // Look for compatibility data (first non-yours listing)
      if (!compatibilityItem && !yourUsernames.includes(sellerUsername)) {
        compatibilityItem = { itemId, title };
      }
    }

    // Fetch compatibility data from Shopping API if we found a suitable item
    let compatibilityData = null;
    if (compatibilityItem) {
      console.log(`Fetching compatibility for item: ${compatibilityItem.itemId}`);
      
      const shoppingApiUrl = new URL('https://open.api.sandbox.ebay.com/shopping');
      shoppingApiUrl.searchParams.set('callname', 'GetSingleItem');
      shoppingApiUrl.searchParams.set('responseencoding', 'JSON');
      shoppingApiUrl.searchParams.set('appid', ebayAppId);
      shoppingApiUrl.searchParams.set('siteid', '0');
      shoppingApiUrl.searchParams.set('version', '967');
      shoppingApiUrl.searchParams.set('ItemID', compatibilityItem.itemId);
      shoppingApiUrl.searchParams.set('IncludeSelector', 'ItemSpecifics');

      const compatResponse = await fetch(shoppingApiUrl.toString());
      const compatData = await compatResponse.json();
      
      const itemSpecifics = compatData.Item?.ItemSpecifics?.NameValueList || [];
      const vehicleData = itemSpecifics.filter((spec: any) => 
        ['Make', 'Model', 'Year', 'Fitment Type', 'Manufacturer Part Number'].includes(spec.Name)
      );

      if (vehicleData.length > 0) {
        compatibilityData = {
          itemId: compatibilityItem.itemId,
          specifics: vehicleData.reduce((acc: any, spec: any) => {
            acc[spec.Name] = spec.Value;
            return acc;
          }, {})
        };
      }
    }

    // Save to cache
    const cacheData = {
      brand,
      model_part_number: modelPartNumber,
      search_key: searchKey,
      cheapest_overall_price: cheapestOverall?.price,
      cheapest_overall_item_id: cheapestOverall?.itemId,
      cheapest_overall_url: cheapestOverall?.url,
      cheapest_own_price: cheapestOwn?.price,
      cheapest_own_item_id: cheapestOwn?.itemId,
      cheapest_own_url: cheapestOwn?.url,
      compatibility_data: compatibilityData,
      compatibility_item_id: compatibilityData?.itemId,
    };

    await supabase
      .from('ebay_search_cache')
      .upsert(cacheData, { onConflict: 'search_key' });

    console.log('Search complete, results cached');

    return new Response(JSON.stringify({ 
      success: true, 
      data: cacheData,
      cached: false
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('eBay search error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
