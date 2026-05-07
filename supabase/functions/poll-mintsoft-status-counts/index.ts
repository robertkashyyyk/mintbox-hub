import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Status IDs we care about for the live wall display.
// DESPATCHED group uses DespatchedFrom=today so we only count today's.
const ACTIVE_STATUSES: { id: number; name: string; despatchedToday?: boolean }[] = [
  { id: 1,  name: 'NEW' },
  { id: 9,  name: 'ONBACKORDER' },
  { id: 15, name: 'AWAITINGPICKING' },
  { id: 16, name: 'PICKINGSTARTED' },
  { id: 17, name: 'PICKED' },
  { id: 20, name: 'PACKED' },
  { id: 4,  name: 'DESPATCHED', despatchedToday: true },
  { id: 5,  name: 'INVOICED', despatchedToday: true },
  { id: 6,  name: 'INVOICEFAILED', despatchedToday: true },
];

const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety cap → 5000 per status

async function countStatus(baseUrl: string, apiKey: string, statusId: number, despatchedToday: boolean) {
  let total = 0;
  const todayUk = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/London' }));
  const dateStr = `${todayUk.getFullYear()}-${String(todayUk.getMonth() + 1).padStart(2, '0')}-${String(todayUk.getDate()).padStart(2, '0')}`;
  const dateFilter = despatchedToday ? `&DespatchedFrom=${dateStr}` : '';

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl}/api/Order/List?OrderStatusId=${statusId}${dateFilter}&PageNo=${page}&Limit=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: { 'ms-apikey': apiKey } });
    if (!res.ok) throw new Error(`Mintsoft ${res.status} on status ${statusId} page ${page}`);
    const arr = await res.json();
    if (!Array.isArray(arr)) break;
    total += arr.length;
    if (arr.length < PAGE_SIZE) break;
  }
  return total;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settings } = await supabase
      .from('mintsoft_settings').select('base_url').single();
    const baseUrl = (settings?.base_url ?? 'https://api.mintsoft.co.uk').replace(/\/$/, '');
    const apiKey = Deno.env.get('MINTSOFT_API_KEY');
    if (!apiKey) throw new Error('MINTSOFT_API_KEY missing');

    // Roll up DESPATCHED-equivalent statuses into a single 'DESPATCHED_TODAY' bucket
    const captured_at = new Date().toISOString();
    const buckets: Record<string, number> = {};
    for (const s of ACTIVE_STATUSES) {
      const n = await countStatus(baseUrl, apiKey, s.id, !!s.despatchedToday);
      const key = s.despatchedToday ? 'DESPATCHED_TODAY' : s.name;
      buckets[key] = (buckets[key] ?? 0) + n;
    }

    const rows = Object.entries(buckets).map(([status, count]) => ({
      captured_at,
      status,
      count,
      source: 'OrderListPaginated',
    }));

    const { error } = await supabase.from('mintsoft_status_snapshots').insert(rows);
    if (error) throw error;

    const duration_ms = Date.now() - startedAt;
    return new Response(JSON.stringify({ ok: true, captured_at, duration_ms, buckets }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('poll-mintsoft-status-counts error:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500,
    });
  }
});
