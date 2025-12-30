import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MintsoftStatus {
  ID: number;
  Name: string;
  ExternalName: string;
}

// Age bucket definitions
const AGE_BUCKETS = {
  ROTTEN: { min: 30, max: Infinity, column: 'bo_rotten_30_plus' },
  SERIOUS: { min: 14, max: 29, column: 'bo_serious_14_29' },
  URGENT: { min: 7, max: 13, column: 'bo_urgent_7_13' },
  PRESSURE: { min: 2, max: 6, column: 'bo_pressure_2_6' },
  FRESH: { min: 0, max: 1, column: 'bo_fresh_0_1' },
} as const;

function getUKDateString(): string {
  const now = new Date();
  const ukFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = ukFormatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Validate JWT - user must be authenticated
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      console.error('Missing authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    // Create client with user's JWT to validate auth
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      console.error('Auth error:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Check if user has admin role (super_user or senior_user)
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    
    const { data: roles, error: rolesError } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (rolesError) {
      console.error('Roles query error:', rolesError.message);
      return new Response(
        JSON.stringify({ error: 'Failed to check permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userRoles = roles?.map(r => r.role) ?? [];
    const isAdmin = userRoles.includes('super_user') || userRoles.includes('senior_user');

    if (!isAdmin) {
      console.error('User lacks admin role:', user.id, userRoles);
      return new Response(
        JSON.stringify({ error: 'Forbidden - admin role required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Admin user ${user.email} triggering snapshots`);

    // 3. Parse request body
    const body = await req.json().catch(() => ({}));
    const runOrderSnapshot = body.order_snapshot !== false;
    const runBackorderSnapshot = body.backorder_snapshot !== false;
    const slot = body.slot || 'AM';

    if (!['AM', 'PM'].includes(slot)) {
      return new Response(
        JSON.stringify({ error: 'Invalid slot. Must be AM or PM.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: { order_snapshot?: any; backorder_snapshot?: any } = {};
    const ukDateStr = getUKDateString();

    // 4. Fetch Mintsoft settings
    const { data: settings, error: settingsError } = await adminClient
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

    // 5. Get/refresh status cache
    const { data: cachedStatuses } = await adminClient
      .from('mintsoft_status_cache')
      .select('status_id, external_name, cached_at');

    let statusMap: Record<string, number> = {};
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const cacheIsStale = !cachedStatuses || 
                         cachedStatuses.length === 0 || 
                         cachedStatuses.some(s => s.cached_at < oneDayAgo);

    if (cacheIsStale) {
      console.log('Status cache stale, refreshing...');
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

      await adminClient.from('mintsoft_status_cache').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      
      const cacheInserts = statuses.map(s => ({
        status_id: s.ID,
        external_name: s.ExternalName || s.Name,
      }));
      
      await adminClient.from('mintsoft_status_cache').insert(cacheInserts);
      
      statuses.forEach(s => {
        const key = (s.ExternalName || s.Name).toUpperCase();
        statusMap[key] = s.ID;
      });
    } else {
      cachedStatuses.forEach(s => {
        statusMap[s.external_name.toUpperCase()] = s.status_id;
      });
    }

    // 6. Run order status snapshot with pagination-based counting
    if (runOrderSnapshot) {
      console.log(`Running order status snapshot (slot: ${slot})...`);
      
      const requiredStatuses = ['NEW', 'ONBACKORDER', 'AWAITINGPICKING', 'PICKED'];
      const counts: Record<string, number> = {
        NEW: 0,
        ONBACKORDER: 0,
        AWAITINGPICKING: 0,
        PICKED: 0,
      };

      for (const statusName of requiredStatuses) {
        const statusId = statusMap[statusName];
        if (!statusId) {
          console.warn(`Status "${statusName}" not found in cache`);
          continue;
        }

        // First try with Limit=1 to check for header/body total
        const probeUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&PageNo=1&Limit=1`;
        const probeResponse = await fetch(probeUrl, {
          method: 'GET',
          headers: { 'ms-apikey': apiKey, 'Content-Type': 'application/json' },
        });

        if (!probeResponse.ok) {
          console.error(`Failed to fetch orders for ${statusName}: ${probeResponse.status}`);
          continue;
        }

        const totalHeader = probeResponse.headers.get('x-total-count') || 
                           probeResponse.headers.get('x-total-results') ||
                           probeResponse.headers.get('total-count');
        
        if (totalHeader) {
          counts[statusName] = parseInt(totalHeader, 10);
          console.log(`${statusName}: ${counts[statusName]} (from header)`);
        } else {
          const probeBody = await probeResponse.json();
          if (typeof probeBody === 'object' && probeBody !== null && !Array.isArray(probeBody)) {
            const totalField = probeBody.TotalCount ?? probeBody.Total ?? probeBody.TotalResults;
            if (typeof totalField === 'number') {
              counts[statusName] = totalField;
              console.log(`${statusName}: ${counts[statusName]} (from body TotalCount)`);
              continue;
            }
          }
          
          // No header/body total available - fall back to pagination counting
          console.log(`${statusName}: No total in header/body, using pagination...`);
          let totalCount = 0;
          let pageNo = 1;
          const pageSize = 100;
          const maxPages = 200;

          while (pageNo <= maxPages) {
            const pageUrl = `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&PageNo=${pageNo}&Limit=${pageSize}`;
            const pageResponse = await fetch(pageUrl, {
              method: 'GET',
              headers: { 'ms-apikey': apiKey, 'Content-Type': 'application/json' },
            });

            if (!pageResponse.ok) {
              console.error(`Pagination failed for ${statusName} at page ${pageNo}: ${pageResponse.status}`);
              break;
            }

            const pageData = await pageResponse.json();
            if (!Array.isArray(pageData) || pageData.length === 0) {
              break;
            }

            totalCount += pageData.length;

            if (pageData.length < pageSize) {
              break;
            }
            pageNo++;
          }

          if (pageNo > maxPages) {
            console.warn(`${statusName}: Hit page limit (${maxPages}), count may be partial`);
          }
          
          counts[statusName] = totalCount;
          console.log(`${statusName}: ${counts[statusName]} (from pagination, ${pageNo} pages)`);
        }
      }

      // Insert or skip if exists
      const { data: orderSnapshotData, error: orderInsertError } = await adminClient
        .from('order_status_snapshots')
        .insert({
          capture_date_uk: ukDateStr,
          slot: slot,
          new_count: counts.NEW,
          onbackorder_count: counts.ONBACKORDER,
          awaitingpicking_count: counts.AWAITINGPICKING,
          picked_count: counts.PICKED,
          run_ok: true,
        })
        .select()
        .maybeSingle();

      if (orderInsertError) {
        if (orderInsertError.code === '23505') {
          results.order_snapshot = { status: 'already_exists', slot, capture_date_uk: ukDateStr };
        } else {
          throw orderInsertError;
        }
      } else {
        results.order_snapshot = { status: 'success', counts, slot, capture_date_uk: ukDateStr };
      }
    }

    // 7. Run backorder age snapshot
    if (runBackorderSnapshot) {
      console.log('Running backorder age snapshot...');
      
      const onBackorderStatusId = statusMap['ONBACKORDER'];
      if (!onBackorderStatusId) {
        throw new Error('ONBACKORDER status not found in cache');
      }

      // Fetch all backorders with pagination
      const allOrders: Array<{ OrderDate: string }> = [];
      let pageNo = 1;
      const pageSize = 100;

      while (true) {
        const url = `${settings.base_url}/api/Order/List?OrderStatusId=${onBackorderStatusId}&PageNo=${pageNo}&Limit=${pageSize}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'ms-apikey': apiKey, 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch orders: ${response.status}`);
        }

        const orders = await response.json();
        
        if (!Array.isArray(orders) || orders.length === 0) {
          break;
        }

        allOrders.push(...orders);

        if (orders.length < pageSize) {
          break;
        }

        pageNo++;
        if (pageNo > 100) {
          console.warn('Reached page limit (100)');
          break;
        }
      }

      console.log(`Total ONBACKORDER orders: ${allOrders.length}`);

      // Calculate age buckets
      const captureDate = new Date(ukDateStr);
      const bucketCounts = {
        bo_rotten_30_plus: 0,
        bo_serious_14_29: 0,
        bo_urgent_7_13: 0,
        bo_pressure_2_6: 0,
        bo_fresh_0_1: 0,
      };

      for (const order of allOrders) {
        if (!order.OrderDate) continue;
        const orderDate = new Date(order.OrderDate);
        const ageDays = calculateAgeDays(orderDate, captureDate);
        const bucket = getAgeBucket(ageDays);
        if (bucket) {
          bucketCounts[AGE_BUCKETS[bucket].column]++;
        }
      }

      const totalOnBackorder = Object.values(bucketCounts).reduce((sum, count) => sum + count, 0);

      // Insert or skip if exists
      const { data: backorderData, error: backorderInsertError } = await adminClient
        .from('backorder_age_snapshot')
        .insert({
          capture_date_uk: ukDateStr,
          total_onbackorder: totalOnBackorder,
          ...bucketCounts,
        })
        .select()
        .maybeSingle();

      if (backorderInsertError) {
        if (backorderInsertError.code === '23505') {
          results.backorder_snapshot = { status: 'already_exists', capture_date_uk: ukDateStr };
        } else {
          throw backorderInsertError;
        }
      } else {
        results.backorder_snapshot = { 
          status: 'success', 
          capture_date_uk: ukDateStr, 
          total_onbackorder: totalOnBackorder,
          buckets: bucketCounts 
        };
      }
    }

    console.log('Snapshot run complete:', results);

    return new Response(
      JSON.stringify({ status: 'success', results }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in admin-run-snapshots:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
