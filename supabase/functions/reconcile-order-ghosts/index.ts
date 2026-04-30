// Standalone ghost-closure reconciliation.
// Sweeps every non-terminal Mintsoft status, builds a set of order IDs that are
// still open in Mintsoft, then marks any order_lines row in NEW / AWAITINGPICKING /
// ONBACKORDER whose mintsoft_order_id is NOT in that set as DESPATCHED.
//
// Runs in its own edge function so it has the full 60s budget independent of
// sync-mintsoft-orders. Designed to be cron-scheduled every ~15 minutes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const START_TIME = Date.now();
const RUN_STARTED_AT = new Date().toISOString();
const MAX_RUNTIME_MS = 50_000;
const isTimeRunningOut = () => Date.now() - START_TIME > MAX_RUNTIME_MS;

async function logRun(
  supabase: ReturnType<typeof createClient>,
  status: "succeeded" | "failed" | "partial",
  message: string,
  details?: Record<string, unknown>,
) {
  try {
    await supabase.from("edge_function_runs").insert({
      function_name: "reconcile-order-ghosts",
      started_at: RUN_STARTED_AT,
      ended_at: new Date().toISOString(),
      duration_ms: Date.now() - START_TIME,
      status,
      message,
      details: details ?? null,
    });
  } catch (e) {
    console.error("logRun failed:", e);
  }
}

interface MintsoftStatus {
  ID: number;
  ExternalName: string;
  Active?: boolean;
}

interface MintsoftOrder {
  ID: number;
  OrderDate: string;
}

const TERMINAL_NAMES = [
  "despatched",
  "dispatched",
  "cancelled",
  "completed",
  "delivered",
  "refunded",
  "returned",
  "closed",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    console.log("Starting ghost-closure reconciliation...");

    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("MINTSOFT_API_KEY not configured");

    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("base_url")
      .limit(1)
      .single();
    if (!settings) throw new Error("Mintsoft settings not found");

    // 1. Fetch all non-terminal status IDs
    const statusResp = await fetch(`${settings.base_url}/api/Order/Statuses`, {
      headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
    });
    if (!statusResp.ok) throw new Error(`Status fetch failed: ${statusResp.status}`);
    const statuses: MintsoftStatus[] = await statusResp.json();
    const nonTerminalIds = statuses
      .filter(
        (s) =>
          s.ID &&
          s.ExternalName &&
          s.Active !== false &&
          !TERMINAL_NAMES.some((t) => s.ExternalName.toLowerCase().includes(t)),
      )
      .map((s) => s.ID);
    console.log(`Sweeping ${nonTerminalIds.length} non-terminal statuses`);

    // 2. Build the live "still-open" set
    const openInMintsoft = new Set<number>();
    let timedOut = false;
    let pagesFetched = 0;
    for (const statusId of nonTerminalIds) {
      if (isTimeRunningOut()) {
        timedOut = true;
        break;
      }
      let pageNo = 1;
      while (true) {
        if (isTimeRunningOut()) {
          timedOut = true;
          break;
        }
        const resp = await fetch(
          `${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&Limit=100&PageNo=${pageNo}`,
          { headers: { "ms-apikey": apiKey, "Content-Type": "application/json" } },
        );
        if (!resp.ok) break;
        const orders: MintsoftOrder[] = await resp.json();
        if (orders.length === 0) break;
        for (const o of orders) openInMintsoft.add(o.ID);
        pagesFetched++;
        if (orders.length < 100 || pageNo >= 50) break;
        pageNo++;
      }
      if (timedOut) break;
    }
    console.log(
      `Open-in-Mintsoft set: ${openInMintsoft.size} orders (${pagesFetched} pages${timedOut ? ", TIMED OUT" : ""})`,
    );

    // We refuse to mark anything if the sweep was incomplete — better to do
    // nothing than to mass-flag legitimately-open orders as despatched.
    if (timedOut) {
      const msg = `Aborted: status sweep timed out after ${pagesFetched} pages. No rows updated.`;
      await logRun(supabase, "partial", msg, { open_count: openInMintsoft.size, pages_fetched: pagesFetched });
      return new Response(
        JSON.stringify({
          success: false,
          partial: true,
          message: msg,
          open_count: openInMintsoft.size,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3. Page through DB and flag ghosts in batches
    const now = new Date().toISOString();
    const PAGE = 1000;
    let offset = 0;
    let scanned = 0;
    let ghostsClosed = 0;

    while (true) {
      if (isTimeRunningOut()) {
        console.log("Hit time budget during DB sweep, returning progress");
        break;
      }
      const { data: openRows, error } = await supabase
        .from("order_lines")
        .select("id, mintsoft_order_id, order_status")
        .in("order_status", ["NEW", "AWAITINGPICKING", "ONBACKORDER"])
        .gte("order_date", "2026-01-01T00:00:00Z")
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) {
        console.error("DB fetch error:", error);
        break;
      }
      if (!openRows || openRows.length === 0) break;
      scanned += openRows.length;

      const ghostIds = openRows
        .filter((r) => !openInMintsoft.has(r.mintsoft_order_id))
        .map((r) => r.id);

      if (ghostIds.length > 0) {
        for (let i = 0; i < ghostIds.length; i += 500) {
          const batch = ghostIds.slice(i, i + 500);
          const { error: upErr } = await supabase
            .from("order_lines")
            .update({
              order_status: "DESPATCHED",
              order_status_id: 4,
              last_status_change_at: now,
              last_seen_at: now,
            })
            .in("id", batch);
          if (upErr) console.error("Update error:", upErr);
          else ghostsClosed += batch.length;
        }
      }

      if (openRows.length < PAGE) break;
      offset += PAGE;
    }

    console.log(`Reconciliation done. Scanned ${scanned} rows, closed ${ghostsClosed} ghosts.`);

    const summary = `Closed ${ghostsClosed} ghost order lines · scanned ${scanned} rows · ${openInMintsoft.size} live in Mintsoft`;
    await logRun(supabase, "succeeded", summary, {
      open_in_mintsoft: openInMintsoft.size,
      rows_scanned: scanned,
      ghosts_closed: ghostsClosed,
    });

    return new Response(
      JSON.stringify({
        success: true,
        open_in_mintsoft: openInMintsoft.size,
        rows_scanned: scanned,
        ghosts_closed: ghostsClosed,
        message: summary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Reconcile error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    await logRun(supabase, "failed", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
