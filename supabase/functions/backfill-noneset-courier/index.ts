// backfill-noneset-courier
// Fills courier_service (+ tracking) on DESPATCHED order_lines stuck at "None Set".
// Cause: reconcile-order-ghosts flips orders that dropped off Mintsoft's OPEN list to
// DESPATCHED but never re-fetches the courier Mintsoft assigned, so courier_cost books
// £0 in order_line_economics and profit is overstated everywhere.
//
// Resumable + time-boxed: processes a batch of distinct order ids per invocation,
// records each in courier_backfill_log (so it converges and never re-hammers an order
// Mintsoft has no courier for), and can be re-run / cronned until remaining = 0.
// Body: { limit?: number (default 150, max 400), refresh?: boolean (REFRESH the matview when done) }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Mirror of extractCourierService in sync-mintsoft-orders.
function extractCourierService(order: any): string | null {
  if (typeof order?.CourierService === "string" && order.CourierService) return order.CourierService;
  if (typeof order?.CourierServiceName === "string" && order.CourierServiceName) return order.CourierServiceName;
  if (order?.Courier && typeof order.Courier === "object" && order.Courier.Name) return order.Courier.Name;
  if (typeof order?.Courier === "string" && order.Courier) return order.Courier;
  return null;
}
function extractTracking(order: any): string | null {
  return order?.TrackingNumber || order?.Tracking || order?.ConsignmentNumber || null;
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Gated at the edge by verify_jwt=true (project key required), then proceeds —
  // same convention as backfill-tracking-numbers / backfill-historical-orders.
  // All privileged work uses the service-role env credentials below.
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let body: { limit?: number; refresh?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const limit = Math.min(Math.max(Number(body.limit ?? 150), 1), 400);

  const apiKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!apiKey) return json({ error: "MINTSOFT_API_KEY not configured" }, 500);

  const admin = createClient(url, serviceKey);
  const { data: settings, error: sErr } = await admin.from("mintsoft_settings").select("base_url").limit(1).single();
  if (sErr || !settings?.base_url) return json({ error: "mintsoft_settings.base_url missing" }, 500);
  const baseUrl = settings.base_url;

  const started = Date.now();
  const TIME_BUDGET_MS = 110_000;

  const { data: batch, error: bErr } = await admin.rpc("get_noneset_courier_batch", { p_limit: limit });
  if (bErr) return json({ error: bErr.message }, 500);
  const ids: number[] = (batch ?? []).map((r: any) => Number(r.mintsoft_order_id));

  let attempted = 0, resolved = 0, unresolved = 0, linesUpdated = 0;
  const errors: string[] = [];

  for (const id of ids) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    attempted++;
    let courier: string | null = null, tracking: string | null = null;
    try {
      const resp = await fetchWithTimeout(`${baseUrl}/api/Order/${id}`, {
        headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
      });
      if (resp.ok) {
        const order = await resp.json();
        courier = extractCourierService(order);
        tracking = extractTracking(order);
      } else if (resp.status !== 404) {
        errors.push(`order ${id}: HTTP ${resp.status}`);
      }
    } catch (e) {
      errors.push(`order ${id}: ${String((e as Error).message ?? e)}`);
    }

    const isReal = !!courier && courier.trim() !== "" && courier !== "None Set";
    if (isReal) {
      const patch: Record<string, unknown> = { courier_service: courier };
      if (tracking) patch.tracking_number = tracking;
      const { error: uErr, count } = await admin
        .from("order_lines")
        .update(patch, { count: "exact" })
        .eq("mintsoft_order_id", id)
        .eq("courier_service", "None Set");
      if (uErr) { errors.push(`order ${id} update: ${uErr.message}`); }
      else { resolved++; linesUpdated += count ?? 0; }
    } else {
      unresolved++;
    }

    // Mark attempted either way so the sweep converges.
    await admin.from("courier_backfill_log").upsert(
      { mintsoft_order_id: id, resolved: isReal, courier_found: courier, attempted_at: new Date().toISOString() },
      { onConflict: "mintsoft_order_id" },
    );
  }

  const { data: remaining } = await admin.rpc("count_noneset_courier_remaining");

  return json({
    ok: true, batch: ids.length, attempted, resolved, unresolved, lines_updated: linesUpdated,
    remaining: remaining ?? null, errors: errors.slice(0, 20),
    note: "re-run until remaining=0; then refresh order_line_economics",
  });
});
