// ============================================================================
// esagu-clearance — campaign orchestrator for Clearance → Amazon (Phase B/D).
//
// Given campaign id(s), drives the "Sale to Amazon" mechanism end to end:
//   apply : resolve each campaign's SKU → its eSagu repricing item(s), and LOWER
//           the item's min-price to the campaign floor (= campaign_price). eSagu
//           then optimises down toward that floor only when beaten. We ONLY ever
//           lower — if the floor isn't below the item's current min it's skipped
//           (no-op). The pre-change strategy is snapshotted per campaign so it's
//           revertible.
//   revert: read each campaign's snapshot and restore the original min/max, then
//           mark it reverted.
//
// SAFETY: dry-run by DEFAULT (live:false) → returns the full plan (which items,
// current min → planned min, what's skipped) and writes NOTHING to eSagu or the
// DB. live:true actually PUTs + records/marks. ≤200 items/call.
//
// Body: { campaignIds: string[], mode?: "apply"|"revert", live?: boolean }
// Auth: service-role/authenticated JWT (gateway verify_jwt).
// Uses SERVICE_ROLE_KEY for the resolver/snapshot RPCs; ESAGU_KEY for eSagu.
// ============================================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function rpc(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`rpc ${name} ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const esaguToken = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!esaguToken) return json({ ok: false, error: "ESAGU_KEY not set in vault." }, 500);
  const esaguAuth = { Authorization: `Bearer ${esaguToken}`, "Content-Type": "application/json", Accept: "application/json" };

  let campaignIds: string[] = [];
  let mode = "apply";
  let live = false;
  try {
    const body = await req.json();
    campaignIds = Array.isArray(body.campaignIds) ? body.campaignIds : [];
    if (body.mode === "revert") mode = "revert";
    live = body.live === true;
  } catch { return json({ ok: false, error: 'Body must be { campaignIds:[uuid], mode?, live? }' }, 400); }
  if (campaignIds.length === 0) return json({ ok: false, error: "No campaignIds supplied." }, 400);

  // GET an item's strategy; returns { strategy, ps } or throws.
  const getStrategy = async (itemId: number) => {
    const g = await fetch(`${ESAGU_BASE}/item/${itemId}/strategy`, { headers: esaguAuth });
    const gt = await g.text();
    if (!g.ok) throw new Error(`get ${g.status}: ${gt.slice(0, 200)}`);
    const strategy = JSON.parse(gt);
    return { strategy, ps: strategy.priceSettings ?? {} };
  };
  const putStrategy = async (itemId: number, modified: unknown) => {
    const p = await fetch(`${ESAGU_BASE}/item/${itemId}/strategy`, { method: "PUT", headers: esaguAuth, body: JSON.stringify(modified) });
    const pt = await p.text();
    return { ok: p.ok, status: p.status, body: pt.slice(0, 200) };
  };
  const clampFixed = (fixed: any, min: number | undefined, max: number | undefined) => {
    if (fixed == null) return fixed;
    let f = Number(fixed);
    if (min !== undefined && f < min) f = min;
    if (max !== undefined && f > max) f = max;
    return f;
  };

  // ── APPLY ────────────────────────────────────────────────────────────────
  if (mode === "apply") {
    const targets: any[] = await rpc("amazon_esagu_clearance_targets", { p_campaign_ids: campaignIds });
    if (targets.length > 200) return json({ ok: false, error: `Refusing ${targets.length} items (>200) in one call.` }, 400);

    const results: any[] = [];
    const snapsByCampaign: Record<string, any[]> = {};

    for (const t of targets) {
      const itemId = Number(t.esagu_item_id);
      const floorPennies = Math.round(Number(t.floor_gbp) * 100);
      const base = { campaignId: t.campaign_id, sku: t.sku, itemId };
      if (!itemId || !(floorPennies > 0)) { results.push({ ...base, ok: false, error: "bad item/floor" }); continue; }

      let ps: any;
      try { ({ ps } = await getStrategy(itemId)); }
      catch (e) { results.push({ ...base, ok: false, stage: "get", error: String(e) }); continue; }

      const curMin = Number(ps.minPrice);
      // ONLY lower — never raise the floor.
      if (!(floorPennies < curMin)) {
        results.push({ ...base, ok: true, skipped: "floor not below current min", curMin, floorPennies });
        continue;
      }
      const newFixed = clampFixed(ps.fixedPrice, floorPennies, Number(ps.maxPrice));
      const before = { minPrice: ps.minPrice, maxPrice: ps.maxPrice, fixedPrice: ps.fixedPrice, mode: ps.mode };

      if (!live) {
        results.push({ ...base, ok: true, dryRun: true, before, plannedMin: floorPennies, note: `would lower min ${curMin} → ${floorPennies} (pennies)` });
        continue;
      }
      const { strategy } = await getStrategy(itemId); // re-read to PUT the full object
      const modified = { ...strategy, priceSettings: { ...strategy.priceSettings, minPrice: floorPennies, fixedPrice: newFixed } };
      const put = await putStrategy(itemId, modified);
      results.push({ ...base, ok: put.ok, live: true, status: put.status, before, appliedMin: floorPennies, response: put.body });
      if (put.ok) {
        (snapsByCampaign[t.campaign_id] ??= []).push({
          esagu_item_id: itemId, catalogue_sku: t.sku,
          orig_min: ps.minPrice, orig_max: ps.maxPrice, orig_fixed: ps.fixedPrice, orig_mode: ps.mode,
          applied_min: floorPennies, applied_max: ps.maxPrice,
        });
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    let recorded = 0;
    if (live) for (const [cid, items] of Object.entries(snapsByCampaign)) {
      recorded += Number(await rpc("amazon_record_esagu_snapshot", { p_campaign_id: cid, p_items: items }) ?? 0);
    }
    return json({ ok: true, mode, live, campaigns: campaignIds.length, items: targets.length,
      applied: results.filter((r) => r.live && r.ok).length,
      skipped: results.filter((r) => r.skipped).length,
      snapshots_recorded: recorded, results });
  }

  // ── REVERT ───────────────────────────────────────────────────────────────
  const results: any[] = [];
  let marked = 0;
  for (const cid of campaignIds) {
    const snaps: any[] = await rpc("amazon_esagu_snapshots_for_revert", { p_campaign_id: cid });
    let allOk = snaps.length > 0;
    for (const s of snaps) {
      const itemId = Number(s.esagu_item_id);
      const restoreMin = s.orig_min_price != null ? Number(s.orig_min_price) : undefined;
      const restoreMax = s.orig_max_price != null ? Number(s.orig_max_price) : undefined;
      let ps: any, strategy: any;
      try { ({ ps, strategy } = await getStrategy(itemId)); }
      catch (e) { results.push({ campaignId: cid, itemId, ok: false, stage: "get", error: String(e) }); allOk = false; continue; }
      const before = { minPrice: ps.minPrice, maxPrice: ps.maxPrice };
      const newFixed = clampFixed(ps.fixedPrice, restoreMin, restoreMax);
      const nextPs: any = { ...ps, fixedPrice: newFixed };
      if (restoreMin !== undefined) nextPs.minPrice = restoreMin;
      if (restoreMax !== undefined) nextPs.maxPrice = restoreMax;

      if (!live) { results.push({ campaignId: cid, itemId, ok: true, dryRun: true, before, restoreMin, restoreMax }); continue; }
      const put = await putStrategy(itemId, { ...strategy, priceSettings: nextPs });
      results.push({ campaignId: cid, itemId, ok: put.ok, live: true, status: put.status, before, restoreMin, restoreMax, response: put.body });
      if (!put.ok) allOk = false;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (live && allOk && snaps.length > 0) marked += Number(await rpc("amazon_mark_esagu_reverted", { p_campaign_id: cid }) ?? 0);
  }
  return json({ ok: true, mode, live, campaigns: campaignIds.length,
    restored: results.filter((r) => r.live && r.ok).length, marked_reverted: marked, results });
});
