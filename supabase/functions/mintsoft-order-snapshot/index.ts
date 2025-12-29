import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

interface MintsoftStatus {
  ID: number;
  Name: string;
  ExternalName: string;
}

// Valid capture windows (UK local time)
const SLOT_WINDOWS = {
  AM: { startHour: 7, startMinute: 25, endHour: 7, endMinute: 35 },
  PM: { startHour: 16, startMinute: 25, endHour: 16, endMinute: 35 },
} as const;

type Slot = keyof typeof SLOT_WINDOWS;

// Get current UK time components
function getUKTimeComponents(): { hour: number; minute: number; dateStr: string } {
  const now = new Date();
  
  // Format in UK timezone
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
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  const hour = parseInt(getPart('hour'), 10);
  const minute = parseInt(getPart('minute'), 10);
  const day = getPart('day');
  const month = getPart('month');
  const year = getPart('year');
  
  // Format as YYYY-MM-DD for Postgres date
  const dateStr = `${year}-${month}-${day}`;
  
  return { hour, minute, dateStr };
}

// Check if current UK time is within the valid window for the slot
function isWithinWindow(slot: Slot, ukTime: { hour: number; minute: number }): boolean {
  const window = SLOT_WINDOWS[slot];
  const currentMinutes = ukTime.hour * 60 + ukTime.minute;
  const windowStart = window.startHour * 60 + window.startMinute;
  const windowEnd = window.endHour * 60 + window.endMinute;
  
  return currentMinutes >= windowStart && currentMinutes <= windowEnd;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Step 1: Validate CRON_SECRET
    const cronSecret = req.headers.get('x-cron-secret');
    const expectedSecret = Deno.env.get('CRON_SECRET');
    
    if (!cronSecret || cronSecret !== expectedSecret) {
      console.error('Invalid or missing CRON_SECRET');
      return new Response(
        JSON.stringify({ status: 'error', message: 'Unauthorized' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401 }
      );
    }

    // Step 2: Parse and validate slot from request body
    const body = await req.json().catch(() => ({}));
    const slot = body.slot as string;
    
    if (!slot || !['AM', 'PM'].includes(slot)) {
      console.error('Invalid or missing slot:', slot);
      return new Response(
        JSON.stringify({ status: 'error', message: 'Invalid or missing slot. Must be "AM" or "PM".' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const validSlot = slot as Slot;
    
    // Step 3: Compute UK local time and validate window
    const ukTime = getUKTimeComponents();
    console.log(`UK time: ${ukTime.hour}:${ukTime.minute.toString().padStart(2, '0')}, Date: ${ukTime.dateStr}, Slot: ${validSlot}`);
    
    if (!isWithinWindow(validSlot, ukTime)) {
      const window = SLOT_WINDOWS[validSlot];
      console.log(`Outside valid window for ${validSlot} slot. Window is ${window.startHour}:${window.startMinute.toString().padStart(2, '0')} - ${window.endHour}:${window.endMinute.toString().padStart(2, '0')}`);
      return new Response(
        JSON.stringify({ 
          status: 'skipped', 
          reason: `Outside valid window for ${validSlot} slot`,
          uk_time: `${ukTime.hour}:${ukTime.minute.toString().padStart(2, '0')}`,
          valid_window: `${window.startHour}:${window.startMinute.toString().padStart(2, '0')} - ${window.endHour}:${window.endMinute.toString().padStart(2, '0')}`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    console.log('Within valid window, proceeding with snapshot capture');

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Step 4: Fetch Mintsoft settings
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

    // Step 5: Get status IDs from cache or refresh from API
    const { data: cachedStatuses, error: cacheError } = await supabase
      .from('mintsoft_status_cache')
      .select('status_id, external_name, cached_at');

    let statusMap: Record<string, number> = {};
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    // Check if cache is empty or stale
    const cacheIsStale = !cachedStatuses || 
                         cachedStatuses.length === 0 || 
                         cachedStatuses.some(s => s.cached_at < oneDayAgo);

    if (cacheIsStale) {
      console.log('Status cache is empty or stale, refreshing from Mintsoft API...');
      
      const statusesUrl = `${settings.base_url}/api/Order/Statuses`;
      const statusesResponse = await fetch(statusesUrl, {
        method: 'GET',
        headers: { 'ms-apikey': apiKey, 'Content-Type': 'application/json' },
      });

      if (!statusesResponse.ok) {
        throw new Error(`Failed to fetch statuses: ${statusesResponse.status}`);
      }

      const statuses: MintsoftStatus[] = await statusesResponse.json();
      console.log(`Fetched ${statuses.length} statuses from Mintsoft`);

      // Clear old cache and insert new
      await supabase.from('mintsoft_status_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      const cacheInserts = statuses.map(s => ({
        status_id: s.ID,
        external_name: s.ExternalName || s.Name,
      }));
      
      await supabase.from('mintsoft_status_cache').insert(cacheInserts);
      
      // Build status map
      statuses.forEach(s => {
        const key = (s.ExternalName || s.Name).toUpperCase();
        statusMap[key] = s.ID;
      });
    } else {
      // Use cached data
      cachedStatuses.forEach(s => {
        statusMap[s.external_name.toUpperCase()] = s.status_id;
      });
    }

    // Get IDs for required statuses
    const requiredStatuses = ['NEW', 'ONBACKORDER', 'AWAITINGPICKING', 'PICKED'];
    const statusIds: Record<string, number | null> = {};
    
    for (const status of requiredStatuses) {
      statusIds[status] = statusMap[status] || null;
      if (!statusIds[status]) {
        console.warn(`Status "${status}" not found in cache`);
      }
    }

    console.log('Status IDs:', statusIds);

    // Step 6: Fetch order counts for each status
    const counts: Record<string, number> = {
      NEW: 0,
      ONBACKORDER: 0,
      AWAITINGPICKING: 0,
      PICKED: 0,
    };

    for (const [statusName, statusId] of Object.entries(statusIds)) {
      if (statusId === null) {
        console.log(`Skipping ${statusName} - no status ID found`);
        continue;
      }

      const orderListUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&PageNo=1&Limit=1`;
      console.log(`Fetching count for ${statusName} (ID: ${statusId})...`);

      const ordersResponse = await fetch(orderListUrl, {
        method: 'GET',
        headers: { 'ms-apikey': apiKey, 'Content-Type': 'application/json' },
      });

      if (!ordersResponse.ok) {
        console.error(`Failed to fetch orders for ${statusName}: ${ordersResponse.status}`);
        continue;
      }

      // Try to get total from headers first
      const totalHeader = ordersResponse.headers.get('x-total-count') || 
                         ordersResponse.headers.get('x-total-results') ||
                         ordersResponse.headers.get('total-count');
      
      if (totalHeader) {
        counts[statusName] = parseInt(totalHeader, 10);
        console.log(`${statusName}: ${counts[statusName]} (from header)`);
      } else {
        // Parse body and look for total field
        const responseBody = await ordersResponse.json();
        
        if (typeof responseBody === 'object' && responseBody !== null) {
          const totalField = responseBody.TotalCount ?? responseBody.Total ?? responseBody.TotalResults;
          if (typeof totalField === 'number') {
            counts[statusName] = totalField;
            console.log(`${statusName}: ${counts[statusName]} (from body)`);
          } else if (Array.isArray(responseBody)) {
            // If it's just an array, we'd need to paginate - for now use array length as minimum
            counts[statusName] = responseBody.length;
            console.log(`${statusName}: ${counts[statusName]} (array length - may need pagination)`);
          }
        }
      }
    }

    console.log('Final counts:', counts);

    // Step 7: Insert snapshot with ON CONFLICT DO NOTHING
    const { data: insertedSnapshot, error: insertError } = await supabase
      .from('order_status_snapshots')
      .insert({
        capture_date_uk: ukTime.dateStr,
        slot: validSlot,
        new_count: counts.NEW,
        onbackorder_count: counts.ONBACKORDER,
        awaitingpicking_count: counts.AWAITINGPICKING,
        picked_count: counts.PICKED,
        run_ok: true,
      })
      .select()
      .single();

    if (insertError) {
      // Check if it's a unique constraint violation
      if (insertError.code === '23505') {
        console.log('Snapshot already exists for this date and slot - skipping duplicate');
        return new Response(
          JSON.stringify({ 
            status: 'skipped', 
            reason: 'Snapshot already exists for this date and slot',
            capture_date_uk: ukTime.dateStr,
            slot: validSlot
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }
      throw insertError;
    }

    console.log('Snapshot inserted successfully:', insertedSnapshot);

    return new Response(
      JSON.stringify({ 
        status: 'success', 
        snapshot: insertedSnapshot,
        counts,
        uk_time: `${ukTime.hour}:${ukTime.minute.toString().padStart(2, '0')}`,
        capture_date_uk: ukTime.dateStr,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error('Error in mintsoft-order-snapshot:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Try to log the failed run
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      const ukTime = getUKTimeComponents();
      
      await supabase.from('order_status_snapshots').insert({
        capture_date_uk: ukTime.dateStr,
        slot: 'AM', // Default if we couldn't determine slot
        new_count: 0,
        onbackorder_count: 0,
        awaitingpicking_count: 0,
        picked_count: 0,
        run_ok: false,
        error_message: errorMessage,
      });
    } catch (logError) {
      console.error('Failed to log error snapshot:', logError);
    }
    
    return new Response(
      JSON.stringify({ status: 'error', message: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
