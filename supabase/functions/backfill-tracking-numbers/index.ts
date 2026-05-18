// Resolve unresolved carrier-penalty tracking numbers by looking up each
// tracking number directly in Mintsoft (Order/Search), across ALL statuses.
//
// Why: the previous strategy paged DESPATCHED orders newest-first looking
// for matches. Orders that have since moved to RETURNED / CANCELLED /
// RETURNREQUESTED are invisible to that scan, so it kept finding nothing.
// Direct TN lookup is O(N targets) with no paging.
//
// POST body (all optional):
//   { batch_size?: number (default 80, max 200) }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const START = Date.now();
const RUN_STARTED_AT = new Date().toISOString();
const MAX_RUNTIME_MS = 50_000;
const isOutOfTime = () => Date.now() - START > MAX_RUNTIME_MS;

interface MintsoftOrder {
  ID: number;
  TrackingNumber?: string | null;
  TrackingNo?: string | null;
  Consignment?: string | null;
  OrderStatusId?: number | null;
  OrderStatus?: string | null;
}

async function logRun(
  supabase: ReturnType<typeof createClient>,
  status: "succeeded" | "partial" | "failed",
  message: string,
  details?: Record<string, unknown>,
) {
  try {
    await supabase.from("edge_function_runs").insert({
      function_name: "backfill-tracking-numbers",
      started_at: RUN_STARTED_AT,
      ended_at: new Date().toISOString(),
      duration_ms: Date.now() - START,
      status,
      message,
      details: details ?? null,
    });
  } catch (e) { console.error("logRun failed:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({} as any));
    const batchSize = Math.min(Math.max(Number(body.batch_size) || 80, 1), 200);

    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("MINTSOFT_API_KEY missing");
    const { data: settings } = await supabase
      .from("mintsoft_settings").select("base_url").single();
    const baseUrl = (settings?.base_url || "https://api.mintsoft.co.uk").replace(/\/$/, "");
    const msHeaders = { "ms-apikey": apiKey, "Content-Type": "application/json" };

    // Pull this batch of priority targets: unresolved penalties whose
    // tracking_number we still haven't matched to an order_line.
    const { data: pendPenalties, error: pendErr } = await supabase
      .from("carrier_penalties")
      .select("id, tracking_number")
      .neq("resolution_status", "resolved")
      .is("sku", null)
      .not("tracking_number", "is", null)
      .order("created_at", { ascending: true })
      .limit(batchSize);
    if (pendErr) throw pendErr;

    const targets = (pendPenalties || [])
      .map(p => ({ id: p.id as string, tn: String(p.tracking_number).trim() }))
      .filter(t => t.tn.length > 0);

    let lookups = 0;
    let trackingMatches = 0;
    let updatedRows = 0;
    const matchedOrderIds: number[] = [];
    const tnSamples: Array<Record<string, unknown>> = [];

    for (const t of targets) {
      if (isOutOfTime()) break;
      lookups++;

      // Mintsoft Order/Search supports TrackingNo query; returns matching
      // orders regardless of status. Some Mintsoft tenants expose it as
      // /api/Order/Search, others as /api/Orders/Search — try both.
      let found: MintsoftOrder | null = null;
      for (const path of ["/api/Order/Search", "/api/Orders/Search"]) {
        const url = new URL(`${baseUrl}${path}`);
        url.searchParams.set("TrackingNo", t.tn);
        url.searchParams.set("Limit", "10");
        url.searchParams.set("PageNo", "1");
        let resp: Response;
        try { resp = await fetch(url.toString(), { headers: msHeaders }); }
        catch { continue; }
        if (!resp.ok) continue;
        const arr = await resp.json().catch(() => []) as MintsoftOrder[];
        if (Array.isArray(arr) && arr.length > 0) {
          // Pick the order whose tracking field equals our TN (case-insensitive).
          const upper = t.tn.toUpperCase();
          found = arr.find(o =>
            [(o.TrackingNumber || ""), (o.TrackingNo || ""), (o.Consignment || "")]
              .some(v => String(v).trim().toUpperCase() === upper)
          ) || arr[0];
          break;
        }
      }

      if (!found || !found.ID) {
        if (tnSamples.length < 5) tnSamples.push({ tn: t.tn, status: "no_match" });
        continue;
      }

      trackingMatches++;
      matchedOrderIds.push(found.ID);
      if (tnSamples.length < 5) tnSamples.push({
        tn: t.tn, order_id: found.ID, status_id: found.OrderStatusId, status: found.OrderStatus,
      });

      const { error, count } = await supabase
        .from("order_lines")
        .update({ tracking_number: t.tn })
        .eq("mintsoft_order_id", found.ID)
        .is("tracking_number", null)
        .select("mintsoft_order_id", { count: "exact", head: true });
      if (!error) updatedRows += count ?? 0;
    }

    // Trigger penalty resolution for matched orders.
    let resolved = 0;
    if (matchedOrderIds.length) {
      const { data: pen } = await supabase
        .from("carrier_penalties")
        .select("id")
        .neq("resolution_status", "resolved")
        .is("sku", null)
        .not("tracking_number", "is", null)
        .limit(500);
      const ids = (pen || []).map(p => p.id);
      if (ids.length) {
        try {
          const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/resolve-penalty-tracking`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ penalty_ids: ids }),
          });
          if (r.ok) {
            const j = await r.json().catch(() => ({}));
            resolved = Number(j.resolved) || 0;
          }
        } catch (e) { console.error("auto-resolve failed:", e); }
      }
    }

    const msg = `lookups ${lookups}/${targets.length} | tracking matches ${trackingMatches} | order_lines updated ${updatedRows} | penalties resolved ${resolved}`;
    await logRun(supabase, isOutOfTime() ? "partial" : "succeeded", msg, {
      lookups, targets: targets.length, trackingMatches, updatedRows, resolved, samples: tnSamples,
    });

    return new Response(JSON.stringify({
      ok: true, lookups, targets: targets.length, trackingMatches, updatedRows, resolved, samples: tnSamples,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("backfill-tracking-numbers error:", msg);
    await logRun(supabase, "failed", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
