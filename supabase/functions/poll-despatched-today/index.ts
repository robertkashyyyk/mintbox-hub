// Authoritative despatched-today poller.
// Pages Mintsoft DESPATCHED newest-first and writes one row per
// (uk_date, mintsoft_order_id) into despatch_ledger. Stops the moment it
// crosses YESTERDAY's UK midnight (small safety lap), so once we're caught
// up each run only touches 1-3 pages of Mintsoft.
//
// The dashboard reads despatch_ledger (or get_despatched_today_authoritative)
// for an instant, authoritative count that doesn't depend on the big sync.

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
  OrderDate?: string | null;
  DespatchDate?: string | null;       // <-- the real Mintsoft field
  DespatchedDate?: string | null;
  DispatchedDate?: string | null;
  ShippedDate?: string | null;
  LastUpdated?: string | null;        // bumped when status flips to DESPATCHED
  OrderStatusId?: number;
  OrderStatus?: string | { ID: number; ExternalName: string } | null;
  OrderNumber?: string | null;
  ExternalOrderReference?: string | null;
  Channel?: { Name?: string } | string | null;
}

function ukDateOf(d: Date): string {
  // Format YYYY-MM-DD in Europe/London
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(d);
}

function todayUk(): string {
  return ukDateOf(new Date());
}

function ukMidnightUtc(ukDate: string): Date {
  // Midnight UK on the given date, returned as UTC instant.
  // Build via offset: ask the locale for the offset of that date at noon.
  // Cheaper alt: take noon UK that day, subtract 12h.
  const noonGuess = new Date(`${ukDate}T12:00:00Z`);
  const tzMins = -new Date(noonGuess.toLocaleString("en-US", { timeZone: "Europe/London" })).getTimezoneOffset();
  // Just compute the UTC instant for "ukDate 00:00 Europe/London".
  // Approach: try midnight Z then adjust by London offset at that moment.
  const probe = new Date(`${ukDate}T00:00:00Z`);
  const localStr = probe.toLocaleString("sv-SE", { timeZone: "Europe/London" });
  const localDate = new Date(localStr.replace(" ", "T") + "Z");
  const offsetMs = probe.getTime() - localDate.getTime();
  return new Date(probe.getTime() + offsetMs);
}

function extractDespatchedAt(o: MintsoftOrder): Date | null {
  // Prefer the actual Mintsoft despatch timestamp; fall back to LastUpdated
  // (which is bumped when status flips to DESPATCHED). OrderDate is the worst
  // fallback and only used if nothing else exists.
  const candidate = o.DespatchDate || o.DespatchedDate || o.DispatchedDate
    || o.ShippedDate || o.LastUpdated || o.OrderDate;
  if (!candidate) return null;
  const d = new Date(candidate);
  return isNaN(d.getTime()) ? null : d;
}

function extractChannel(o: MintsoftOrder): string | null {
  if (!o.Channel) return null;
  if (typeof o.Channel === "string") return o.Channel;
  return o.Channel.Name || null;
}

