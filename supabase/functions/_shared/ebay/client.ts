// ============================================================================
// _shared/ebay/client.ts — the one way edge functions talk to eBay's REST APIs.
//   * read-only allowlist checked BEFORE anything is sent (allowlist.ts)
//   * Bearer token, X-EBAY-C-MARKETPLACE-ID (defaults to EBAY_GB; eBay's default is US)
//   * HTTP message signature when `sign` is set (required on Finances)
//   * 429 / 5xx retry with backoff (Retry-After honoured) under a deadline
//   * every call, retry and refusal recorded in ebay.api_call_log via CallLog
// ============================================================================
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertAllowed, EbayWriteBlockedError } from "./allowlist.ts";
import { DEFAULT_MARKETPLACE } from "./config.ts";
import { signedHeaders, type SigningKey } from "./signing.ts";

export interface CallRow {
  at: string; fn: string; account_code?: string; method: string; host: string; path: string;
  status?: number; ms?: number; attempt: number; signed: boolean; blocked: boolean; error?: string;
}

/** Collects call rows; flush() writes them in one RPC. Never throws. */
export class CallLog {
  rows: CallRow[] = [];
  constructor(private supa: SupabaseClient | null, public fn: string) {}
  push(r: Omit<CallRow, "at" | "fn">) { this.rows.push({ at: new Date().toISOString(), fn: this.fn, ...r }); }
  async flush() {
    if (!this.supa || this.rows.length === 0) return;
    const rows = this.rows.splice(0);
    try { await this.supa.rpc("ebay_log_api_calls", { p_rows: rows }); } catch { /* logging must not break a run */ }
  }
}

export class EbayApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
    this.name = "EbayApiError";
  }
}

export interface EbayRequest {
  method?: "GET" | "POST";
  url: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  token: string;
  account?: string;
  marketplace?: string;
  signingKey?: SigningKey;          // set → request is signed (Finances)
  log: CallLog;
  deadlineMs?: number;              // absolute epoch ms; default now + 60 s
  maxAttempts?: number;
  extraHeaders?: Record<string, string>;
  fetchImpl?: typeof fetch;         // tests
}

export interface EbayResponse<T = unknown> { status: number; json: T | null; text: string; headers: Headers }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ebayFetch<T = unknown>(r: EbayRequest): Promise<EbayResponse<T>> {
  const method = r.method ?? "GET";
  const u = new URL(r.url);
  for (const [k, v] of Object.entries(r.query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
  const url = u.toString();
  const bodyText = r.body === undefined ? undefined : JSON.stringify(r.body);

  try {
    assertAllowed(method, url, r.body);
  } catch (e) {
    r.log.push({ account_code: r.account, method, host: u.host, path: u.pathname, attempt: 0, signed: false, blocked: true,
                 error: (e as Error).message });
    throw e;
  }

  const doFetch = r.fetchImpl ?? fetch;
  const deadline = r.deadlineMs ?? Date.now() + 60_000;
  const maxAttempts = r.maxAttempts ?? 5;
  for (let attempt = 1; ; attempt++) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${r.token}`,
      Accept: "application/json",
      "X-EBAY-C-MARKETPLACE-ID": r.marketplace ?? DEFAULT_MARKETPLACE,
      ...(bodyText !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(r.signingKey ? await signedHeaders(r.signingKey, method, url, bodyText) : {}),
      ...(r.extraHeaders ?? {}),
    };
    const t0 = Date.now();
    let res: Response;
    try {
      res = await doFetch(url, { method, headers, body: bodyText });
    } catch (e) {
      r.log.push({ account_code: r.account, method, host: u.host, path: u.pathname, ms: Date.now() - t0, attempt,
                   signed: !!r.signingKey, blocked: false, error: `network: ${(e as Error).message}` });
      if (attempt >= maxAttempts || Date.now() + 1000 > deadline) throw e;
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 15_000));
      continue;
    }
    const text = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    r.log.push({ account_code: r.account, method, host: u.host, path: u.pathname, status: res.status, ms: Date.now() - t0,
                 attempt, signed: !!r.signingKey, blocked: false,
                 error: res.ok ? undefined : text.slice(0, 300) });
    if (retryable && attempt < maxAttempts) {
      const ra = Number(res.headers.get("Retry-After"));
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(1000 * 2 ** (attempt - 1), 15_000) + Math.random() * 250;
      if (Date.now() + wait < deadline) { await sleep(wait); continue; }
    }
    let json: T | null = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  }
}

export { EbayWriteBlockedError };
