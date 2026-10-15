// ============================================================================
// _shared/ebay/signing.ts — eBay HTTP message signatures (RFC 9421, Ed25519).
//
// Required on every Finances call for UK/EU sellers. Matches eBay's own SDK
// (eBay/digital-signature-nodejs-sdk, signature-base-helper):
//   "x-ebay-signature-key": <JWE>\n
//   "@method": GET\n
//   "@path": /sell/finances/v1/transaction\n          (path only, no query)
//   "@authority": apiz.ebay.com\n
//   "@signature-params": ("x-ebay-signature-key" "@method" "@path" "@authority");created=<unix>
// With a body, "content-digest" (sha-256=:<b64>:) is covered first.
// Signature header: sig1=:<base64 Ed25519 signature>:
// The keypair comes from the Key Management API (createSigningKey) and is held in Vault.
// ============================================================================

const enc = new TextEncoder();

function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}

/** PKCS#8 DER bytes from a PEM block or bare base64 (eBay's createSigningKey output). */
export function pkcs8Der(privateKey: string): Uint8Array<ArrayBuffer> {
  const body = privateKey.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();
function importEd25519(privateKey: string): Promise<CryptoKey> {
  let k = keyCache.get(privateKey);
  if (!k) {
    k = crypto.subtle.importKey("pkcs8", pkcs8Der(privateKey), { name: "Ed25519" }, false, ["sign"]);
    keyCache.set(privateKey, k);
  }
  return k;
}

export async function contentDigest(body: string): Promise<string> {
  return `sha-256=:${b64(await crypto.subtle.digest("SHA-256", enc.encode(body)))}:`;
}

export interface SignatureParts {
  jwe: string;
  method: string;
  path: string;
  authority: string;
  contentDigest?: string;
}

/** The exact signature base and Signature-Input value for the given parts. */
export function signatureBase(p: SignatureParts, created: number): { base: string; input: string } {
  const covered = [
    ...(p.contentDigest ? [["content-digest", p.contentDigest]] : []),
    ["x-ebay-signature-key", p.jwe],
    ["@method", p.method.toUpperCase()],
    ["@path", p.path],
    ["@authority", p.authority],
  ] as const;
  const params = `(${covered.map(([k]) => `"${k}"`).join(" ")});created=${created}`;
  const base = covered.map(([k, v]) => `"${k}": ${v}`).join("\n") + `\n"@signature-params": ${params}`;
  return { base, input: `sig1=${params}` };
}

export interface SigningKey {
  privateKey: string;
  jwe: string;
}

/** Headers to add to a request so eBay accepts it as signed. */
export async function signedHeaders(
  key: SigningKey, method: string, url: string, body?: string, created = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const u = new URL(url);
  const digest = body !== undefined && body !== "" ? await contentDigest(body) : undefined;
  const { base, input } = signatureBase(
    { jwe: key.jwe, method, path: u.pathname, authority: u.host, contentDigest: digest }, created,
  );
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, await importEd25519(key.privateKey), enc.encode(base));
  return {
    "x-ebay-signature-key": key.jwe,
    "Signature-Input": input,
    "Signature": `sig1=:${b64(sig)}:`,
    ...(digest ? { "Content-Digest": digest } : {}),
  };
}
