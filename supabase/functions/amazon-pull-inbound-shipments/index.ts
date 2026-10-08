// ============================================================================
// amazon-pull-inbound-shipments — FBA Inbound v0 shipments mirror (Part 3.10).
//
// Pulls every shipment in the "on its way" statuses (WORKING, SHIPPED,
// IN_TRANSIT, DELIVERED, CHECKED_IN) plus their items, and ingests them via
// amazon_ingest_inbound_shipments (full replace per marketplace). The FBA
// Replenishment snapshot counts shipment units not yet visible in
// getInventorySummaries inbound as in-transit, so freshly created send-ins
// are never suggested twice.
//
// Body: {}   Auth: service-role JWT (cron/ops) OR a valid authenticated user.
// Cron: amazon-nightly-inbound-shipments at 02:18.
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
const STATUSES = "WORKING,SHIPPED,IN_TRANSIT,DELIVERED,CHECKED_IN";

async function getLwaToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  const res = await fetch(LWA_TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!res.ok) throw new Error(`LWA token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}
async function spGet(endpoint: string, token: string, path: string) {
  const res = await fetch(endpoint + path, { headers: { "x-amz-access-token": token, accept: "application/json" } });
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
  let authed = !!bearer && (bearer === SERVICE_KEY || jwtRole(bearer) === "service_role");
  if (!authed && bearer && jwtRole(bearer) === "authenticated") {
    const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data } = await uc.auth.getUser(); authed = !!data?.user?.id;
  }
  if (!authed) return json({ error: "Unauthorized" }, 401);
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);

    // 1. Shipments in watched statuses (paginated).
    const shipments: any[] = [];
    let nextToken: string | undefined;
    for (let page = 0; page < 20; page++) {
      const path = nextToken
        ? `/fba/inbound/v0/shipments?QueryType=NEXT_TOKEN&NextToken=${encodeURIComponent(nextToken)}&MarketplaceId=${marketplaceId}`
        : `/fba/inbound/v0/shipments?QueryType=SHIPMENT&ShipmentStatusList=${STATUSES}&MarketplaceId=${marketplaceId}`;
      const res = await spGet(endpoint, token, path);
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 2200)); page--; continue; }
      if (!res.ok) return json({ error: "getShipments failed", status: res.status, detail: res.body }, 502);
      shipments.push(...(res.body?.payload?.ShipmentData ?? []));
      nextToken = res.body?.payload?.NextToken;
      if (!nextToken) break;
      await new Promise((r) => setTimeout(r, 600));
    }

    // 2. Items per shipment.
    const items: any[] = [];
    for (const sh of shipments) {
      const id = sh?.ShipmentId;
      if (!id) continue;
      let itemsToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const path = itemsToken
          ? `/fba/inbound/v0/shipments/${encodeURIComponent(id)}/items?QueryType=NEXT_TOKEN&NextToken=${encodeURIComponent(itemsToken)}&MarketplaceId=${marketplaceId}`
          : `/fba/inbound/v0/shipments/${encodeURIComponent(id)}/items?MarketplaceId=${marketplaceId}`;
        const res = await spGet(endpoint, token, path);
        if (res.status === 429) { await new Promise((r) => setTimeout(r, 2200)); page--; continue; }
        if (!res.ok) return json({ error: "getShipmentItems failed", shipment: id, status: res.status, detail: res.body }, 502);
        for (const it of res.body?.payload?.ItemData ?? []) items.push({ ...it, ShipmentId: id });
        itemsToken = res.body?.payload?.NextToken;
        if (!itemsToken) break;
        await new Promise((r) => setTimeout(r, 600));
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const { data: ing, error: ingErr } = await supa.rpc("amazon_ingest_inbound_shipments", {
      p_marketplace_id: marketplaceId, p_shipments: shipments, p_items: items,
    });
    if (ingErr) return json({ error: "ingest RPC failed", detail: ingErr.message }, 500);

    return json({ ok: true, marketplaceId, shipments: shipments.length, items: items.length, ingest: ing });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
