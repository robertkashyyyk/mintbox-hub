// ============================================================================
// ebay-oauth-start — mints a one-account eBay consent link.
// Callers (shared requireCaller): a signed-in Hub super_user, or the service (ops).
// Body: { account: "ASC" | "CPI" | "123" | "TSS" | "UNI" }
// Returns { account, consentUrl, expiresAt }. The link is single-use and expires in 20 min.
// prompt=login makes eBay ask for a sign-in every time, so consenting five accounts in
// one browser can't silently reuse the last account's session.
// Refused (409) until the scope list is signed off (config.SCOPES_SIGNED_OFF).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCaller } from "../_shared/internal_auth.ts";
import { EBAY_AUTHORIZE_URL, SCOPES_SIGNED_OFF, SECRET, secret, USER_SCOPES } from "../_shared/ebay/config.ts";
import { makeState } from "../_shared/ebay/state.ts";

const FN = "ebay-oauth-start";
const TTL_MIN = 20;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const caller = await requireCaller(req, { fn: FN, allowUsers: true, trustGatewayServiceJwt: true, headers: cors });
  if (caller instanceof Response) return caller;

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (caller.kind === "user") {
    const { data: isSuper } = await supa.rpc("has_role", { _user_id: caller.userId, _role: "super_user" });
    if (isSuper !== true) return json({ error: "Only a Hub super user can connect eBay accounts." }, 403);
  }
  if (!SCOPES_SIGNED_OFF) return json({ error: "The eBay scope list is awaiting Robert's sign-off; no consent links yet." }, 409);

  let account = "";
  try { account = String((await req.json())?.account ?? "").toUpperCase(); } catch { /* no body */ }
  if (!account) return json({ error: "Body must be { account }" }, 400);

  const { state, nonceSha256, expiresAt } = await makeState(account, TTL_MIN);
  const { error } = await supa.rpc("ebay_create_oauth_state", {
    p_account: account, p_nonce_sha256: nonceSha256,
    p_created_by: caller.kind === "user" ? `user:${caller.userId}` : caller.kind, p_ttl_minutes: TTL_MIN,
  });
  if (error) return json({ error: error.message }, 400);

  const u = new URL(EBAY_AUTHORIZE_URL);
  u.searchParams.set("client_id", secret(SECRET.appId));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", secret(SECRET.ruName));
  u.searchParams.set("scope", USER_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("prompt", "login");
  return json({ account, consentUrl: u.toString(), expiresAt: new Date(expiresAt * 1000).toISOString() });
});
