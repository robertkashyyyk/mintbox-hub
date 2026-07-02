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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
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
