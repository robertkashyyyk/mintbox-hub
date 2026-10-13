// ============================================================================
// esagu-probe — Phase 1 read-only discovery for Amazon repricing via eSagu.
// Confirms the token works, eSagu is reachable from edge, gauges catalog
// coverage (how many repricing items eSagu holds for us), and returns the raw
// item shape so we can design the SKU↔itemId mirror. Writes NOTHING.
//
// eSagu REST API: base https://api.esagu.de/amzn/repricing/v1
//   GET /item  — list repricing items (max 100/page; paginate by-id-greater-than)
//   Auth: Authorization: Bearer <ESAGU_JWT>.  Rate limit ~120/hr.
//
// Body: { limit?: number (<=100, default 100), byIdGreaterThan?: number }
// Auth: service-role JWT (ops) or a valid authenticated user (gateway verify_jwt).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";

// ---- Caller auth (security/prompt0-fixes, 2026-10-13) -----------------------
// The gateway's verify_jwt accepts ANY project JWT, including the public anon key,
// and this function can move live Amazon prices or spend eSagu quota. Require the
// service key (constant-time compare), a service_role JWT, or a signed-in Hub user
// (re-checked via auth.getUser). Anything else gets 401 and a row in
// public.edge_auth_rejections. The presented token is never logged.
const CALLER_FN = "esagu-probe";
function ctEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
function serviceKeys(): string[] {
  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""];
  try {
    const s = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const v of Object.values(s ?? {})) if (typeof v === "string") keys.push(v);
  } catch { /* not JSON — ignore */ }
  return keys.filter(Boolean);
}
function bearerRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role ?? null;
  } catch { return null; }
}
async function rejectUnlessInternal(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  let role: string | null = null;
  if (bearer) {
    if (serviceKeys().some((k) => ctEqual(bearer, k))) return null;
    role = bearerRole(bearer); // signature already verified by the gateway (verify_jwt)
    if (role === "service_role") return null;
    if (role === "authenticated") {
      const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
      });
      const { data } = await uc.auth.getUser();
      if (data?.user?.id) return null;
    }
  }
  const reason = !bearer ? "no bearer" : role ? `role ${role}` : "unrecognised token";
  console.warn(`[auth] ${CALLER_FN} rejected: ${reason}`);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    await admin.from("edge_auth_rejections").insert({
      function_name: CALLER_FN, reason, jwt_role: role, method: req.method,
      ip: req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip"),
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    });
  } catch { /* logging must never stop the 401 */ }
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401, headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const denied = await rejectUnlessInternal(req);
  if (denied) return denied;

  const jwt = Deno.env.get("ESAGU_JWT");
  const key = Deno.env.get("ESAGU_KEY");
  if (!jwt && !key) return json({ ok: false, error: "Neither ESAGU_JWT nor ESAGU_KEY is set in the vault." }, 500);

  let limit = 100, byIdGreaterThan: number | undefined;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.limit) limit = Math.min(100, Math.max(1, Number(body.limit)));
    if (body.byIdGreaterThan != null) byIdGreaterThan = Number(body.byIdGreaterThan);
  } catch { /* defaults */ }

  const url = new URL(`${ESAGU_BASE}/item`);
  url.searchParams.set("limit", String(limit));
  if (byIdGreaterThan != null) url.searchParams.set("by-id-greater-than", String(byIdGreaterThan));

  // Structure metadata for each secret (no values exposed) so we can see which
  // one is actually a JWT (eyJ…eyJ…sig = exactly 2 dots).
  const shape = (name: string, v?: string) =>
    v ? { name, len: v.length, dots: (v.match(/\./g) || []).length, prefix: v.slice(0, 3), looksLikeJwt: v.startsWith("eyJ") && (v.match(/\./g) || []).length === 2 }
      : { name, present: false };
  const secretShapes = [shape("ESAGU_JWT", jwt), shape("ESAGU_KEY", key)];

  // Try BOTH secrets as the bearer; report each outcome; return first success.
  const attempts: Array<{ label: string; token: string }> = [];
  if (jwt) attempts.push({ label: "ESAGU_JWT", token: jwt });
  if (key && key !== jwt) attempts.push({ label: "ESAGU_KEY", token: key });

  const results: any[] = [];
  for (const attempt of attempts) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${attempt.token}`, Accept: "application/json" } });
    } catch (e) {
      results.push({ usedSecret: attempt.label, stage: "fetch", error: String(e) });
      continue;
    }
    const rate = { limit: res.headers.get("X-RateLimit-Limit"), remaining: res.headers.get("X-RateLimit-Remaining") };
    const text = await res.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 400) }; }

    if (res.ok) {
      const items: any[] = Array.isArray(payload) ? payload : (payload?.items ?? payload?.content ?? []);
      const first = items[0] ?? null;
      return json({
        ok: true, usedSecret: attempt.label, status: res.status, rate, secretShapes,
        pageSize: limit, itemsOnPage: items.length, moreLikely: items.length >= limit,
        fieldShape: first ? Object.keys(first) : [], sample: items.slice(0, 2),
        note: "read-only probe; nothing written.",
      });
    }
    results.push({ usedSecret: attempt.label, status: res.status, rate, message: payload?.message ?? payload });
  }

  return json({ ok: false, stage: "esagu", secretShapes, attempts: results,
    hint: "Neither secret authenticated. Check secretShapes: the valid eSagu bearer is a JWT (looksLikeJwt:true). If neither looks like a JWT, the ESAGU_JWT secret value is wrong/placeholder." }, 200);
});
