// ============================================================================
// ebay-admin — internal ops for the eBay connection (service callers only).
// Body { action, ... }:
//   check_config                 which secrets are set (names only), app token works,
//                                signing key present, per-account token status
//   create_signing_key [force]   Key Management createSigningKey (ED25519, app token);
//                                private key straight into Vault, never returned
//   smoke_test { account }       one harmless read per scope, sanitised response shapes,
//                                Finances unsigned vs signed, and a write that must be blocked
// Everything goes through the shared read-only client (allowlist.ts).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCaller } from "../_shared/internal_auth.ts";
import {
  ACCOUNT_DELETION_ENDPOINT, EBAY_API, EBAY_APIZ, hasSecret, OAUTH_ACCEPT_URL, OAUTH_DECLINE_URL, SCOPES_SIGNED_OFF,
  SECRET, USER_SCOPES,
} from "../_shared/ebay/config.ts";
import { CallLog, ebayFetch, EbayWriteBlockedError } from "../_shared/ebay/client.ts";
import { shape, stripPii } from "../_shared/ebay/pii.ts";
import { signedHeaders } from "../_shared/ebay/signing.ts";
import { getAppToken, getUserAccessToken } from "../_shared/ebay/tokens.ts";

const FN = "ebay-admin";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const caller = await requireCaller(req, { fn: FN, trustGatewayServiceJwt: true });
  if (caller instanceof Response) return caller;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const log = new CallLog(supa, FN);
  try {
    switch (body.action) {
      case "check_config": return json(await checkConfig(supa));
      case "create_signing_key": return json(await createSigningKey(supa, log, body.force === true));
      case "smoke_test": return json(await smokeTest(supa, log, String(body.account ?? "").toUpperCase()));
      default: return json({ ok: false, error: "action must be check_config | create_signing_key | smoke_test" }, 400);
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  } finally {
    await log.flush();
  }
});

async function activeKey(supa: any) {
  const { data } = await supa.rpc("ebay_get_signing_key");
  const k = (data ?? [])[0];
  return k ? { id: k.signing_key_id as string, privateKey: k.private_key as string, jwe: k.jwe as string, expiresAt: k.expires_at } : null;
}

async function checkConfig(supa: any) {
  const secrets = Object.fromEntries(Object.values(SECRET).map((n) => [n, hasSecret(n)]));
  let appToken: string = "skipped (EBAY_APP_ID / EBAY_CERT_ID not set)";
  if (hasSecret(SECRET.appId) && hasSecret(SECRET.certId)) {
    try { await getAppToken(); appToken = "ok"; } catch (e) { appToken = `failed: ${(e as Error).message}`; }
  }
  const key = await activeKey(supa);
  const { data: accounts } = await supa.from("ebay_accounts")
    .select("code, ebay_username, threeds_store_name, token_status, refresh_token_expires_at, last_success_at, last_error").order("sort_order");
  return {
    ok: true, secrets, appToken, scopesSignedOff: SCOPES_SIGNED_OFF, scopes: USER_SCOPES,
    endpoints: { accountDeletion: ACCOUNT_DELETION_ENDPOINT, ruNameAccept: OAUTH_ACCEPT_URL, ruNameDecline: OAUTH_DECLINE_URL },
    signingKey: key ? { id: key.id, expiresAt: key.expiresAt } : null,
    accounts,
  };
}

async function createSigningKey(supa: any, log: CallLog, force: boolean) {
  const existing = await activeKey(supa);
  if (existing && !force) return { ok: false, error: `active signing key ${existing.id} exists (expires ${existing.expiresAt}); pass force:true to replace` };
  const res = await ebayFetch<any>({
    method: "POST", url: `${EBAY_APIZ}/developer/key_management/v1/signing_key`,
    body: { signingKeyCipher: "ED25519" }, token: await getAppToken(), log, maxAttempts: 2,
  });
  const k = res.json;
  if (res.status !== 201 && res.status !== 200 || !k?.privateKey || !k?.jwe || !k?.signingKeyId) {
    return { ok: false, status: res.status, error: res.text.slice(0, 300) };
  }
  const toTs = (v: unknown) => new Date(Number(v) * 1000).toISOString();
  const { error } = await supa.rpc("ebay_store_signing_key", {
    p_signing_key_id: k.signingKeyId, p_cipher: k.signingKeyCipher ?? "ED25519", p_private_key: k.privateKey,
    p_jwe: k.jwe, p_public_key: k.publicKey ?? null, p_created_at: toTs(k.creationTime), p_expires_at: toTs(k.expirationTime),
  });
  if (error) return { ok: false, error: `eBay created key ${k.signingKeyId} but storing it failed: ${error.message}` };
  // Prove the stored key imports and signs (format check), without calling eBay.
  let importOk = true, importError: string | undefined;
  try { await signedHeaders({ privateKey: k.privateKey, jwe: k.jwe }, "GET", `${EBAY_APIZ}/sell/finances/v1/transaction`); }
  catch (e) { importOk = false; importError = (e as Error).message; }
  return { ok: importOk, signingKeyId: k.signingKeyId, expiresAt: toTs(k.expirationTime), keyImports: importOk, importError };
}

