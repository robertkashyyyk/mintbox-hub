import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

// Age bucket definitions (non-overlapping)
const AGE_BUCKETS = {
  ROTTEN: { min: 30, max: Infinity, column: 'bo_rotten_30_plus' },
  SERIOUS: { min: 14, max: 29, column: 'bo_serious_14_29' },
  URGENT: { min: 7, max: 13, column: 'bo_urgent_7_13' },
  PRESSURE: { min: 2, max: 6, column: 'bo_pressure_2_6' },
  FRESH: { min: 0, max: 1, column: 'bo_fresh_0_1' },
} as const;

function getUKTimeComponents(): { hour: number; minute: number; dateString: string } {
  const now = new Date();
  const ukFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = ukFormatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';

  return {
    hour: parseInt(get('hour'), 10),
    minute: parseInt(get('minute'), 10),
    dateString: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

function isWithinWindow(ukTime: { hour: number; minute: number }): boolean {
  // Valid window: 07:25 - 07:35
  if (ukTime.hour !== 7) return false;
  return ukTime.minute >= 25 && ukTime.minute <= 35;
}

function getAgeBucket(ageDays: number): keyof typeof AGE_BUCKETS | null {
  if (ageDays >= 30) return 'ROTTEN';
  if (ageDays >= 14) return 'SERIOUS';
  if (ageDays >= 7) return 'URGENT';
  if (ageDays >= 2) return 'PRESSURE';
  if (ageDays >= 0) return 'FRESH';
  return null;
}

function calculateAgeDays(orderDate: Date, captureDate: Date): number {
  const diffMs = captureDate.getTime() - orderDate.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

async function refreshStatusCache(
  supabase: any,
  baseUrl: string,
  apiKey: string
): Promise<void> {
  console.log('Refreshing Mintsoft status cache...');
  
  const response = await fetch(`${baseUrl}/api/Order/Statuses`, {
    method: 'GET',
    headers: {
      'ms-apikey': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch Mintsoft statuses: ${response.status} ${errorText}`);
  }

  const statuses = await response.json();
  console.log(`Fetched ${statuses.length} statuses from Mintsoft`);

  // Upsert all statuses into cache
  for (const status of statuses) {
    const { error } = await supabase
      .from('mintsoft_status_cache')
      .upsert({
        status_id: status.ID,
        external_name: status.ExternalName || status.Name,
        cached_at: new Date().toISOString(),
      }, {
        onConflict: 'status_id',
      });

    if (error) {
      console.warn(`Failed to cache status ${status.ID}:`, error.message);
    }
  }
  
  console.log('Status cache refreshed');
}

async function getOnBackorderStatusId(
  supabase: any,
  baseUrl: string,
  apiKey: string
): Promise<number> {
  // Check cache first
  const { data: cached, error: cacheError } = await supabase
    .from('mintsoft_status_cache')
    .select('status_id, cached_at')
    .eq('external_name', 'ONBACKORDER')
    .maybeSingle();

  if (cacheError) {
    console.error('Cache query error:', cacheError.message);
  }

  const now = new Date();
  const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

  // Check if cache is missing or stale
  const cachedAt = cached?.cached_at ? new Date(cached.cached_at as string) : null;
  const isCacheValid = cached && 
    cachedAt && 
    (now.getTime() - cachedAt.getTime()) < staleThreshold;

  if (!isCacheValid) {
    console.log('Cache missing or stale, refreshing...');
    await refreshStatusCache(supabase, baseUrl, apiKey);

    // Re-query after refresh
    const { data: refreshed, error: refreshError } = await supabase
      .from('mintsoft_status_cache')
      .select('status_id')
      .eq('external_name', 'ONBACKORDER')
      .maybeSingle();

    if (refreshError || !refreshed) {
      throw new Error('ONBACKORDER status not found in Mintsoft after cache refresh');
    }

    return refreshed.status_id as number;
  }

  return cached.status_id as number;
}

async function fetchAllBackorders(
  baseUrl: string,
  apiKey: string,
  statusId: number
): Promise<Array<{ OrderDate: string }>> {
  const allOrders: Array<{ OrderDate: string }> = [];
  let pageNo = 1;
  const pageSize = 100;

  console.log(`Fetching ONBACKORDER orders (statusId: ${statusId})...`);

  while (true) {
    // Use /api/Order/List endpoint with OrderStatusId parameter
    const url = `${baseUrl}/api/Order/List?OrderStatusId=${statusId}&PageNo=${pageNo}&Limit=${pageSize}`;
    console.log(`Fetching page ${pageNo}...`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'ms-apikey': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch orders: ${response.status} ${errorText}`);
    }

    const orders = await response.json();
    
    if (!Array.isArray(orders) || orders.length === 0) {
      console.log(`Page ${pageNo} returned no orders, stopping pagination`);
      break;
    }

    allOrders.push(...orders);
    console.log(`Page ${pageNo}: ${orders.length} orders (total: ${allOrders.length})`);

    if (orders.length < pageSize) {
      break;
    }

    pageNo++;
    
    // Safety limit to prevent infinite loops
    if (pageNo > 100) {
      console.warn('Reached page limit (100), stopping pagination');
      break;
    }
  }

  return allOrders;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate CRON_SECRET
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');

    if (!expectedSecret) {
      console.error('CRON_SECRET not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (cronSecret !== expectedSecret) {
      console.error('Invalid or missing CRON_SECRET');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Parse request body for force flag
    const body = await req.json().catch(() => ({}));
    const force = body.force === true;

    // 3. Check UK time window (07:25-07:35)
    const ukTime = getUKTimeComponents();
    console.log(`UK time: ${ukTime.hour}:${ukTime.minute}, date: ${ukTime.dateString}, force: ${force}`);

    // Check if force override is allowed
    const allowForceRun = Deno.env.get('ALLOW_FORCE_RUN') === 'true';
    const shouldBypassWindow = force && allowForceRun;

    if (shouldBypassWindow) {
      console.log('⚠️ FORCE RUN: Bypassing time window check (ALLOW_FORCE_RUN=true)');
    }

    if (!shouldBypassWindow && !isWithinWindow(ukTime)) {
      console.log('Outside valid window (07:25-07:35), skipping');
      return new Response(
        JSON.stringify({ 
          status: 'skipped', 
          reason: 'outside_window',
          uk_time: `${ukTime.hour}:${ukTime.minute}` 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 4. Fetch Mintsoft settings
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

    // 5. Get ONBACKORDER status ID (with cache refresh if needed)
    const onBackorderStatusId = await getOnBackorderStatusId(
      supabase,
      settings.base_url,
      apiKey
    );
    console.log(`ONBACKORDER status ID: ${onBackorderStatusId}`);

    // 6. Fetch all backorders
    const orders = await fetchAllBackorders(settings.base_url, apiKey, onBackorderStatusId);
    console.log(`Total ONBACKORDER orders: ${orders.length}`);

    // 7. Calculate age buckets
    const captureDate = new Date(ukTime.dateString);
    const bucketCounts = {
      bo_rotten_30_plus: 0,
      bo_serious_14_29: 0,
      bo_urgent_7_13: 0,
      bo_pressure_2_6: 0,
      bo_fresh_0_1: 0,
    };

    for (const order of orders) {
      if (!order.OrderDate) {
        console.warn('Order missing OrderDate, skipping');
        continue;
      }

      const orderDate = new Date(order.OrderDate);
      const ageDays = calculateAgeDays(orderDate, captureDate);
      const bucket = getAgeBucket(ageDays);

      if (bucket) {
        const column = AGE_BUCKETS[bucket].column;
        bucketCounts[column]++;
      }
    }

    const totalOnBackorder = Object.values(bucketCounts).reduce((sum, count) => sum + count, 0);

    console.log('Bucket counts:', bucketCounts);
    console.log('Total:', totalOnBackorder);

    // 8. Insert snapshot (ON CONFLICT DO NOTHING)
    const { data: insertedData, error: insertError } = await supabase
      .from('backorder_age_snapshot')
      .insert({
        capture_date_uk: ukTime.dateString,
        total_onbackorder: totalOnBackorder,
        ...bucketCounts,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      // Check if it's a unique constraint violation (already exists)
      if (insertError.code === '23505') {
        console.log('Snapshot already exists for today, skipping insert');
        return new Response(
          JSON.stringify({
            status: 'already_exists',
            capture_date_uk: ukTime.dateString,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw insertError;
    }

    console.log('Snapshot inserted successfully');

    return new Response(
      JSON.stringify({
        status: 'success',
        capture_date_uk: ukTime.dateString,
        total_onbackorder: totalOnBackorder,
        buckets: {
          ROTTEN: bucketCounts.bo_rotten_30_plus,
          SERIOUS: bucketCounts.bo_serious_14_29,
          URGENT: bucketCounts.bo_urgent_7_13,
          PRESSURE: bucketCounts.bo_pressure_2_6,
          FRESH: bucketCounts.bo_fresh_0_1,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in mintsoft-backorder-age-snapshot:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: 'Failed to capture backorder age snapshot'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
