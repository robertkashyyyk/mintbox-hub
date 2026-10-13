// esagu-set-floor — thin WRITE executor for Hub-driven Amazon repricing. Given
// explicit {itemId, floor(£)} (a target-tier price), sets the eSagu minPrice to it so
// eSagu can't sell below that tier and optimises up from there. Where the floor is at
// or above maxPrice, lifts max just above (eSagu requires min<max). RAISE-only on min
// by default (won't drop a floor) unless allowLower:true. Dry-run default.
// Body: { items:[{itemId,floor}], live?, allowLower?, reason? }. eSagu: Bearer ESAGU_KEY.
// Every live push is logged (old/new floor, caller) in public.esagu_floor_push_log.
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
const CALLER_FN = "esagu-set-floor";
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
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  let items: Array<{ itemId: number; floor: number }> = [];
  let live = false, allowLower = false, reason: string | null = null;
  try {
    const b = await req.json();
    items = Array.isArray(b.items) ? b.items : []; live = b.live === true; allowLower = b.allowLower === true;
    reason = typeof b.reason === "string" ? b.reason.slice(0, 200) : null;
  }
  catch { return json({ ok: false, error: "Body must be { items:[{itemId,floor}], live?, reason? }" }, 400); }
  if (items.length === 0) return json({ ok: false, error: "No items supplied." }, 400);
  if (items.length > 300) return json({ ok: false, error: "Refusing >300 items in one call (safety)." }, 400);

  // Every live push is logged write-ahead: the row (old/new floor, caller) goes in before
  // the PUT and the outcome is filled in after. No log row, no push — the run stops.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300);

  const results: any[] = [];
  let changed = 0, aborted = false;
  for (const it of items) {
    const id = Number(it.itemId);
    const newMin = Math.round(Number(it.floor) * 100);
    if (!id || !(newMin > 0)) { results.push({ id: it.itemId, ok: false, error: "bad itemId/floor" }); continue; }

    const gres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { headers: auth });
    if (!gres.ok) { results.push({ id, ok: false, stage: "get", status: gres.status }); continue; }
    const strategy = await gres.json();
    const ps = strategy.priceSettings ?? {};
    const liveMin = Number(ps.minPrice);
    if (!allowLower && liveMin >= newMin) { results.push({ id, noop: "live min already >= floor", liveMin, floor: newMin }); continue; }

    const liveMax = Number(ps.maxPrice);
    const bufferedMax = newMin + Math.max(50, Math.round(newMin * 0.01));
    const newMax = (Number.isFinite(liveMax) && liveMax > newMin) ? liveMax : bufferedMax;
    const newFixed = (ps.fixedPrice != null) ? clamp(Number(ps.fixedPrice), newMin, newMax) : ps.fixedPrice;
    const modified = { ...strategy, priceSettings: { ...ps, minPrice: newMin, maxPrice: newMax, fixedPrice: newFixed } };

    if (!live) { results.push({ id, dryRun: true, fromMin: liveMin, toMin: newMin, maxBumped: newMax !== liveMax ? newMax : undefined }); continue; }

    const { data: logRow, error: logErr } = await admin.from("esagu_floor_push_log").insert({
      esagu_item_id: id,
      old_min_pence: Number.isFinite(liveMin) ? liveMin : null, new_min_pence: newMin,
      old_max_pence: Number.isFinite(liveMax) ? liveMax : null, new_max_pence: newMax,
      ok: null, caller_kind: caller.kind, caller_user_id: caller.userId, reason, user_agent: userAgent,
    }).select("id").single();
    if (logErr || !logRow) {
      console.error(`[push-log] insert failed for item ${id}: ${logErr?.message ?? "no row"} — stopping run`);
      results.push({ id, ok: false, stage: "log", err: "push log write failed; not pushed (run stopped)" });
      aborted = true;
      break;
    }

    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: auth, body: JSON.stringify(modified) });
    const ok = pres.ok;
    const errTxt = ok ? undefined : (await pres.text().catch(() => "")).slice(0, 200);
    if (ok) changed++;
    const { error: updErr } = await admin.from("esagu_floor_push_log")
      .update({ ok, http_status: pres.status, error: errTxt ?? null }).eq("id", logRow.id);
    if (updErr) console.error(`[push-log] outcome update failed for log row ${logRow.id}: ${updErr.message}`);
    results.push({ id, ok, status: pres.status, fromMin: liveMin, toMin: newMin, maxBumped: newMax !== liveMax ? newMax : undefined, err: errTxt });
    await new Promise((r) => setTimeout(r, 150));
  }
  return json({ ok: !aborted, live, aborted, count: items.length, changed, succeeded: results.filter((r) => r.ok).length, results });
});
