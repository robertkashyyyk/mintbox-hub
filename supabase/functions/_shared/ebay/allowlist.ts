// ============================================================================
// _shared/ebay/allowlist.ts — READ-ONLY ENFORCEMENT for the eBay client.
//
// sell.marketing and sell.inventory are write-capable scopes (eBay has no read-only
// variant that runs ad reports or the active-inventory feed), so read-only is enforced
// here: every request the shared client makes is checked against this list BEFORE it is
// sent, and anything not on it throws EbayWriteBlockedError. GETs are allowed per API;
// the only POSTs are report/task creation and the one-off signing-key creation.
// Token exchange (identity/v1/oauth2/token) lives in tokens.ts and never goes through here.
// ============================================================================

export class EbayWriteBlockedError extends Error {
  constructor(public method: string, public url: string) {
    super(`eBay call blocked by read-only allowlist: ${method} ${url}`);
    this.name = "EbayWriteBlockedError";
  }
}

interface Rule {
  method: "GET" | "POST";
  host: string;
  path: RegExp;
  why: string;
  /** Extra check on the JSON body for POSTs. */
  body?: (b: unknown) => boolean;
}

export const ALLOWLIST: readonly Rule[] = [
  { method: "GET", host: "apiz.ebay.com", path: /^\/sell\/finances\/v1\/[a-z_]+(\/[A-Za-z0-9._-]+)?$/, why: "Finances reads (transactions, payouts, billing activity)" },
  { method: "GET", host: "api.ebay.com", path: /^\/sell\/fulfillment\/v1\/order(\/[A-Za-z0-9!._-]+)?$/, why: "Fulfillment getOrders / getOrder" },
  { method: "GET", host: "api.ebay.com", path: /^\/sell\/analytics\/v1\/[a-z_]+(\/[A-Za-z0-9_]+){0,2}$/, why: "Analytics: traffic report, seller standards, customer service metrics" },
  { method: "GET", host: "api.ebay.com", path: /^\/sell\/marketing\/v1\/(ad_campaign|ad_report|ad_report_task|ad_report_metadata)(\/[A-Za-z0-9._-]+)*$/, why: "Marketing reads (campaigns, ad reports)" },
  {
    method: "POST", host: "api.ebay.com", path: /^\/sell\/marketing\/v1\/ad_report_task$/,
    why: "createReportTask: creates a report, changes no campaign",
  },
  { method: "GET", host: "api.ebay.com", path: /^\/sell\/account\/v1\/[a-z_]+(\/[A-Za-z0-9._-]+)?$/, why: "Account reads" },
  { method: "GET", host: "api.ebay.com", path: /^\/sell\/feed\/v1\/(inventory_task|task)(\/[A-Za-z0-9._-]+)*$/, why: "Feed task reads and result-file download" },
  {
    method: "POST", host: "api.ebay.com", path: /^\/sell\/feed\/v1\/inventory_task$/,
    why: "Active inventory report task (listing → SKU), nothing else",
    body: (b) => (b as { feedType?: string })?.feedType === "LMS_ACTIVE_INVENTORY_REPORT",
  },
  { method: "GET", host: "apiz.ebay.com", path: /^\/commerce\/identity\/v1\/user\/?$/, why: "Identity getUser" },
  { method: "GET", host: "api.ebay.com", path: /^\/commerce\/notification\/v1\/public_key\/[A-Za-z0-9-]+$/, why: "Notification public key (deletion-notice signatures)" },
  { method: "GET", host: "apiz.ebay.com", path: /^\/developer\/key_management\/v1\/signing_key(\/[A-Za-z0-9-]+)?$/, why: "Key Management reads" },
  {
    method: "POST", host: "apiz.ebay.com", path: /^\/developer\/key_management\/v1\/signing_key$/,
    why: "createSigningKey (one-off, app token)",
    body: (b) => ["ED25519", "RSA"].includes((b as { signingKeyCipher?: string })?.signingKeyCipher ?? ""),
  },
];

/** Throws EbayWriteBlockedError unless (method, url, body) matches an allowlist rule. */
export function assertAllowed(method: string, url: string, body?: unknown): void {
  let u: URL;
  try { u = new URL(url); } catch { throw new EbayWriteBlockedError(method, url); }
  const m = method.toUpperCase();
  const ok = u.protocol === "https:" && ALLOWLIST.some((r) =>
    r.method === m && r.host === u.host && r.path.test(u.pathname) && (!r.body || r.body(body))
  );
  if (!ok) throw new EbayWriteBlockedError(m, `${u.host}${u.pathname}`);
}
