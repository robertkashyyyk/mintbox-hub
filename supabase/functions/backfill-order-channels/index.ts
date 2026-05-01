// Repairs order_lines rows where channel/customer_name are NULL by re-fetching
// the order from Mintsoft (/api/Order/{id}) and patching the missing fields.
//
// Designed to be run on a schedule (e.g. every 5 min over a weekend) and walks
// through all NULL-channel orders since 2026-01-01 in batches.
//
// Body (optional): { batch_size?: 40, max_orders?: 400 }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const START = Date.now();
const MAX_MS = 50_000;
const timeOut = () => Date.now() - START > MAX_MS;
const HISTORICAL_FLOOR = "2026-01-01T00:00:00Z";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const apiKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "MINTSOFT_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const batchSize = Math.max(10, Math.min(100, Number(body.batch_size ?? 40)));
  const maxOrders = Math.max(50, Math.min(2000, Number(body.max_orders ?? 400)));

  const { data: settings } = await supabase
    .from("mintsoft_settings").select("base_url").limit(1).single();
  if (!settings?.base_url) {
    return new Response(JSON.stringify({ error: "Mintsoft settings missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Pull a page of distinct order ids needing repair
  const { data: candidates, error: pickErr } = await supabase
    .from("order_lines")
    .select("mintsoft_order_id")
    .is("channel", null)
    .gte("order_date", HISTORICAL_FLOOR)
    .order("mintsoft_order_id", { ascending: false })
    .limit(maxOrders * 3); // overfetch because of duplicate ids per order

  if (pickErr) {
    return new Response(JSON.stringify({ error: pickErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const uniqueIds = Array.from(new Set((candidates ?? []).map((r: any) => r.mintsoft_order_id))).slice(0, maxOrders);

  let patched = 0;
  let fetched = 0;
  let notFound = 0;
  const errors: string[] = [];

  for (let i = 0; i < uniqueIds.length; i += batchSize) {
    if (timeOut()) break;
    const batch = uniqueIds.slice(i, i + batchSize);

    await Promise.all(batch.map(async (orderId: number) => {
      if (timeOut()) return;
      try {
        const r = await fetch(`${settings.base_url}/api/Order/${orderId}`, {
          headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
        });
        fetched++;
        if (r.status === 404) { notFound++; return; }
        if (!r.ok) { errors.push(`o${orderId}: ${r.status}`); return; }
        const order: any = await r.json();
        if (!order) return;

        const channel = (order.Channel && typeof order.Channel === "object" && order.Channel.Name)
          ? order.Channel.Name
          : (typeof order.Channel === "string" ? order.Channel : (order.OrderSourceName ?? order.OrderSource ?? null));
        const channelOrderRef = order.ExternalOrderReference ?? order.ChannelOrderRef ?? null;
        const customerName = order.CustomerName
          ?? ([order.FirstName, order.LastName].filter(Boolean).join(" ") || null);

        const patch: Record<string, unknown> = {};
        if (channel) patch.channel = channel;
        if (channelOrderRef) patch.channel_order_ref = channelOrderRef;
        if (customerName) patch.customer_name = customerName;
        if (Object.keys(patch).length === 0) return;

        const { error: updErr } = await supabase
          .from("order_lines")
          .update(patch)
          .eq("mintsoft_order_id", orderId)
          .is("channel", null); // only fill nulls; don't overwrite manual fixes
        if (updErr) errors.push(`u${orderId}: ${updErr.message}`);
        else patched++;
      } catch (e) {
        errors.push(`o${orderId}: ${(e as Error).message}`);
      }
    }));
  }

  // Count remaining work for visibility
  const { count: remaining } = await supabase
    .from("order_lines")
    .select("mintsoft_order_id", { count: "exact", head: true })
    .is("channel", null)
    .gte("order_date", HISTORICAL_FLOOR);

  await supabase.from("edge_function_runs").insert({
    function_name: "backfill-order-channels",
    started_at: new Date(START).toISOString(),
    ended_at: new Date().toISOString(),
    duration_ms: Date.now() - START,
    status: errors.length > 0 ? "partial" : "succeeded",
    message: `patched=${patched} fetched=${fetched} notFound=${notFound} remaining_lines=${remaining ?? "?"}`,
    details: { patched, fetched, notFound, remaining_lines: remaining, errors: errors.slice(0, 10) },
  });

  return new Response(JSON.stringify({
    ok: true, patched, fetched, not_found: notFound, remaining_lines: remaining,
    errors: errors.slice(0, 10),
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
