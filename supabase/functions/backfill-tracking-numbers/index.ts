// Backfill order_lines.tracking_number from Mintsoft.
//
// Mintsoft has no tracking-search endpoint, so we page DESPATCHED orders
// newest-first, harvest each order's TrackingNumber, and bulk-update
// order_lines for any line whose tracking_number is NULL. Then we re-run
// resolve-penalty-tracking for any still-unresolved carrier_penalties so
// freshly-backfilled tracking numbers translate immediately into resolved
// penalties + remeasure tasks.
//
// Resumable: a cursor (page_no) is stored in app_settings under
// 'backfill_tracking.cursor'. Each invocation runs for ~50s, then the next
// run picks up where this one stopped. POST {"reset": true} to start over.

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
  OrderDate?: string | null;
}

const CURSOR_KEY = "backfill_tracking.cursor";

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
    const reset = !!body.reset;
    const maxPages = Math.min(Number(body.max_pages) || 200, 500);

    // Discover DESPATCHED status id
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("MINTSOFT_API_KEY missing");
    const { data: settings } = await supabase
      .from("mintsoft_settings").select("base_url").single();
    const baseUrl = (settings?.base_url || "https://api.mintsoft.co.uk").replace(/\/$/, "");
    const statuses = await (await fetch(`${baseUrl}/api/Order/Statuses`, {
      headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
    })).json() as Array<{ ID: number; ExternalName?: string }>;
    const despatched = statuses.find(s => (s.ExternalName || "").toUpperCase() === "DESPATCHED");
    if (!despatched) throw new Error("DESPATCHED status not found");

    // Resume cursor
    let pageNo = 1;
    if (!reset) {
      const { data: cur } = await supabase
        .from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
      if (cur?.value != null) pageNo = Math.max(1, Number(cur.value) || 1);
    }
    const startPage = pageNo;

    // Pull unresolved penalty tracking numbers (the priority targets) so we
    // can flag a fast-exit if we've already covered them all this run.
    const { data: pendPenalties } = await supabase
      .from("carrier_penalties")
      .select("tracking_number")
      .neq("resolution_status", "resolved")
      .is("sku", null)
      .not("tracking_number", "is", null);
    const targetTracks = new Set<string>(
      (pendPenalties || []).map(p => String(p.tracking_number).trim().toUpperCase()).filter(Boolean)
    );
    const targetsRemaining = new Set(targetTracks);

    let scanned = 0;
    let updatedRows = 0;
    let trackingMatches = 0;
    let stopped = "page_cap";
    const matchedOrderIds: number[] = [];
    const PAGE_SIZE = 100;
    const lastPage = pageNo + maxPages - 1;

    while (pageNo <= lastPage) {
      if (isOutOfTime()) { stopped = "timeout"; break; }
      const url = new URL(`${baseUrl}/api/Order/List`);
      url.searchParams.set("OrderStatusId", String(despatched.ID));
      url.searchParams.set("Limit", String(PAGE_SIZE));
      url.searchParams.set("PageNo", String(pageNo));
      url.searchParams.set("SortOldestFirst", "false");

      const resp = await fetch(url.toString(), {
        headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
      });
      if (!resp.ok) { stopped = `http_${resp.status}`; break; }
      const orders = await resp.json() as MintsoftOrder[];
      if (!orders.length) { stopped = "empty_page"; break; }
      scanned += orders.length;

      // Targeted updates only: scan every order's tracking, but only WRITE
      // to order_lines for orders whose tracking matches a pending penalty.
      // This keeps each page to ~0 db writes in the common case so we can
      // scan deep history quickly.
      for (const o of orders) {
        const tn = (o.TrackingNumber || o.TrackingNo || o.Consignment || "").toString().trim();
        if (!tn || !o.ID) continue;
        const upper = tn.toUpperCase();
        if (!targetsRemaining.has(upper)) continue;

        targetsRemaining.delete(upper);
        trackingMatches++;
        matchedOrderIds.push(o.ID);
        const { error, count } = await supabase
          .from("order_lines")
          .update({ tracking_number: tn })
          .eq("mintsoft_order_id", o.ID)
          .is("tracking_number", null)
          .select("mintsoft_order_id", { count: "exact", head: true });
        if (!error) updatedRows += count ?? 0;
      }

      // Early exit: every still-unresolved penalty tracking number has been
      // located in the orders we've scanned so far.
      if (targetTracks.size > 0 && targetsRemaining.size === 0) {
        stopped = "all_targets_matched";
        pageNo++;
        break;
      }

      if (orders.length < PAGE_SIZE) { stopped = "short_page"; pageNo++; break; }
      pageNo++;
    }

    // Persist cursor for the next run (or reset to 1 once exhausted)
    const cursorOut = (stopped === "empty_page" || stopped === "all_targets_matched") ? 1 : pageNo;
    await supabase.from("app_settings").upsert({
      key: CURSOR_KEY,
      value: cursorOut as any,
      description: "Resumable cursor for backfill-tracking-numbers (next page to fetch)",
    }, { onConflict: "key" });

    // Auto-resolve any newly-resolvable penalties
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

    const msg = `pages ${startPage}->${pageNo - 1} | scanned ${scanned} orders | updated ${updatedRows} lines | tracking targets ${trackingMatches}/${targetTracks.size} matched | penalties resolved ${resolved} | stop=${stopped}`;
    await logRun(supabase, isOutOfTime() ? "partial" : "succeeded", msg, {
      startPage, endPage: pageNo - 1, scanned, updatedRows,
      trackingMatches, targets: targetTracks.size, resolved, stopped,
      cursor_next: cursorOut,
    });

    return new Response(JSON.stringify({
      ok: true, startPage, endPage: pageNo - 1, scanned, updatedRows,
      trackingMatches, targets: targetTracks.size, resolved, stopped,
      cursor_next: cursorOut,
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
