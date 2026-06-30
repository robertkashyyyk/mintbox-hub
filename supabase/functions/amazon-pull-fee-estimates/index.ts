// ============================================================================
// amazon-pull-fee-estimates — Product Fees API (getMyFeesEstimates, batched).
// For each {asin, price}, asks Amazon for its OWN fee estimate AS IF FULFILLED BY
// AMAZON (IsAmazonFulfilled=true) -> the FBA fulfilment fee + referral fee. This
// is what powers "what would this FBM item net on FBA?" (FBA Switch).
//
// Body: { items: [{asin, price}], marketplaceId? }
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
async function spPost(endpoint: string, token: string, path: string, body: unknown) {
  const res = await fetch(endpoint + path, {
    method: "POST",
    headers: { "x-amz-access-token": token, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
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
const feeOf = (list: any[], type: string) => {
  const f = (list ?? []).find((x) => x?.FeeType === type);
  return f?.FeeAmount?.Amount ?? null;
};

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

  let input: any = {};
  try { input = req.method === "POST" ? await req.json() : {}; } catch { input = {}; }
  const items: Array<{ asin: string; price: number }> = (input?.items ?? [])
    .filter((i: any) => i?.asin && Number(i?.price) > 0)
    .map((i: any) => ({ asin: String(i.asin), price: Number(i.price) }));
  if (!items.length) return json({ error: "no items — pass { items: [{asin, price}] }" }, 400);

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);
    const out: any[] = [];
    const deadline = Date.now() + 130000;

    // Batch up to 20 per getMyFeesEstimates call; ~1 req/s.
    for (let i = 0; i < items.length; i += 20) {
      if (Date.now() > deadline) break;
      const batch = items.slice(i, i + 20);
      const reqBody = {
        FeesEstimateByIdRequestList: batch.map((it) => ({
          IdType: "ASIN",
          IdValue: it.asin,
          FeesEstimateRequest: {
            MarketplaceId: marketplaceId,
            IsAmazonFulfilled: true,
            Identifier: it.asin,
            PriceToEstimateFees: { ListingPrice: { CurrencyCode: "GBP", Amount: it.price } },
          },
        })),
      };
      const res = await spPost(endpoint, token, "/products/fees/v0/feesEstimate", reqBody);
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); i -= 20; continue; }
      if (!res.ok) return json({ error: "feesEstimate failed", status: res.status, detail: res.body, done: out.length }, 502);

      for (const r of res.body ?? []) {
        const asin = r?.FeesEstimateIdentifier?.IdValue ?? r?.FeesEstimateIdentifier?.SellerInputIdentifier;
        const status = r?.Status;
        const est = r?.FeesEstimate;
        const list = est?.FeeDetailList ?? [];
        out.push({
          asin,
          price_used: r?.FeesEstimateIdentifier?.PriceToEstimateFees?.ListingPrice?.Amount ?? null,
          fba_fee: feeOf(list, "FBAFees"),
          referral_fee: feeOf(list, "ReferralFee"),
          total_fees: est?.TotalFeesEstimate?.Amount ?? null,
          status,
          error_message: r?.Error?.Message ?? null,
        });
      }
      if (i + 20 < items.length) await new Promise((r) => setTimeout(r, 1100));
    }

    const priced = out.filter((o) => o.asin);
    const { data: ing, error: ingErr } = await supa.rpc("amazon_ingest_fee_estimates", {
      p_marketplace_id: marketplaceId, p_rows: priced,
    });
    if (ingErr) return json({ error: "ingest RPC failed", detail: ingErr.message, estimates: priced.length }, 500);

    const ok = priced.filter((o) => o.status === "Success" && o.fba_fee != null).length;
    return json({ ok: true, requested: items.length, estimated: priced.length, withFbaFee: ok, ingest: ing }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