async function logRun(
  supabase: ReturnType<typeof createClient>,
  status: "succeeded" | "partial" | "failed",
  message: string,
  details?: Record<string, unknown>,
) {
  try {
    await supabase.from("edge_function_runs").insert({
      function_name: "poll-despatched-today",
      started_at: RUN_STARTED_AT,
      ended_at: new Date().toISOString(),
      duration_ms: Date.now() - START,
      status,
      message,
      details: details ?? null,
    });
  } catch (e) {
    console.error("logRun failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Load Mintsoft settings
    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("base_url")
      .single();
    const baseUrl = settings?.base_url || "https://api.mintsoft.co.uk";
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("MINTSOFT_API_KEY missing");

    // Discover the DESPATCHED status id
    const statusResp = await fetch(`${baseUrl}/api/Order/Statuses`, {
      headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
    });
    if (!statusResp.ok) throw new Error(`Statuses fetch failed: ${statusResp.status}`);
    const statuses = await statusResp.json() as Array<{ ID: number; ExternalName?: string }>;
    const despatched = statuses.find(s =>
      (s.ExternalName || "").toLowerCase().includes("despatch") ||
      (s.ExternalName || "").toLowerCase().includes("dispatch")
    );
    if (!despatched) throw new Error("Could not find DESPATCHED status");

    const today = todayUk();
    const yesterdayMidnight = ukMidnightUtc(today); // start of today UK = end of yesterday
    // Safety lap: keep paging until we cross the START of yesterday so any late
    // status flips for yesterday's tail still get captured.
    const yesterdayStart = new Date(yesterdayMidnight.getTime() - 24 * 3600 * 1000);

    let pageNo = 1;
    let inserted = 0;
    let scanned = 0;
    let stopped = "page_cap";
    const PAGE_CAP = 30; // 3000 orders worst case — only happens on a cold start
    const ledgerRows: Array<{
      uk_date: string;
      mintsoft_order_id: number;
      despatched_at: string;
      channel: string | null;
      order_number: string | null;
    }> = [];

    // Mintsoft sorts the despatched list newest-first by OrderDate (not by
    // despatch timestamp), so an order placed days ago and despatched today
    // can sit deep in the list. We page until OrderDate falls more than
    // ORDER_AGE_DAYS days behind today (anything older was certainly
    // despatched before today) OR we hit the page cap.
    const ORDER_AGE_DAYS = 14;
    const orderAgeFloor = new Date(Date.now() - ORDER_AGE_DAYS * 24 * 3600 * 1000);

    while (pageNo <= PAGE_CAP) {
      if (isOutOfTime()) { stopped = "timeout"; break; }
      const url = new URL(`${baseUrl}/api/Order/List`);
      url.searchParams.set("OrderStatusId", String(despatched.ID));
      url.searchParams.set("Limit", "100");
      url.searchParams.set("PageNo", String(pageNo));
      url.searchParams.set("SortOldestFirst", "false");

      const resp = await fetch(url.toString(), {
        headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
      });
      if (!resp.ok) { stopped = `http_${resp.status}`; break; }
      const orders = await resp.json() as MintsoftOrder[];
      if (!orders.length) { stopped = "empty_page"; break; }
      scanned += orders.length;

      let oldestOrderDateOnPage: Date | null = null;
      for (const o of orders) {
        const ts = extractDespatchedAt(o);
        if (!ts) continue;
        const uk = ukDateOf(ts);
        if (uk !== today) continue; // only ledger today's despatches
        ledgerRows.push({
          uk_date: uk,
          mintsoft_order_id: o.ID,
          despatched_at: ts.toISOString(),
          channel: extractChannel(o),
          order_number: o.OrderNumber || o.ExternalOrderReference || null,
        });
      }
      // Decide whether to keep paging based on OrderDate, not DespatchDate.
      for (const o of orders) {
        if (!o.OrderDate) continue;
        const od = new Date(o.OrderDate);
        if (!oldestOrderDateOnPage || od < oldestOrderDateOnPage) oldestOrderDateOnPage = od;
      }
      if (oldestOrderDateOnPage && oldestOrderDateOnPage < orderAgeFloor) {
        stopped = "order_age_floor";
        break;
      }
      if (orders.length < 100) { stopped = "short_page"; break; }
      pageNo++;
    }

    if (ledgerRows.length) {
      // Dedupe in-batch (defensive)
      const map = new Map<string, typeof ledgerRows[number]>();
      for (const r of ledgerRows) map.set(`${r.uk_date}|${r.mintsoft_order_id}`, r);
      const unique = [...map.values()];
      const { error, count } = await supabase
        .from("despatch_ledger")
        .upsert(unique, { onConflict: "uk_date,mintsoft_order_id", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      inserted = count ?? unique.length;
    }

    const { count: todayCount } = await supabase
      .from("despatch_ledger")
      .select("*", { count: "exact", head: true })
      .eq("uk_date", today);

    await logRun(supabase, isOutOfTime() ? "partial" : "succeeded",
      `Despatched today (${today}): ${todayCount ?? 0} | scanned ${scanned} pages=${pageNo} stop=${stopped} new=${inserted}`,
      { today, todayCount, scanned, pages: pageNo, stopped, inserted });

    return new Response(JSON.stringify({
      ok: true, today, todayCount, scanned, pages: pageNo, stopped, inserted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("poll-despatched-today error:", msg);
    await logRun(supabase, "failed", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
