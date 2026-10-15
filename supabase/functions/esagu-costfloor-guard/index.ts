// esagu-costfloor-guard — STANDING cost-floor job. Reads esagu_costfloor_targets()
// and RAISES minPrice to the break-even floor so eSagu can never sell below cost.
// Where the floor exceeds maxPrice (whole range below cost), lifts max just above
// the floor (eSagu requires min < max) so the item pins ~break-even. RAISE-only on
// min; ring-fenced from clearance in the RPC. Every live push is logged in
// public.esagu_floor_push_log (old/new floor, caller).
// Body: { live?: boolean (default false), max?: number (default 15), worstFirst?: boolean (default true) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---- Caller auth (security/prompt0-fixes, 2026-10-13) -----------------------
// The gateway's verify_jwt accepts ANY project JWT, including the public anon key,
// and this function can move live Amazon prices or spend eSagu quota. Require the
// service key (constant-time compare), a service_role JWT, or a signed-in Hub user
// (re-checked via auth.getUser). Anything else gets 401 and a row in
// public.edge_auth_rejections. The presented token is never logged.
const CALLER_FN = "esagu-costfloor-guard";
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
// Who made the call — recorded against every live push in public.esagu_floor_push_log.
type Caller = { kind: "service_key" | "service_jwt" | "user"; userId: string | null };
async function rejectUnlessInternal(req: Request): Promise<Response | Caller> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  let role: string | null = null;
  if (bearer) {
    if (serviceKeys().some((k) => ctEqual(bearer, k))) return { kind: "service_key", userId: null };
    role = bearerRole(bearer); // signature already verified by the gateway (verify_jwt)
    if (role === "service_role") return { kind: "service_jwt", userId: null };
    if (role === "authenticated") {
      const uc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
      });
      const { data } = await uc.auth.getUser();
      if (data?.user?.id) return { kind: "user", userId: data.user.id };
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
  const caller = await rejectUnlessInternal(req);
  if (caller instanceof Response) return caller;
  const token = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!token) return json({ ok: false, error: "ESAGU_KEY not set." }, 500);
  const eauth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let live = false, max = 15, worstFirst = true;
  try { const b = await req.json().catch(() => ({})); live = b.live === true; if (b.max) max = Math.min(200, Math.max(1, Number(b.max))); if (b.worstFirst === false) worstFirst = false; } catch { /* defaults */ }

  const { data: targets, error } = await supabase.rpc("esagu_costfloor_targets");
  if (error) return json({ ok: false, stage: "targets", error: error.message }, 200);
  let list = (targets ?? []) as any[];
  if (worstFirst) list = list.slice().sort((a, b) => (Number(b.floor_gbp) - Number(b.amazon_price ?? b.floor_gbp)) - (Number(a.floor_gbp) - Number(a.amazon_price ?? a.floor_gbp)));
  list = list.slice(0, max);

  // Every live push is logged write-ahead in public.esagu_floor_push_log (old/new floor,
  // caller) before the PUT, outcome filled in after. No log row, no push — the run stops.
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300);
  const results: any[] = [];
  let changed = 0, aborted = false;
  for (const t of list) {
    const id = Number(t.item_id);
    const newMin = Math.round(Number(t.floor_gbp) * 100);
    if (!id || !(newMin > 0)) { results.push({ id, skipped: "bad target" }); continue; }

    const gres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { headers: eauth });
    if (!gres.ok) { results.push({ id, ok: false, stage: "get", status: gres.status }); continue; }
    const strategy = await gres.json();
    const ps = strategy.priceSettings ?? {};
    const liveMin = Number(ps.minPrice);
    if (liveMin >= newMin) { results.push({ id, noop: "live min already >= floor", liveMin, floor: newMin }); continue; }

    const liveMax = Number(ps.maxPrice);
    // eSagu requires min < max (strict). If the floor is at/above max, lift max just
    // above the floor (>=1% or 50p headroom) so the item pins near break-even.
    const bufferedMax = newMin + Math.max(50, Math.round(newMin * 0.01));
    const newMax = (Number.isFinite(liveMax) && liveMax > newMin) ? liveMax : bufferedMax;
    const newFixed = (ps.fixedPrice != null) ? clamp(Number(ps.fixedPrice), newMin, newMax) : ps.fixedPrice;
    const modified = { ...strategy, priceSettings: { ...ps, minPrice: newMin, maxPrice: newMax, fixedPrice: newFixed } };

    if (!live) { results.push({ id, dryRun: true, fromMin: liveMin, toMin: newMin, maxBumped: newMax !== liveMax ? newMax : undefined, ext_market: t.ext_market, amazon_price: t.amazon_price }); continue; }

    const { data: logRow, error: logErr } = await supabase.from("esagu_floor_push_log").insert({
      esagu_item_id: id, source_fn: CALLER_FN,
      old_min_pence: Number.isFinite(liveMin) ? liveMin : null, new_min_pence: newMin,
      old_max_pence: Number.isFinite(liveMax) ? liveMax : null, new_max_pence: newMax,
      ok: null, caller_kind: caller.kind, caller_user_id: caller.userId, reason: "cost floor (break-even)", user_agent: userAgent,
    }).select("id").single();
    if (logErr || !logRow) {
      console.error(`[push-log] insert failed for item ${id}: ${logErr?.message ?? "no row"} — stopping run`);
      results.push({ id, ok: false, stage: "log", err: "push log write failed; not pushed (run stopped)" });
      aborted = true;
      break;
    }

    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: eauth, body: JSON.stringify(modified) });
    const ok = pres.ok;
    const bodyTxt = ok ? undefined : (await pres.text().catch(() => "")).slice(0, 200);
    if (ok) changed++;
    const { error: updErr } = await supabase.from("esagu_floor_push_log")
      .update({ ok, http_status: pres.status, error: bodyTxt ?? null }).eq("id", logRow.id);
    if (updErr) console.error(`[push-log] outcome update failed for log row ${logRow.id}: ${updErr.message}`);
    results.push({ id, ok, status: pres.status, fromMin: liveMin, toMin: newMin, maxBumped: newMax !== liveMax ? newMax : undefined, err: bodyTxt });
    await new Promise((r) => setTimeout(r, 150));
  }

  if (live) await supabase.rpc("amazon_esagu_costfloor_log", { p_changed: changed, p_detail: { results, aborted } });
  return json({ ok: !aborted, live, aborted, candidates: list.length, changed, results });
});
