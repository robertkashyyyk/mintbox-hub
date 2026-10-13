// ============================================================================
// _shared/internal_auth.ts — one caller check for internal edge functions.
//
// PLAN STAGE (2026-10-13): not imported by any deployed function yet. See
// docs/security-internal-auth-plan.md. The eBay functions (Prompt 2) import it
// from the start; the ~25 existing public workers move onto it in batches.
//
// Why a shared check: Supabase's gateway (verify_jwt) only verifies the legacy
// anon / service_role JWTs. It rejects the new sb_secret / sb_publishable keys,
// so any function called with an sb_secret key must run with verify_jwt = false
// and authenticate the caller itself. Decoding a JWT's role without verifying it
// is forgeable, so this helper NEVER trusts an unverified role claim.
//
// Accepted callers (first match wins):
//   1. secret key   — `apikey` or `Authorization: Bearer` equal (constant-time) to
//                     one of the project's secret keys (SUPABASE_SECRET_KEYS values,
//                     SUPABASE_SERVICE_ROLE_KEY). Function-to-function calls.
//   2. internal     — `x-hub-internal` header equal (constant-time) to the Vault-held
//                     secret `hub_internal_secret` (read once per isolate through the
//                     service-role RPC public.hub_internal_secret()). pg_cron callers
//                     send it straight from vault.decrypted_secrets.
//   3. user         — a Supabase Auth user JWT, verified server-side (auth.getUser),
//                     only when opts.allowUsers is true.
//   4. service JWT  — legacy service_role JWT, ONLY when opts.trustGatewayServiceJwt
//                     is true AND the function is deployed with verify_jwt = true
//                     (so the gateway has already checked the signature). For the
//                     transition period while crons are re-pointed.
// Anything else → 401, logged to public.edge_auth_rejections (token never stored).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type Caller =
  | { kind: "secret_key" }
  | { kind: "internal" }
  | { kind: "user"; userId: string }
  | { kind: "service_jwt" };

export interface CallerOptions {
  /** Function slug, for the rejection log. */
  fn: string;
  /** Allow signed-in Hub users (verified with auth.getUser). Default false. */
  allowUsers?: boolean;
  /** Accept a legacy service_role JWT on trust of the gateway. Only valid with verify_jwt = true. */
  trustGatewayServiceJwt?: boolean;
  /** Extra response headers (e.g. CORS) for the 401. */
  headers?: Record<string, string>;
}

const enc = new TextEncoder();

/** Constant-time string compare (length-independent loop). */
export function ctEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

function projectSecretKeys(): string[] {
  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""];
  try {
    const s = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const v of Object.values(s ?? {})) if (typeof v === "string") keys.push(v);
  } catch { /* not JSON — ignore */ }
  return keys.filter(Boolean);
}

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

let internalSecret: Promise<string | null> | null = null;
/** The Vault-held cron secret, fetched once per isolate (a failed fetch is retried next call). */
function hubInternalSecret(): Promise<string | null> {
  if (!internalSecret) {
    const p: Promise<string | null> = (async () => {
      try {
        const { data, error } = await adminClient().rpc("hub_internal_secret");
        return error || typeof data !== "string" || data.length < 32 ? null : data;
      } catch { return null; }
    })();
    internalSecret = p;
    p.then((v) => { if (v === null && internalSecret === p) internalSecret = null; });
  }
  return internalSecret;
}

/** Role claim of a JWT, WITHOUT verification. Only meaningful behind verify_jwt = true. */
function unverifiedRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role ?? null;
  } catch { return null; }
}

async function logRejection(req: Request, fn: string, reason: string, role: string | null) {
  console.warn(`[auth] ${fn} rejected: ${reason}`);
  try {
    await adminClient().from("edge_auth_rejections").insert({
      function_name: fn, reason, jwt_role: role, method: req.method,
      ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip"),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    });
  } catch { /* logging must never stop the 401 */ }
}

/**
 * Returns the verified caller, or a 401 Response to return as-is.
 *   const caller = await requireCaller(req, { fn: "my-fn", allowUsers: true, headers: cors });
 *   if (caller instanceof Response) return caller;
 */
export async function requireCaller(req: Request, opts: CallerOptions): Promise<Caller | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();

  // 1. Project secret key (sb_secret / service key) in apikey or bearer.
  const keys = projectSecretKeys();
  for (const presented of [apikey, bearer]) {
    if (presented && keys.some((k) => ctEqual(presented, k))) return { kind: "secret_key" };
  }

  // 2. Vault-held internal secret header (pg_cron).
  const internal = (req.headers.get("x-hub-internal") ?? "").trim();
  if (internal) {
    const expected = await hubInternalSecret();
    if (expected && ctEqual(internal, expected)) return { kind: "internal" };
  }

  const role = bearer ? unverifiedRole(bearer) : null;

  // 3. Signed-in user, verified by Supabase Auth (works with verify_jwt on or off).
  if (opts.allowUsers && bearer && role === "authenticated") {
    const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false },
    });
    const { data } = await uc.auth.getUser(bearer);
    if (data?.user?.id) return { kind: "user", userId: data.user.id };
  }

  // 4. Legacy service_role JWT — gateway-verified only (transition).
  if (opts.trustGatewayServiceJwt && role === "service_role") return { kind: "service_jwt" };

  const reason = !bearer && !apikey && !internal ? "no credentials"
    : internal ? "bad internal secret"
    : role ? `role ${role}` : "unrecognised token";
  await logRejection(req, opts.fn, reason, role);
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { ...(opts.headers ?? {}), "Content-Type": "application/json" },
  });
}
