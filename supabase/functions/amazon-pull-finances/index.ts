// ============================================================================
// amazon-pull-finances — Phase 2b. Pulls the Finances API (listFinancialEvents)
// for a <=7-day posted window, flattens the deeply-nested charge/fee/promo
// lists into normalised event rows, and ingests via amazon_ingest_financial_events.
//
// This is where real margin comes from: Principal (revenue), Commission
// (referral fee), FBAPerUnitFulfillmentFee, promotions, refunds, service fees.
// Amazon sends fees as NEGATIVE amounts; the RPC stores abs(amount)+direction.
//
// Paginates via NextToken; if it runs out of time budget it returns
// { done:false, nextToken } so a driver can resume the same window.
//
// Body: { start?: "YYYY-MM-DD", end?: "YYYY-MM-DD" (default last 7 days),
//         nextToken?: string, budgetSeconds?: number }
// Auth: service-role JWT (cron/ops) OR a valid authenticated user.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const ENDPOINTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const UK_MARKETPLACE = "A1F83G8C2ARO7P";

async function getLwaToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!res.ok) throw new Error(`LWA token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function spGet(endpoint: string, token: string, path: string) {
  const res = await fetch(endpoint + path, {
    method: "GET",
    headers: { "x-amz-access-token": token, accept: "application/json" },
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { ok: res.ok, status: res.status, body: parsed };
}

function jwtRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role ?? null;
  } catch { return null; }
}

// Pull one {Type, *Amount} component list into normalised event rows. The hash
// is stable across re-pulls of the same window (deterministic order + index),
// so ingest is idempotent. A component only appears in the window containing
// its PostedDate, so there is no cross-window duplication.
function flattenComponents(
  out: any[],
  eventType: string,
  listName: string,
  postedDate: string,
  orderId: string,
  sku: string,
  list: any[] | undefined,
  typeKey: string,
  amountKey: string,
) {
  if (!Array.isArray(list)) return;
  list.forEach((comp) => {
    const amt = comp?.[amountKey]?.CurrencyAmount;
    if (amt === undefined || amt === null || Number(amt) === 0) return;
    const subtype = String(comp?.[typeKey] ?? listName);
    // Stable identity of the economic event — NO array positions. The occurrence
    // index (for genuinely-repeated identical charges, e.g. two equal-value split
    // shipments) is stamped in a post-pass in flattenFinancialEvents so it is
    // deterministic across re-pulls. Including the AMOUNT keeps different-value
    // split shipments distinct without needing positional keys.
    // 2026-08: replaces the old array-position pathKey, which changed every pull
    // and so DUPLICATED every re-pulled order's revenue+fees.
    out.push({
      event_type: eventType,
      event_subtype: subtype,
      posted_date: postedDate,
      amazon_order_id: orderId ?? "",
      sku: sku ?? "",
      asin: "",
      original_amount: Number(amt),
      currency_code: comp?.[amountKey]?.CurrencyCode ?? "GBP",
      fee_description: subtype,
      _base: `${eventType}|${orderId ?? ""}|${sku ?? ""}|${listName}|${subtype}|${postedDate}|${Number(amt)}`,
    });
  });
}

function flattenFinancialEvents(fe: any): any[] {
  const out: any[] = [];
  if (!fe) return out;

  (fe.ShipmentEventList ?? []).forEach((se: any) => {
    const posted = se.PostedDate;
    const order = se.AmazonOrderId;
    if (!posted) return;
    (se.ShipmentItemList ?? []).forEach((si: any) => {
      const sku = si.SellerSKU ?? "";
      flattenComponents(out, "Shipment", "ItemCharge", posted, order, sku, si.ItemChargeList, "ChargeType", "ChargeAmount");
      flattenComponents(out, "Shipment", "ItemFee", posted, order, sku, si.ItemFeeList, "FeeType", "FeeAmount");
      flattenComponents(out, "Shipment", "Promotion", posted, order, sku, si.PromotionList, "PromotionType", "PromotionAmount");
    });
  });

  (fe.RefundEventList ?? []).forEach((re: any) => {
    const posted = re.PostedDate;
    const order = re.AmazonOrderId;
    if (!posted) return;
    (re.ShipmentItemAdjustmentList ?? []).forEach((si: any) => {
      const sku = si.SellerSKU ?? "";
      flattenComponents(out, "Refund", "ItemChargeAdj", posted, order, sku, si.ItemChargeAdjustmentList, "ChargeType", "ChargeAmount");
      flattenComponents(out, "Refund", "ItemFeeAdj", posted, order, sku, si.ItemFeeAdjustmentList, "FeeType", "FeeAmount");
      flattenComponents(out, "Refund", "PromotionAdj", posted, order, sku, si.PromotionAdjustmentList, "PromotionType", "PromotionAmount");
    });
  });

  // Stamp a deterministic occurrence index onto each event's hash: within one pull,
  // rows sharing the SAME stable identity (order|sku|listName|subtype|postedDate|amount)
  // are numbered 0,1,2… so genuinely-repeated identical charges are kept, while a
  // re-pull of the same window reproduces the exact same hashes → idempotent ingest,
  // no duplication. (Order within a group is irrelevant since the rows are identical.)
  const occ = new Map<string, number>();
  for (const row of out) {
    const k = row._base as string;
    const n = occ.get(k) ?? 0;
    occ.set(k, n + 1);
    row.event_hash = `${k}|${n}`;
    delete row._base;
  }

  // Scope: ORDER-LINKED economics only (Shipment + Refund). Storage fees and ad
  // spend (ServiceFeeEventList / ProductAdsPaymentEventList) are intentionally
  // NOT ingested here — they get their own separate pass later.

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const clientId = Deno.env.get("SP_API_LWA_CLIENT_ID");
  const clientSecret = Deno.env.get("SP_API_LWA_CLIENT_SECRET");
  const refreshToken = Deno.env.get("SP_API_REFRESH_TOKEN");
  const region = (Deno.env.get("SP_API_REGION") || "eu").toLowerCase();
  const marketplaceId = (Deno.env.get("SP_API_MARKETPLACE_IDS") || UK_MARKETPLACE).split(",")[0].trim();
  if (!clientId || !clientSecret || !refreshToken) return json({ error: "SP-API secrets missing" }, 500);
  const endpoint = ENDPOINTS[region] ?? ENDPOINTS.eu;

  // ---- Auth ----------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  let authed = !!bearer && bearer === SERVICE_KEY;
  if (!authed && bearer) {
    const role = jwtRole(bearer);
    if (role === "service_role") authed = true;
    else if (role === "authenticated") {
      const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data } = await uc.auth.getUser();
      authed = !!data?.user?.id;
    }
  }
  if (!authed) return json({ error: "Unauthorized" }, 401);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- Input / window ------------------------------------------------------
  let input: any = {};
  try { input = req.method === "POST" ? await req.json() : {}; } catch { input = {}; }
  const now = new Date();
  const dayMs = 24 * 3600 * 1000;
  // Finances requires PostedBefore to be at least ~2 min in the past; pad 5 min.
  const safeNow = new Date(now.getTime() - 5 * 60 * 1000);
  let end = /^\d{4}-\d{2}-\d{2}$/.test(input?.end) ? new Date(`${input.end}T23:59:59Z`) : safeNow;
  if (end > safeNow) end = safeNow;
  const start = /^\d{4}-\d{2}-\d{2}$/.test(input?.start)
    ? new Date(`${input.start}T00:00:00Z`)
    : new Date(end.getTime() - 7 * dayMs);
  const budgetSeconds = Math.min(Number(input?.budgetSeconds) > 0 ? Number(input.budgetSeconds) : 120, 140);
  const deadline = Date.now() + budgetSeconds * 1000;

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);

    let nextToken: string | undefined = typeof input?.nextToken === "string" ? input.nextToken : undefined;
    let pages = 0;
    let totalSeen = 0;
    let totalInserted = 0;
    // Signed roll-up by fee type across this invocation (quick margin readout).
    const summary: Record<string, { net: number; n: number }> = {};
    const roll = (events: any[]) => {
      for (const e of events) {
        const k = `${e.event_type}:${e.event_subtype}`;
        (summary[k] ??= { net: 0, n: 0 });
        summary[k].net = Math.round((summary[k].net + Number(e.original_amount)) * 100) / 100;
        summary[k].n++;
      }
    };

    while (true) {
      const qs = nextToken
        ? `?NextToken=${encodeURIComponent(nextToken)}`
        : `?MaxResultsPerPage=100&PostedAfter=${encodeURIComponent(start.toISOString())}&PostedBefore=${encodeURIComponent(end.toISOString())}`;
      const res = await spGet(endpoint, token, `/finances/v0/financialEvents${qs}`);
      if (res.status === 429) {
        // throttled — hand the token back so the driver waits and resumes
        return json({ done: false, nextToken, start: start.toISOString(), end: end.toISOString(),
          throttled: true, pages, eventsSeen: totalSeen, eventsInserted: totalInserted }, 200);
      }
      if (!res.ok) return json({ error: "listFinancialEvents failed", status: res.status, detail: res.body }, 502);

      const fe = res.body?.payload?.FinancialEvents ?? {};
      const tok = res.body?.payload?.NextToken as string | undefined;
      const events = flattenFinancialEvents(fe);
      pages++;
      totalSeen += events.length;
      roll(events);

      const { data: ing, error: ingErr } = await supa.rpc("amazon_ingest_financial_events", {
        p_marketplace_id: marketplaceId,
        p_window_start: start.toISOString(),
        p_window_end: end.toISOString(),
        p_request_params: { PostedAfter: start.toISOString(), PostedBefore: end.toISOString() },
        p_next_token: tok ?? null,
        p_raw_payload: fe,
        p_events: events,
      });
      if (ingErr) return json({ error: "ingest RPC failed", detail: ingErr.message, page: pages, events: events.length }, 500);
      totalInserted += (ing?.events_inserted ?? 0);

      nextToken = tok;
      if (!nextToken) {
        return json({ ok: true, done: true, start: start.toISOString(), end: end.toISOString(),
          pages, eventsSeen: totalSeen, eventsInserted: totalInserted, summary }, 200);
      }
      if (Date.now() > deadline) {
        return json({ ok: true, done: false, nextToken, start: start.toISOString(), end: end.toISOString(),
          message: "Out of time budget — re-invoke with { nextToken } to continue.",
          pages, eventsSeen: totalSeen, eventsInserted: totalInserted, summary }, 200);
      }
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), start: start.toISOString(), end: end.toISOString() }, 500);
  }
});
