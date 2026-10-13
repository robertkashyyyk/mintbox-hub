import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface MintsoftStatus {
  ID: number;
  Name: string;
  ExternalName: string;
  [key: string]: unknown;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get status_name from request body
    const body = await req.json().catch(() => ({}));
    const statusName = body.status_name || 'NEW';

    console.log(`Testing Mintsoft order count for status: ${statusName}`);

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

    // Step 1: Fetch all statuses and find the one matching ExternalName
    const statusesUrl = `${settings.base_url}/api/Order/Statuses`;
    console.log(`Fetching statuses from: ${statusesUrl}`);

    const statusesResponse = await fetch(statusesUrl, {
      method: 'GET',
      headers: {
        'ms-apikey': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!statusesResponse.ok) {
      const errorText = await statusesResponse.text();
      throw new Error(`Failed to fetch statuses: ${statusesResponse.status} ${errorText}`);
    }

    const statuses: MintsoftStatus[] = await statusesResponse.json();
    console.log(`Fetched ${statuses.length} statuses`);

    // Find status by ExternalName
    const targetStatus = statuses.find(
      s => s.ExternalName?.toUpperCase() === statusName.toUpperCase() ||
           s.Name?.toUpperCase() === statusName.toUpperCase()
    );

    if (!targetStatus) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Status "${statusName}" not found`,
          available_statuses: statuses.map(s => ({
            id: s.ID,
            name: s.Name,
            external_name: s.ExternalName
          }))
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    console.log(`Found status: ID=${targetStatus.ID}, Name=${targetStatus.Name}, ExternalName=${targetStatus.ExternalName}`);

    // Step 2: Call Order/List with Limit=1 to see response shape
    const orderListUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${targetStatus.ID}&PageNo=1&Limit=1`;
    console.log(`Fetching orders from: ${orderListUrl}`);

    const ordersResponse = await fetch(orderListUrl, {
      method: 'GET',
      headers: {
        'ms-apikey': apiKey,
        'Content-Type': 'application/json',
      },
    });

    // Capture ALL response headers
    const responseHeaders: Record<string, string> = {};
    ordersResponse.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const ordersBody = await ordersResponse.text();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(ordersBody);
    } catch {
      parsedBody = ordersBody;
    }

    // Look for total count indicators
    const possibleCountHeaders = [
      'x-total-count',
      'x-total-results',
      'x-count',
      'total-count',
      'x-pagination-total',
      'x-total',
    ];

    const foundCountHeaders: Record<string, string> = {};
    for (const h of possibleCountHeaders) {
      const value = ordersResponse.headers.get(h);
      if (value) {
        foundCountHeaders[h] = value;
      }
    }

    // Analyze body for count fields
    let bodyCountFields: Record<string, unknown> = {};
    if (typeof parsedBody === 'object' && parsedBody !== null) {
      const countKeys = ['TotalCount', 'TotalResults', 'Total', 'Count', 'RecordCount', 'TotalRecords', 'totalCount', 'total'];
      for (const key of countKeys) {
        if (key in (parsedBody as Record<string, unknown>)) {
          bodyCountFields[key] = (parsedBody as Record<string, unknown>)[key];
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        status_lookup: {
          requested_name: statusName,
          found_id: targetStatus.ID,
          found_name: targetStatus.Name,
          found_external_name: targetStatus.ExternalName,
        },
        order_list_response: {
          status_code: ordersResponse.status,
          status_text: ordersResponse.statusText,
          all_headers: responseHeaders,
          found_count_headers: foundCountHeaders,
          body_count_fields: bodyCountFields,
          body_type: Array.isArray(parsedBody) ? 'array' : typeof parsedBody,
          body_length: Array.isArray(parsedBody) ? parsedBody.length : null,
          body_sample: parsedBody,
        },
        analysis: {
          has_count_in_headers: Object.keys(foundCountHeaders).length > 0,
          has_count_in_body: Object.keys(bodyCountFields).length > 0,
          recommendation: Object.keys(foundCountHeaders).length > 0 || Object.keys(bodyCountFields).length > 0
            ? 'Total count available - use Limit=1 for efficient counting'
            : 'No total count found - will need to paginate with Limit=100',
        },
      }, null, 2),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in mintsoft-test-order-count:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
