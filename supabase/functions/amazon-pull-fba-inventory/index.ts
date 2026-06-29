// ============================================================================
// amazon-pull-fba-inventory — Phase 3a. On-hand fulfillable + inbound per SKU.
//
// Uses the FBA Inventory API (getInventorySummaries, details=true) rather than
// the GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA report — the report type is being
// deprecated and fails generation intermittently (FATAL). The API is real-time,
// paginated, and returns fulfillable + inbound (working/shipped/receiving)
// directly. This snapshot is the only missing input to public.v_fba_replenishment.
//
// Body: { pollSeconds?: number unused }   (snapshot = current state)
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
  na: "https://sellingpartnerapi-na.amazon.com", eu: "https://sellingpartnerapi-eu.amazon.com", fe: "https://sellingpartnerapi-fe.amazon.com",
};
const UK_MARKETPLACE = "A1F83G8C2ARO7P";

async function getLwaToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  const res = await fetch(LWA_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`LWA token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}
async function spGet(endpoint: string, token: string, path: string) {
  const res = await fetch(endpoint + path, { method: "GET", headers: { "x-amz-access-token": token, accept: "application/json" } });
  const text = await res.text();
  let parsed: any; try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { ok: res.ok, status: res.status, body: parsed };
}
function jwtRole(jwt: string): string | null {
  try { const part = jwt.split(".")[1]; if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role ?? null;
  } catch { return null; }
}
const n = (v: unknown) => Number(v ?? 0) || 0;

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

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  let authed = !!bearer && bearer === SERVICE_KEY;
  if (!authed && bearer) {
    const role = jwtRole(bearer);
    if (role === "service_role") authed = true;
    else if (role === "authenticated") {
      const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data } = await uc.auth.getUser(); authed = !!data?.user?.id;
    }
  }
  if (!authed) return json({ error: "Unauthorized" }, 401);
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const base = `/fba/inventory/v1/summaries?details=true&granularityType=Marketplace&granularityId=${marketplaceId}&marketplaceIds=${marketplaceId}`;

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);
    const summaries: any[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    const deadline = Date.now() + 120000;
    while (true) {
      const path = nextToken ? `${base}&nextToken=${encodeURIComponent(nextToken)}` : base;
      const res = await spGet(endpoint, token, path);
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      if (!res.ok) return json({ error: "getInventorySummaries failed", status: res.status, detail: res.body }, 502);
      const list = res.body?.payload?.inventorySummaries ?? [];
      summaries.push(...list);
      pages++;
      nextToken = res.body?.pagination?.nextToken;
      if (!nextToken || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 600)); // ~2 req/s
    }

    const rows = summaries.map((s) => {
      const d = s.inventoryDetails ?? {};
      const inbound = n(d.inboundWorkingQuantity) + n(d.inboundShippedQuantity) + n(d.inboundReceivingQuantity);
      const total = n(s.totalQuantity);
      return {
        sku: s.sellerSku ?? "",
        fnsku: s.fnSku ?? "",
        asin: s.asin ?? "",
        product_name: s.productName ?? "",
        afn_listing_exists: s.sellerSku ? "Yes" : "",
        afn_warehouse_quantity: String(Math.max(0, total - inbound)),
        afn_fulfillable_quantity: String(n(d.fulfillableQuantity)),
        afn_unsellable_quantity: String(n(d.unfulfillableQuantity?.totalUnfulfillableQuantity)),
        afn_reserved_quantity: String(n(d.reservedQuantity?.totalReservedQuantity)),
        afn_total_quantity: String(total),
        afn_inbound_working_quantity: String(n(d.inboundWorkingQuantity)),
        afn_inbound_shipped_quantity: String(n(d.inboundShippedQuantity)),
        afn_inbound_receiving_quantity: String(n(d.inboundReceivingQuantity)),
      };
    }).filter((r) => r.sku);

    const { data: ing, error: ingErr } = await supa.rpc("amazon_ingest_fba_inventory", {
      p_marketplace_id: marketplaceId, p_snapshot_date: snapshotDate,
      p_report_id: `inv-api-${snapshotDate}`, p_document_id: null, p_processing_status: "DONE", p_rows: rows,
    });
    if (ingErr) return json({ error: "ingest RPC failed", detail: ingErr.message, rows: rows.length }, 500);

    const onHand = rows.reduce((a, r) => a + Number(r.afn_fulfillable_quantity), 0);
    const inbound = rows.reduce((a, r) => a + Number(r.afn_inbound_working_quantity) + Number(r.afn_inbound_shipped_quantity) + Number(r.afn_inbound_receiving_quantity), 0);
    return json({ ok: true, snapshotDate, source: "getInventorySummaries", pages, skus: rows.length, totalFulfillable: onHand, totalInbound: inbound, ingest: ing }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
