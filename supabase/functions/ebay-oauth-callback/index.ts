// ============================================================================
// ebay-oauth-callback — eBay RuName "Auth accepted" / "Auth declined" target.
// PUBLIC (verify_jwt = false): eBay redirects the seller's browser here with no
// Supabase credentials, so the signed `state` is the authentication:
//   1. HMAC-verify the state (account, nonce, expiry)        → else 400, nothing touched
//   2. consume it in ebay.oauth_state (single use)            → replay/expired → 400
//   3. exchange the code via the RuName (EBAY_APP_ID / EBAY_CERT_ID / EBAY_RUNAME)
//   4. Identity getUser: which eBay account actually consented
//      - refuse if ebay_accounts.ebay_username is set and differs (wrong login)
//      - refuse if that eBay user is already linked to another account code
//   5. refresh token → Vault (ebay_store_connection), account marked active
// Accept URL:  …/functions/v1/ebay-oauth-callback
// Decline URL: …/functions/v1/ebay-oauth-callback/declined
// Responses are plain text: Supabase serves function HTML as text/plain anyway.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { EBAY_APIZ, USER_SCOPES } from "../_shared/ebay/config.ts";
import { CallLog, ebayFetch } from "../_shared/ebay/client.ts";
import { BadStateError, readState, sha256Hex } from "../_shared/ebay/state.ts";
import { exchangeCode } from "../_shared/ebay/tokens.ts";

const text = (s: number, msg: string) =>
  new Response(msg + "\n", { status: s, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

Deno.serve(async (req) => {
  if (req.method !== "GET") return text(405, "Method not allowed.");
  const url = new URL(req.url);
  const declined = url.pathname.replace(/\/+$/, "").endsWith("/declined");
  const stateParam = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  const ebayError = url.searchParams.get("error");

  if (!stateParam && declined) return text(200, "eBay consent was declined. Nothing was stored.");

  let st;
  try {
    st = await readState(stateParam);
  } catch (e) {
    console.warn(`[ebay-oauth-callback] rejected state: ${e instanceof BadStateError ? e.message : "error"}`);
    return text(400, "This consent link is invalid or has expired. Nothing was stored. Ask for a fresh link.");
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const close = (id: string, outcome: string) => supa.rpc("ebay_close_oauth_state", { p_state_id: id, p_outcome: outcome });

  const { data: stateId, error: stErr } = await supa.rpc("ebay_consume_oauth_state", {
    p_nonce_sha256: await sha256Hex(st.nonce), p_account: st.account,
  });
  if (stErr || !stateId) {
    return text(400, "This consent link has already been used or has expired. Nothing was stored. Ask for a fresh link.");
  }

  if (declined || ebayError || !code) {
    await close(stateId, declined ? "declined" : `ebay_error:${ebayError ?? "no code"}`);
    return text(200, `eBay consent for ${st.account} was not completed (${declined ? "declined" : ebayError ?? "no code"}). Nothing was stored.`);
  }

  const log = new CallLog(supa, "ebay-oauth-callback");
  try {
    let tok;
    try {
      tok = await exchangeCode(code);
    } catch (e) {
      await close(stateId, `token_exchange_failed: ${(e as Error).message}`);
      return text(502, `eBay didn't accept the authorisation code for ${st.account}. Nothing was stored.`);
    }
    if (!tok.refresh_token) {
      await close(stateId, "no_refresh_token");
      return text(502, `eBay returned no refresh token for ${st.account}. Nothing was stored.`);
    }

    const me = await ebayFetch<{ userId?: string; username?: string }>({
      url: `${EBAY_APIZ}/commerce/identity/v1/user/`, token: tok.access_token, account: st.account, log, maxAttempts: 3,
    });
    const username = me.json?.username, userId = me.json?.userId;
    if (me.status !== 200 || !username || !userId) {
      await close(stateId, `identity_failed: HTTP ${me.status}`);
      return text(502, `Couldn't confirm which eBay account consented (HTTP ${me.status}). Nothing was stored.`);
    }

    const { data: acct } = await supa.from("ebay_accounts").select("code, ebay_username").eq("code", st.account).single();
    if (acct?.ebay_username && acct.ebay_username.toLowerCase() !== username.toLowerCase()) {
      await close(stateId, `wrong_account: consented as ${username}, expected ${acct.ebay_username}`);
      return text(409,
        `You signed in to eBay as "${username}", but this link is for ${st.account} ("${acct.ebay_username}"). ` +
        `Nothing was stored. Sign out of eBay, then use a fresh link and sign in as "${acct.ebay_username}".`);
    }
    const { data: dup } = await supa.from("ebay_accounts").select("code").eq("ebay_user_id", userId).neq("code", st.account);
    if (dup && dup.length) {
      await close(stateId, `user_already_linked:${dup[0].code}`);
      return text(409, `eBay user "${username}" is already connected as ${dup[0].code}. Nothing was stored for ${st.account}.`);
    }

    const expiresAt = new Date(Date.now() + (tok.refresh_token_expires_in ?? 47_304_000) * 1000).toISOString();
    const { error: storeErr } = await supa.rpc("ebay_store_connection", {
      p_account: st.account, p_refresh_token: tok.refresh_token, p_refresh_expires_at: expiresAt,
      p_scopes: USER_SCOPES, p_ebay_user_id: userId, p_ebay_username: username, p_state_id: stateId,
    });
    if (storeErr) {
      await close(stateId, `store_failed: ${storeErr.message}`);
      return text(500, `eBay consent worked but storing the token failed. Nothing usable was saved for ${st.account}.`);
    }
    await close(stateId, "connected");
    return text(200,
      `Connected ${st.account} as eBay user "${username}". The refresh token is valid until ${expiresAt.slice(0, 10)}. ` +
      `You can close this tab.`);
  } finally {
    await log.flush();
  }
});
