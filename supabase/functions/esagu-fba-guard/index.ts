// ============================================================================
// esagu-fba-guard — STANDING job. Each run: recompute the actionable FBA-
// priority set from the mirror (FBA in OPTIMIZATION mode, has stock, stranded
// above our own FBM, FBM ≥ the FBA's own floor, cap not already at FBM) and cap
// each FBA's maxPrice = FBM so the (Prime-preferred) FBA takes the buy box and
// storage-costly stock clears. Not a one-off: the stranded set churns as stock
// replenishes and FBM prices move, so pg_cron runs this daily.
//
// Body: { live?: boolean (default false = dry-run), max?: number (default 100) }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!token) return json({ ok: false, error: "ESAGU_KEY not set." }, 500);
  const eauth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let live = false, max = 100;
  try { const b = await req.json().catch(() => ({})); live = b.live === true; if (b.max) max = Math.min(200, Math.max(1, Number(b.max))); } catch { /* defaults */ }

  const { data: targets, error } = await supabase.rpc("esagu_guard_targets");
  if (error) return json({ ok: false, stage: "targets", error: error.message }, 200);
  const list = (targets ?? []).slice(0, max);

  const results: any[] = [];
  let changed = 0;
  for (const t of list) {
    const id = Number(t.fba_item_id);
    const newMax = Math.round(Number(t.target_maxprice) * 100);
    const floor = Math.round(Number(t.fba_min) * 100);
    if (newMax < floor) { results.push({ id, skipped: "target<floor" }); continue; }

    const gres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { headers: eauth });
    if (!gres.ok) { results.push({ id, ok: false, stage: "get", status: gres.status }); continue; }
    const strategy = await gres.json();
    const ps = strategy.priceSettings ?? {};
    if (Number(ps.maxPrice) === newMax) { results.push({ id, noop: "already at FBM" }); continue; }

    const newFixed = Number(ps.fixedPrice) > newMax ? newMax : ps.fixedPrice;
    const modified = { ...strategy, priceSettings: { ...ps, maxPrice: newMax, fixedPrice: newFixed } };

    if (!live) { results.push({ id, dryRun: true, from: ps.maxPrice, to: newMax }); continue; }

    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: eauth, body: JSON.stringify(modified) });
    const ok = pres.ok;
    if (ok) changed++;
    results.push({ id, ok, status: pres.status, from: ps.maxPrice, to: newMax });
    await new Promise((r) => setTimeout(r, 150));
  }

  if (live) await supabase.rpc("amazon_esagu_guard_log", { p_changed: changed, p_detail: { results } });
  return json({ ok: true, live, candidates: list.length, changed, results });
});
