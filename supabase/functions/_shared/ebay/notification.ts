// ============================================================================
// _shared/ebay/notification.ts — verify eBay push notifications (account deletion).
// Mirrors eBay/event-notification-nodejs-sdk (validator.js):
//   X-EBAY-SIGNATURE = base64(JSON {alg, kid, signature, digest})
//   public key       = GET /commerce/notification/v1/public_key/{kid} (app token), cached ~1 h
//   verified message = JSON.stringify(JSON.parse(body)); ECDSA, SHA-1 in the SDK
//                      (we honour the header's digest and accept either SHA-1 or SHA-256)
// ============================================================================
import { createVerify } from "node:crypto";
import { EBAY_API } from "./config.ts";
import { CallLog, ebayFetch } from "./client.ts";
import { getAppToken } from "./tokens.ts";
import { sha256Hex } from "./state.ts";

/** Endpoint challenge: hex(SHA-256(challengeCode + verificationToken + endpoint)), in that order. */
export function challengeResponse(code: string, token: string, endpoint: string): Promise<string> {
  return sha256Hex(code + token + endpoint);
}

const keyCache = new Map<string, { pem: string; until: number }>();

/** eBay returns "-----BEGIN PUBLIC KEY-----MFkw...-----END PUBLIC KEY-----" on one line. */
export function toPem(key: string): string {
  const body = key.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)?.join("\n") ?? body}\n-----END PUBLIC KEY-----\n`;
}

async function publicKey(kid: string, log: CallLog): Promise<string> {
  const hit = keyCache.get(kid);
  if (hit && hit.until > Date.now()) return hit.pem;
  const res = await ebayFetch<{ key?: string }>({
    url: `${EBAY_API}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
    token: await getAppToken(), log, maxAttempts: 3,
  });
  if (res.status !== 200 || !res.json?.key) throw new Error(`public key ${kid}: HTTP ${res.status}`);
  const pem = toPem(res.json.key);
  keyCache.set(kid, { pem, until: Date.now() + 60 * 60 * 1000 });
  return pem;
}

export interface SignatureHeader { alg?: string; kid?: string; signature?: string; digest?: string }

export function parseSignatureHeader(h: string): SignatureHeader {
  return JSON.parse(atob(h.trim()));
}

/** True/false = verified/failed against eBay's key; throws if it can't be checked at all. */
export function verifyWithPem(message: string, sig: SignatureHeader, pem: string): boolean {
  const declared = (sig.digest ?? "").toUpperCase().replace("-", "");
  const order = declared === "SHA256" ? ["sha256", "sha1"] : ["sha1", "sha256"];
  return order.some((alg) => {
    try {
      const v = createVerify(alg);
      v.update(message);
      return v.verify(pem, sig.signature ?? "", "base64");
    } catch { return false; }
  });
}

export async function verifyNotification(rawBody: string, header: string | null, log: CallLog): Promise<boolean> {
  if (!header) return false;
  const sig = parseSignatureHeader(header);
  if (!sig.kid || !sig.signature) return false;
  const message = JSON.stringify(JSON.parse(rawBody));
  return verifyWithPem(message, sig, await publicKey(sig.kid, log));
}
