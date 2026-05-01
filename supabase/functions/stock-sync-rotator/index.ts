// Hourly orchestrator: picks the brand with the stalest stock data, creates a
// sync_job and triggers sync-brand-inventory. Over time this catches every brand up.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    // Optional override: { brand_id } to force a specific brand
    let forcedBrandId: string | null = null;
    try {
      const body = await req.json();
      if (body?.brand_id) forcedBrandId = body.brand_id;
    } catch (_) { /* no body */ }

    // Pick a system user for the job (first super_user / first profile)
    const { data: profile } = await supabase
      .from('profiles')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    if (!profile) throw new Error('No system user found');
    const userId = profile.id;

    // Determine the next brand: oldest last_stock_sync across its SKUs, or never-synced
    let brandRow: { id: string; name: string } | null = null;

    if (forcedBrandId) {
      const { data } = await supabase.from('brands').select('id, name').eq('id', forcedBrandId).single();
      brandRow = data as any;
    } else {
      const { data, error } = await supabase.rpc('pick_stalest_brand_for_stock_sync');
      if (error) throw error;
      brandRow = (data && data[0]) ?? null;
    }

    if (!brandRow) {
      console.log('No brand needs syncing.');
      return new Response(JSON.stringify({ success: true, message: 'No brand needs syncing' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Rotator picked brand: ${brandRow.name} (${brandRow.id})`);

    // Don't double-queue if there's already a recent pending/processing job for this brand
    const { data: existing } = await supabase
      .from('sync_jobs')
      .select('id, status')
      .eq('brand_id', brandRow.id)
      .in('status', ['pending', 'processing'])
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`Brand ${brandRow.name} already has a job in flight (${existing[0].id}). Skipping.`);
      return new Response(JSON.stringify({ success: true, skipped: true, reason: 'already_in_flight' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Create the sync job
    const { data: job, error: jobErr } = await supabase
      .from('sync_jobs')
      .insert({ user_id: userId, brand_id: brandRow.id, status: 'pending', report_type: 'inventory' })
      .select()
      .single();
    if (jobErr) throw jobErr;

    // Invoke sync-brand-inventory (fire and forget — it does its own background work)
    const invokeRes = await fetch(`${supabaseUrl}/functions/v1/sync-brand-inventory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ job_id: job.id }),
    });
    const invokeText = await invokeRes.text().catch(() => '');
    console.log(`Triggered sync-brand-inventory for ${brandRow.name}: ${invokeRes.status} ${invokeText.slice(0, 200)}`);

    return new Response(JSON.stringify({ success: true, brand: brandRow.name, job_id: job.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('stock-sync-rotator error:', e);
    return new Response(JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
