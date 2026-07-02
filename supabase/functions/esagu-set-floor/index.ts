// esagu-set-floor — thin WRITE executor for Hub-driven Amazon repricing. Given
// explicit {itemId, floor(£)} (a target-tier price), sets the eSagu minPrice to it so
// eSagu can't sell below that tier and optimises up from there. Where the floor is at
// or above maxPrice, lifts max just above (eSagu requires min<max). RAISE-only on min
// by default (won't drop a floor) unless allowLower:true. Dry-run default.
// Body: { items:[{itemId,floor}], live?, allowLower? }. eSagu: Bearer ESAGU_KEY.
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const token = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!token) return json({ ok: false, error: "ESAGU_KEY not set." }, 500);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  let items: Array<{ itemId: number; floor: number }> = [];
  let live = false, allowLower = false;
  try { const b = await req.json(); items = Array.isArray(b.items) ? b.items : []; live = b.live === true; allowLower = b.allowLower === true; }
  catch { return json({ ok: false, error: "Body must be { items:[{itemId,floor}], live? }" }, 400); }
  if (items.length === 0) return json({ ok: false, error: "No items supplied." }, 400);
  if (items.length > 300) return json({ ok: false, error: "Refusing >300 items in one call (safety)." }, 400);

  const results: any[] = [];
  let changed = 0;
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

    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: auth, body: JSON.stringify(modified) });
    const ok = pres.ok;
    const errTxt = ok ? undefined : (await pres.text().catch(() => "")).slice(0, 200);
    if (ok) changed++;
    results.push({ id, ok, status: pres.status, fromMin: liveMin, toMin: newMin, maxBumped: newMax !== liveMax ? newMax : undefined, err: errTxt });
    await new Promise((r) => setTimeout(r, 150));
  }
  return json({ ok: true, live, count: items.length, changed, succeeded: results.filter((r) => r.ok).length, results });
});
