// ============================================================================
// _shared/ebay/tokens.ts — OAuth tokens.
//   exchangeCode()        authorization code → user access + refresh token (callback only)
//   getUserAccessToken()  Vault refresh token → 2 h user access token (cached per isolate)
//   getAppToken()         client-credentials application token (Key Management,
//                         Notification public keys; Browse later). Helper only.
// Tokens are never logged or returned to callers outside the edge runtime.
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { APP_SCOPES, EBAY_TOKEN_URL, SECRET, secret } from "./config.ts";

export class EbayTokenError extends Error {
  constructor(message: string, public status?: number, public ebayError?: string) {
    super(message);
    this.name = "EbayTokenError";
  }
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

function basicAuth(): string {
  return "Basic " + btoa(`${secret(SECRET.appId)}:${secret(SECRET.certId)}`);
}

async function tokenCall(form: Record<string, string>, fetchImpl: typeof fetch = fetch): Promise<TokenResponse> {
  const res = await fetchImpl(EBAY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: basicAuth() },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!res.ok || typeof j.access_token !== "string") {
    const code = typeof j.error === "string" ? j.error : `http_${res.status}`;
    const desc = typeof j.error_description === "string" ? `: ${j.error_description}` : "";
    throw new EbayTokenError(`eBay token call failed (${code}${desc})`, res.status, code);
  }
  return j as unknown as TokenResponse;
}

export function exchangeCode(code: string, fetchImpl?: typeof fetch): Promise<TokenResponse> {
  return tokenCall({ grant_type: "authorization_code", code, redirect_uri: secret(SECRET.ruName) }, fetchImpl);
}

const userTokenCache = new Map<string, { token: string; until: number }>();

/** A user access token for the account, refreshing from the Vault-held refresh token. */
export async function getUserAccessToken(supa: SupabaseClient, account: string): Promise<string> {
  const hit = userTokenCache.get(account);
  if (hit && hit.until > Date.now()) return hit.token;
  const { data, error } = await supa.rpc("ebay_get_refresh_token", { p_account: account });
  if (error) throw new EbayTokenError(`refresh token lookup failed: ${error.message}`);
  const row = (data ?? [])[0] as { refresh_token?: string; scopes?: string[] } | undefined;
  if (!row?.refresh_token) throw new EbayTokenError(`account ${account} is not connected`);
  const t = await tokenCall({
    grant_type: "refresh_token", refresh_token: row.refresh_token, scope: (row.scopes ?? []).join(" "),
  });
  userTokenCache.set(account, { token: t.access_token, until: Date.now() + (t.expires_in - 300) * 1000 });
  return t.access_token;
}

let appToken: { token: string; until: number } | null = null;

/** Client-credentials application token (scope: public api_scope by default). */
export async function getAppToken(scopes: readonly string[] = APP_SCOPES): Promise<string> {
  const key = scopes.join(" ");
  if (appToken && appToken.until > Date.now() && key === APP_SCOPES.join(" ")) return appToken.token;
  const t = await tokenCall({ grant_type: "client_credentials", scope: key });
  if (key === APP_SCOPES.join(" ")) appToken = { token: t.access_token, until: Date.now() + (t.expires_in - 300) * 1000 };
  return t.access_token;
}
