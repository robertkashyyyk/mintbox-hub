// ============================================================================
// esagu-set-strategy — thin WRITE executor for Hub-driven eSagu repricing.
// Generalises esagu-set-maxprice: given {itemId, minPrice?(£), maxPrice?(£)},
// GET the item's current strategy, change ONLY the supplied bound(s) (preserving
// mode / fixedPrice / templates / the untouched bound), and PUT it back.
//
// This is the executor the Clearance "Sale to Amazon" path uses. The Amazon
// mechanism differs from eBay: instead of hard-setting the price down to a floor,
// we LOWER THE min-price to that floor and let eSagu optimise — it keeps the price
// as high as it can while winning the buybox, walking down toward the new floor
// only when it's beaten. Sale = modest floor drop; Liquidation = much lower floor.
// (max is still settable for the sole-seller case, where lowering the floor alone
//  wouldn't cut the price.)
//
// The Hub computes WHICH items + WHAT floor; this just executes, auditably.
//
// SAFETY: dry-run by default (live:false) → returns current strategy + planned
// change, writes NOTHING. live:true actually PUTs. ≤200 items/call. Enforces
// min ≤ max and keeps fixedPrice within [min,max] so eSagu can't reject on an
// invariant.
//
// Body: { items: [{ itemId: number, minPrice?: number(£), maxPrice?: number(£) }], live?: boolean }
// Auth: service-role JWT (gateway verify_jwt).
// eSagu auth: Bearer ESAGU_KEY (the JWT). Prices in pennies.
// ============================================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";
const toPennies = (gbp: unknown): number | undefined =>
  gbp === undefined || gbp === null || gbp === "" ? undefined : Math.round(Number(gbp) * 100);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const token = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!token) return json({ ok: false, error: "ESAGU_KEY not set in vault." }, 500);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" };

  let items: Array<{ itemId: number; minPrice?: number; maxPrice?: number }> = [];
  let live = false;
  try {
    const body = await req.json();
    items = Array.isArray(body.items) ? body.items : [];
    live = body.live === true;
  } catch { return json({ ok: false, error: "Body must be { items:[{itemId,minPrice?,maxPrice?}], live? }" }, 400); }
  if (items.length === 0) return json({ ok: false, error: "No items supplied." }, 400);
  if (items.length > 200) return json({ ok: false, error: "Refusing >200 items in one call (safety)." }, 400);

  const results: any[] = [];
  for (const it of items) {
    const id = Number(it.itemId);
    const newMin = toPennies(it.minPrice);
    const newMax = toPennies(it.maxPrice);
    if (!id) { results.push({ itemId: it.itemId, ok: false, error: "bad itemId" }); continue; }
    if (newMin === undefined && newMax === undefined) { results.push({ itemId: id, ok: false, error: "supply minPrice and/or maxPrice" }); continue; }
    if ((newMin !== undefined && !(newMin > 0)) || (newMax !== undefined && !(newMax > 0))) {
      results.push({ itemId: id, ok: false, error: "prices must be > 0" }); continue;
    }

    // 1. GET current strategy
    const gres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { headers: auth });
    const gtext = await gres.text();
    if (!gres.ok) { results.push({ itemId: id, ok: false, stage: "get", status: gres.status, body: gtext.slice(0, 300) }); continue; }
    let strategy: any;
    try { strategy = JSON.parse(gtext); } catch { results.push({ itemId: id, ok: false, stage: "get-parse", body: gtext.slice(0, 200) }); continue; }

    const ps = strategy.priceSettings ?? {};
    const before = { minPrice: ps.minPrice, maxPrice: ps.maxPrice, fixedPrice: ps.fixedPrice, mode: ps.mode };

    // effective bounds after this change (untouched bound preserved)
    const effMin = newMin ?? (ps.minPrice != null ? Number(ps.minPrice) : undefined);
    const effMax = newMax ?? (ps.maxPrice != null ? Number(ps.maxPrice) : undefined);
    if (effMin !== undefined && effMax !== undefined && effMin > effMax) {
      results.push({ itemId: id, ok: false, error: `min ${effMin} > max ${effMax} — refusing`, before }); continue;
    }
    // keep fixedPrice within [min,max] (fixedPrice is ignored in OPTIMIZATION mode anyway)
    let newFixed = ps.fixedPrice;
    if (newFixed != null) {
      if (effMin !== undefined && Number(newFixed) < effMin) newFixed = effMin;
      if (effMax !== undefined && Number(newFixed) > effMax) newFixed = effMax;
    }

    const nextPs: any = { ...ps, fixedPrice: newFixed };
    if (newMin !== undefined) nextPs.minPrice = newMin;
    if (newMax !== undefined) nextPs.maxPrice = newMax;
    const modified = { ...strategy, priceSettings: nextPs };
    const planned = { minPrice: nextPs.minPrice, maxPrice: nextPs.maxPrice, fixedPrice: newFixed };

    if (!live) {
      results.push({ itemId: id, ok: true, dryRun: true, before, planned,
        note: `would set ${newMin !== undefined ? `min ${before.minPrice}→${newMin}` : ""}${newMin !== undefined && newMax !== undefined ? ", " : ""}${newMax !== undefined ? `max ${before.maxPrice}→${newMax}` : ""} (pennies)` });
      continue;
    }

    // 2. PUT modified strategy
    const pres = await fetch(`${ESAGU_BASE}/item/${id}/strategy`, { method: "PUT", headers: auth, body: JSON.stringify(modified) });
    const ptext = await pres.text();
    results.push({ itemId: id, ok: pres.ok, live: true, status: pres.status, before, planned, response: ptext.slice(0, 300) });
    await new Promise((r) => setTimeout(r, 150));
  }

  return json({ ok: true, live, count: items.length,
    succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
});
