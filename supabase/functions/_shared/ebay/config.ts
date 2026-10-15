// ============================================================================
// _shared/ebay/config.ts — eBay Sell API constants, scopes and secret names.
// Read-only against eBay: see allowlist.ts. Prompt 2 of docs/ebay-api-plan.md.
// ============================================================================

export const EBAY_API = "https://api.ebay.com";
export const EBAY_APIZ = "https://apiz.ebay.com";
export const EBAY_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
export const EBAY_AUTHORIZE_URL = "https://auth.ebay.com/oauth2/authorize";
export const DEFAULT_MARKETPLACE = "EBAY_GB";

const S = "https://api.ebay.com/oauth/api_scope";

/**
 * User-consent scopes. Changing this list later forces all five accounts to re-consent,
 * so the consent URL is refused until Robert has signed the list off (SCOPES_SIGNED_OFF).
 */
export const USER_SCOPES: readonly string[] = [
  S,                                   // public data; Trading GetSellerList fallback (Prompt 4)
  `${S}/sell.finances`,                // Finances (no read-only variant exists)
  `${S}/sell.fulfillment.readonly`,    // getOrders: line item → SKU / item ID
  `${S}/sell.analytics.readonly`,      // traffic report, seller standards, customer service metrics
  `${S}/sell.marketing`,               // ad report tasks need the full scope; writes blocked in allowlist.ts
  `${S}/sell.account.readonly`,        // account / programme reads
  `${S}/sell.inventory`,               // Feed LMS_ACTIVE_INVENTORY_REPORT (listing → SKU); writes blocked
  `${S}/commerce.identity.readonly`,   // getUser: proves which eBay account consented
];

/** Flip to true only after Robert signs off USER_SCOPES (2026-10-15 gate). */
export const SCOPES_SIGNED_OFF = false;

/** Application (client-credentials) scope: Key Management, Notification public keys, Browse later. */
export const APP_SCOPES: readonly string[] = [S];

/** Edge-function secret names. Values never appear in code, logs or responses. */
export const SECRET = {
  appId: "EBAY_APP_ID",                         // App ID (Client ID)
  devId: "EBAY_DEV_ID",                         // Dev ID (kept for Trading API; REST OAuth doesn't use it)
  certId: "EBAY_CERT_ID",                       // Cert ID (Client Secret)
  ruName: "EBAY_RUNAME",                        // RuName (eBay Redirect URL name, not a URL)
  deletionToken: "EBAY_DELETION_VERIFICATION_TOKEN",
  stateSecret: "EBAY_OAUTH_STATE_SECRET",
} as const;

export class EbayConfigError extends Error {}

export function secret(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new EbayConfigError(`${name} is not set`);
  return v;
}

export function hasSecret(name: string): boolean {
  return !!Deno.env.get(name);
}

export const FUNCTIONS_BASE =
  `${(Deno.env.get("SUPABASE_URL") ?? "https://vcfbegjpkvxkqpptyxni.supabase.co").replace(/\/$/, "")}/functions/v1`;
export const ACCOUNT_DELETION_ENDPOINT = `${FUNCTIONS_BASE}/ebay-account-deletion`;
export const OAUTH_ACCEPT_URL = `${FUNCTIONS_BASE}/ebay-oauth-callback`;
export const OAUTH_DECLINE_URL = `${FUNCTIONS_BASE}/ebay-oauth-callback/declined`;
