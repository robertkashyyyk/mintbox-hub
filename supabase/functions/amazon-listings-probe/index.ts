// ============================================================================
// amazon-listings-probe — READ-ONLY capability probe for the Listings Items API.
//
// Answers: does our SP-API app have the Product Listing role (needed to
// amend/delete listings)? Three checks, no writes anywhere:
//   1. GET /definitions/2020-09-01/productTypes  — needs the Product Listing
//      role but NO sellerId: a clean role test (403 = role missing).
//   2. GET /sellers/v1/account — marketplace participations (does NOT expose
//      sellerId; Amazon never returns the merchant token via API).
//   3. GET /listings/2021-08-01/items/{sellerId}/{sku} — the exact resource
//      PATCH (amend) and DELETE operate on. sellerId comes from the body or
//      amazon.connection.seller_id (merchant token, from Seller Central).
//
// Body: { sku?: string (default "NGK_ASP_7811"), sellerId?: string }
// Verified 2026-07-23: role GRANTED; item GET 200 with sellerId A18KNZ0ID7MNQY.
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
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`LWA token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function spGet(endpoint: string, token: string, path: string) {
  const res = await fetch(endpoint + path, {
    headers: { "x-amz-access-token": token, accept: "application/json" },
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  return { status: res.status, body: parsed };
}

function jwtRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded))?.role ?? null;
  } catch {
    return null;
  }
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

  if (!clientId || !clientSecret || !refreshToken) {
    return json({ error: "SP-API secrets missing from the Edge Function vault." }, 500);
  }
  const endpoint = ENDPOINTS[region] ?? ENDPOINTS.eu;

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  let authed = !!bearer && bearer === SERVICE_KEY;
  if (!authed && bearer) {
    const role = jwtRole(bearer);
    if (role === "service_role") {
      authed = true;
    } else if (role === "authenticated") {
      const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data } = await uc.auth.getUser();
      authed = !!data?.user?.id;
    }
  }
  if (!authed) return json({ error: "Unauthorized" }, 401);

  let input: { sku?: string; sellerId?: string } = {};
  try {
    input = req.method === "POST" ? await req.json() : {};
  } catch {
    input = {};
  }
  const sku = typeof input?.sku === "string" && input.sku ? input.sku : "NGK_ASP_7811";

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);

    const ptd = await spGet(
      endpoint, token,
      `/definitions/2020-09-01/productTypes?marketplaceIds=${marketplaceId}`,
    );

    const account = await spGet(endpoint, token, `/sellers/v1/account`);

    // sellerId: explicit body param, else amazon.connection.seller_id.
    let sellerId: string | undefined =
      typeof input?.sellerId === "string" && input.sellerId ? input.sellerId : undefined;
    if (!sellerId) {
      const supa = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data } = await supa.rpc("amazon_get_seller_id");
      sellerId = typeof data === "string" && data ? data : undefined;
    }

    let listingsItem: unknown = { skipped: "no sellerId (body or amazon.connection.seller_id)" };
    if (sellerId) {
      listingsItem = await spGet(
        endpoint, token,
        `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}?marketplaceIds=${marketplaceId}&includedData=summaries`,
      );
    }

    const roleGranted = ptd.status === 200;
    return json({
      ok: true,
      marketplaceId,
      sellerIdUsed: sellerId ?? null,
      probes: {
        productTypeDefinitions: { status: ptd.status, sample: roleGranted ? undefined : ptd.body },
        sellersAccount: { status: account.status },
        listingsItem,
      },
      verdict: roleGranted
        ? "Product Listing role GRANTED — Listings Items API (amend/delete) is available to this app."
        : "Product Listing role appears MISSING (productTypes returned " + ptd.status +
          ") — enable the role on the SP-API app and re-authorise the seller.",
    });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
