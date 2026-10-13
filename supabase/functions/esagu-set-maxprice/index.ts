// ============================================================================
// esagu-set-maxprice — thin WRITE executor for Hub-driven eSagu repricing.
// Given explicit {itemId, maxPrice(£)} instructions, GET the item's current
// strategy, change ONLY priceSettings.maxPrice (preserving min/fixed/mode and
// all template refs), and PUT it back. The Hub computes WHICH items + WHAT
// price; this just executes, auditably.
//
// SAFETY: dry-run by default (live:false) → returns the current strategy + the
// planned change, writes NOTHING. live:true actually PUTs.
//
// Body: { items: [{ itemId: number, maxPrice: number (£) }], live?: boolean }
// Auth: service-role JWT (gateway verify_jwt).
// eSagu auth: Bearer ESAGU_KEY (the JWT). Prices in pennies.
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
const CALLER_FN = "esagu-set-maxprice";
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

  const token = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!token) return json({ ok: false, error: "ESAGU_KEY not set in vault." }, 500);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  let items: Array<{ itemId: number; maxPrice: number }> = [];
  let live = false;
  try {
    const body = await req.json();
    items = Array.isArray(body.items) ? body.items : [];
    live = body.live === true;
  } catch { return json({ ok: false, error: "Body must be { items:[{itemId,maxPrice}], live? }" }, 400); }
  if (items.length === 0) return json({ ok: false, error: "No items supplied." }, 400);
  if (items.length > 200) return json({ ok: false, error: "Refusing >200 items in one call (safety)." }, 400);

  const results: any[] = [];
  for (const it of items) {
    const id = Number(it.itemId);
    const newMaxPennies = Math.round(Number(it.maxPrice) * 100);
    if (!id || !(newMaxPennies > 0)) { results.push({ itemId: it.itemId, ok: false, error: "bad itemId/maxPrice" }); continue; }

    // 1. GET current strategy
    const gres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { headers: auth });
    const gtext = await gres.text();
    if (!gres.ok) { results.push({ itemId: id, ok: false, stage: "get", status: gres.status, body: gtext.slice(0, 300) }); continue; }
    let strategy: any;
    try { strategy = JSON.parse(gtext); } catch { results.push({ itemId: id, ok: false, stage: "get-parse", body: gtext.slice(0, 200) }); continue; }

    const ps = strategy.priceSettings ?? {};
    const before = { minPrice: ps.minPrice, maxPrice: ps.maxPrice, fixedPrice: ps.fixedPrice, mode: ps.mode };
    // Keep fixedPrice ≤ maxPrice so eSagu can't reject on a fixed>max invariant
    // (fixedPrice is ignored in OPTIMIZATION mode anyway).
    const newFixed = Number(ps.fixedPrice) > newMaxPennies ? newMaxPennies : ps.fixedPrice;
    const modified = { ...strategy, priceSettings: { ...ps, maxPrice: newMaxPennies, fixedPrice: newFixed } };

    if (!live) {
      results.push({ itemId: id, ok: true, dryRun: true, before, plannedMaxPrice: newMaxPennies,
        fixedAdjustedTo: newFixed !== ps.fixedPrice ? newFixed : undefined,
        note: `would set maxPrice ${before.maxPrice} → ${newMaxPennies} (${(newMaxPennies/100).toFixed(2)} GBP)` });
      continue;
    }
    if (newMaxPennies < Number(ps.minPrice ?? 0)) {
      results.push({ itemId: id, ok: false, skipped: "target below item's own minPrice — refusing", before, plannedMaxPrice: newMaxPennies });
      continue;
    }

    // 2. PUT modified strategy
    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: auth, body: JSON.stringify(modified) });
    const ptext = await pres.text();
    results.push({ itemId: id, ok: pres.ok, live: true, status: pres.status, before, newMaxPrice: newMaxPennies,
      response: ptext.slice(0, 300) });
    await new Promise((r) => setTimeout(r, 150));
  }

  return json({ ok: true, live, count: items.length,
    succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});
