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
