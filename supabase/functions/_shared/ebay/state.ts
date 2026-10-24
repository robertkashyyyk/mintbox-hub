// ============================================================================
// _shared/ebay/state.ts — signed, single-use, short-expiry OAuth `state`.
//
//   state = base64url(JSON {a: account, n: nonce, e: expiresAtUnix}) "." base64url(HMAC-SHA256)
// The HMAC key is EBAY_OAUTH_STATE_SECRET. The DB (ebay.oauth_state) stores only
// SHA-256(nonce) and marks it used on first callback, so a state works once, for one
// account, until it expires, and a database read alone can't mint a valid one.
// ============================================================================
import { SECRET, secret } from "./config.ts";

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function hmacKey(keyMaterial: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(keyMaterial), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("");
}

export class BadStateError extends Error {}

export interface StatePayload { account: string; nonce: string; expiresAt: number }

export async function makeState(account: string, ttlMinutes: number, keyMaterial = secret(SECRET.stateSecret)) {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = Math.floor(Date.now() / 1000) + ttlMinutes * 60;
  const payload = b64url(enc.encode(JSON.stringify({ a: account, n: nonce, e: expiresAt })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(keyMaterial, "sign"), enc.encode(payload)));
  return { state: `${payload}.${b64url(sig)}`, nonceSha256: await sha256Hex(nonce), expiresAt };
}

/** Verifies the HMAC (constant-time, via WebCrypto) and expiry. Throws BadStateError. */
export async function readState(state: string, keyMaterial = secret(SECRET.stateSecret)): Promise<StatePayload> {
  const [payload, sig, extra] = (state ?? "").split(".");
  if (!payload || !sig || extra !== undefined || state.length > 600) throw new BadStateError("malformed state");
  let ok = false;
  try {
    ok = await crypto.subtle.verify("HMAC", await hmacKey(keyMaterial, "verify"), unb64url(sig), enc.encode(payload));
  } catch { ok = false; }
  if (!ok) throw new BadStateError("state signature invalid");
  let p: { a?: unknown; n?: unknown; e?: unknown };
  try { p = JSON.parse(new TextDecoder().decode(unb64url(payload))); } catch { throw new BadStateError("state unreadable"); }
  if (typeof p.a !== "string" || typeof p.n !== "string" || typeof p.e !== "number") throw new BadStateError("state incomplete");
  if (p.e < Math.floor(Date.now() / 1000)) throw new BadStateError("state expired");
  return { account: p.a, nonce: p.n, expiresAt: p.e };
}