async function smokeTest(supa: any, log: CallLog, account: string) {
  if (!account) return { ok: false, error: "account required" };
  const token = await getUserAccessToken(supa, account);
  const key = await activeKey(supa);
  const day = new Date(Date.now() - 2 * 86400_000);
  const from = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const to = new Date(from.getTime() + 86400_000);
  const finQuery = { filter: `transactionDate:[${from.toISOString()}..${to.toISOString()}]`, limit: 20 };
  const base = { token, account, log, maxAttempts: 3 };

  type Check = { name: string; scope: string; call: () => Promise<{ status: number; json: unknown; text: string }> };
  const checks: Check[] = [
    { name: "identity getUser", scope: "commerce.identity.readonly",
      call: () => ebayFetch({ ...base, url: `${EBAY_APIZ}/commerce/identity/v1/user/` }) },
    { name: "analytics findSellerStandardsProfiles", scope: "sell.analytics.readonly",
      call: () => ebayFetch({ ...base, url: `${EBAY_API}/sell/analytics/v1/seller_standards_profile` }) },
    { name: "finances getTransactions (UNSIGNED, expected to be refused)", scope: "sell.finances",
      call: () => ebayFetch({ ...base, url: `${EBAY_APIZ}/sell/finances/v1/transaction`, query: finQuery, maxAttempts: 1 }) },
    { name: "finances getTransactions (signed, 1 day)", scope: "sell.finances",
      call: () => key ? ebayFetch({ ...base, url: `${EBAY_APIZ}/sell/finances/v1/transaction`, query: finQuery, signingKey: key })
                      : Promise.resolve({ status: 0, json: null, text: "no signing key yet (run create_signing_key)" }) },
    { name: "fulfillment getOrders (1 page)", scope: "sell.fulfillment.readonly",
      call: () => ebayFetch({ ...base, url: `${EBAY_API}/sell/fulfillment/v1/order`, query: { limit: 5 } }) },
    { name: "marketing getCampaigns", scope: "sell.marketing",
      call: () => ebayFetch({ ...base, url: `${EBAY_API}/sell/marketing/v1/ad_campaign`, query: { limit: 5 } }) },
    { name: "feed getInventoryTasks", scope: "sell.inventory",
      call: () => ebayFetch({ ...base, url: `${EBAY_API}/sell/feed/v1/inventory_task`, query: { feed_type: "LMS_ACTIVE_INVENTORY_REPORT", limit: 5 } }) },
    { name: "account getPrivileges", scope: "sell.account.readonly",
      call: () => ebayFetch({ ...base, url: `${EBAY_API}/sell/account/v1/privilege` }) },
  ];

  const results = [];
  for (const c of checks) {
    try {
      const r = await c.call();
      results.push({ name: c.name, scope: c.scope, status: r.status,
                     shape: r.json ? shape(stripPii(r.json)) : r.text.slice(0, 200) });
    } catch (e) {
      results.push({ name: c.name, scope: c.scope, status: 0, error: (e as Error).message });
    }
  }

  // Must never leave the building: a campaign pause and an offer publish.
  const blocked = [];
  for (const [method, url] of [
    ["POST", `${EBAY_API}/sell/marketing/v1/ad_campaign/123456789/pause`],
    ["POST", `${EBAY_API}/sell/inventory/v1/offer/123456789/publish`],
  ] as const) {
    try {
      await ebayFetch({ ...base, method, url, body: {} });
      blocked.push({ method, url, blocked: false, note: "NOT BLOCKED: investigate" });
    } catch (e) {
      blocked.push({ method, url, blocked: e instanceof EbayWriteBlockedError });
    }
  }

  const ok = results.every((r) => r.name.includes("UNSIGNED") || r.status === 200 || r.status === 204) && blocked.every((b) => b.blocked);
  await supa.rpc("ebay_mark_account", { p_account: account, p_ok: ok, p_error: ok ? null : "smoke test: see ebay.api_call_log" });
  return { ok, account, window: { from: from.toISOString(), to: to.toISOString() }, results, blocked };
}
