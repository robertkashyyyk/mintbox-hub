// ============================================================================
// esagu-margin-guard — STANDING job (margin recovery / "un-cage the max").
// Each run: recompute the actionable set from the mirror via esagu_margin_targets()
// (FBM, OPTIMIZATION, PINNED at a maxPrice that sits >3% below external market —
// i.e. a legacy cap holding us below competitors) and RAISE each item's maxPrice
// one bounded step (+20% of current price, capped just under market) so eSagu can
// optimise the live price upward toward the real market instead of stalling at a
// stale ceiling. Buy-box safety is intrinsic: eSagu only lifts the live price while
// it can still hold the box, so a raised ceiling never forfeits the box by itself.
//
// DIRECTION SAFETY: this job ONLY raises. If the live maxPrice already meets or
// exceeds the target (e.g. a prior run did it, or the mirror was stale), it skips —
// it will never lower a max. Idempotent + gentle (batched), so it converges over
// days rather than jumping the whole catalogue at once.
//
// Body: { live?: boolean (default false = dry-run), max?: number (default 75) }
// The cron passes { live: true }. Manual invoke defaults to dry-run for safety.
// Auth: service-role JWT. eSagu: Bearer ESAGU_KEY. Prices in pennies.
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
const CALLER_FN = "esagu-margin-guard";
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
  if (!token) return json({ ok: false, error: "ESAGU_KEY not set." }, 500);
  const eauth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let live = false, max = 75;
  try { const b = await req.json().catch(() => ({})); live = b.live === true; if (b.max) max = Math.min(200, Math.max(1, Number(b.max))); } catch { /* defaults */ }

  const { data: targets, error } = await supabase.rpc("esagu_margin_targets");
  if (error) return json({ ok: false, stage: "targets", error: error.message }, 200);
  const list = (targets ?? []).slice(0, max);

  const results: any[] = [];
  let changed = 0;
  for (const t of list) {
    const id = Number(t.item_id);
    const newMax = Math.round(Number(t.new_max) * 100);
    if (!id || !(newMax > 0)) { results.push({ id, skipped: "bad target" }); continue; }

    const gres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { headers: eauth });
    if (!gres.ok) { results.push({ id, ok: false, stage: "get", status: gres.status }); continue; }
    const strategy = await gres.json();
    const ps = strategy.priceSettings ?? {};
    const liveMax = Number(ps.maxPrice);

    // DIRECTION GUARD: only ever raise. If the live cap already meets/exceeds the
    // target (prior run, or mirror was stale), do nothing — never lower a max.
    if (liveMax >= newMax) { results.push({ id, noop: "live max already >= target", liveMax, target: newMax }); continue; }
    // Sanity: target must sit above the item's own floor.
    if (newMax < Number(ps.minPrice ?? 0)) { results.push({ id, skipped: "target<minPrice", target: newMax, min: ps.minPrice }); continue; }

    // Raising max can't violate fixed<=max, so leave fixedPrice untouched.
    const modified = { ...strategy, priceSettings: { ...ps, maxPrice: newMax } };

    if (!live) { results.push({ id, dryRun: true, from: liveMax, to: newMax, ext_market: t.ext_market }); continue; }

    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: eauth, body: JSON.stringify(modified) });
    const ok = pres.ok;
    if (ok) changed++;
    results.push({ id, ok, status: pres.status, from: liveMax, to: newMax, ext_market: t.ext_market });
    await new Promise((r) => setTimeout(r, 150));
  }

  if (live) await supabase.rpc("amazon_esagu_margin_log", { p_changed: changed, p_detail: { results } });
  return json({ ok: true, live, candidates: list.length, changed, results });
});
