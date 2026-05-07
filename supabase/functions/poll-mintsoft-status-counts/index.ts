import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: settings } = await supabase
      .from('mintsoft_settings').select('base_url').single();
    const baseUrl = settings?.base_url ?? 'https://api.mintsoft.co.uk';
    const apiKey = Deno.env.get('MINTSOFT_API_KEY');
    if (!apiKey) throw new Error('MINTSOFT_API_KEY missing');

    const url = `${baseUrl.replace(/\/$/, '')}/api/Order/OrderStatusSummaryAll`;
    const res = await fetch(url, { headers: { 'ms-apikey': apiKey, 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Mintsoft ${res.status}: ${await res.text()}`);
    const json = await res.json();

    // Response shape: array of {Status, Count} or similar — normalize
    const arr: any[] = Array.isArray(json) ? json : (json?.Items ?? json?.items ?? []);
    const captured_at = new Date().toISOString();
    const rows = arr
      .map((r) => ({
        captured_at,
        status: String(r.Status ?? r.status ?? r.Name ?? r.name ?? '').toUpperCase().trim(),
        count: Number(r.Count ?? r.count ?? r.Total ?? r.total ?? 0),
        source: 'OrderStatusSummaryAll',
      }))
      .filter((r) => r.status.length > 0);

    if (rows.length === 0) throw new Error(`No rows parsed from response: ${JSON.stringify(json).slice(0, 400)}`);

    const { error } = await supabase.from('mintsoft_status_snapshots').insert(rows);
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, captured_at, count: rows.length, statuses: rows }), {
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
