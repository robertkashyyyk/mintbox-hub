// reprice-payoff
// "What did repricing earn vs not repricing?" — VOLUME-AWARE.
//
// For each repriced item, over the period since its new price went live:
//   ACTUAL (repricer on)   = real profit of the sales we actually made.
//   COUNTERFACTUAL (off)   = the item's USUAL sales rate (from before the reprice)
//                            × the period × its old per-unit profit/loss.
//                            (So an item that used to sell at a loss and now sells
//                             less/none counts the AVOIDED loss.)
//   VALUE = ACTUAL − COUNTERFACTUAL.
// Totals and per-account use the same model, so they reconcile.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const COURIER = 1.65, VAT = 1.2, BASELINE_DAYS = 90;
const baseSkuOf = (s: string) => s.replace(/-Q[0-9]+$/i, "");
const packSizeOf = (s: string) => { const m = s.match(/-Q([0-9]+)$/i); return m ? parseInt(m[1], 10) : 1; };
// The new price is live by ~21:00 UTC (after the evening 3D imports) on/after the queue day.
function goLive(queuedIso: string): number {
  const q = new Date(queuedIso); const g = new Date(q);
  g.setUTCHours(21, 0, 0, 0);
  if (q.getTime() >= g.getTime()) g.setUTCDate(g.getUTCDate() + 1);
  return g.getTime();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!; const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!(req.headers.get("Authorization") ?? "").startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  let body: { persist?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const admin = createClient(url, serviceKey);
  const nowMs = Date.now();

  const { data: stores } = await admin.from("threeds_stores").select("id, store_name, ebay_store_slug");
  const slug: Record<string, string> = {}, sname: Record<string, string> = {};
  for (const s of stores ?? []) { if (s.ebay_store_slug) slug[s.id] = s.ebay_store_slug; sname[s.id] = s.store_name; }

  // Profit-repricer pushes only — exclude liquidation/clearance cuts so deliberate
  // dead-stock dumping isn't counted as repricing value.
  const { data: pending } = await admin.from("threeds_reprice_pending")
    .select("store_id, sku, price, queued_at").neq("source", "liquidation");
  const rp = new Map<string, { store_id: string; sku: string; price: number; queued_at: string }>();
  for (const r of pending ?? []) { const k = `${r.store_id}::${r.sku}`; const c = rp.get(k); if (!c || r.queued_at > c.queued_at) rp.set(k, r as any); }
  if (rp.size === 0) return json({ ok: true, empty: true });
  const skus = Array.from(new Set(Array.from(rp.values()).map((r) => r.sku)));
  const earliest = Array.from(rp.values()).reduce((m, r) => (r.queued_at < m ? r.queued_at : m), "9999");

  const baseSkus = Array.from(new Set(skus.map(baseSkuOf)));
  const cost: Record<string, number> = {};
  for (let i = 0; i < baseSkus.length; i += 100) {
    const { data } = await admin.from("products_cache").select("sku, cost_price").in("sku", baseSkus.slice(i, i + 100));
    for (const r of data ?? []) if (r.cost_price != null) cost[r.sku] = Number(r.cost_price);
  }

  // Orders for the repriced SKUs from the baseline window through now.
  const orders: any[] = [];
  for (let i = 0; i < skus.length; i += 80) {
    let from = 0;
    while (true) {
      const { data } = await admin.from("threeds_order_transactions")
        .select("sku, store_url, unit_price, quantity, final_value_fee, order_date, raw")
        .in("sku", skus.slice(i, i + 80)).gte("order_date", "2026-03-01").range(from, from + 999);
      const b = data ?? []; orders.push(...b); if (b.length < 1000) break; from += 1000;
    }
  }
  // Group orders by store-slug::sku for quick lookup.
  const byKey: Record<string, any[]> = {};
  for (const o of orders) {
    const su = o.store_url ?? "";
    for (const [, r] of rp) { const sl = slug[r.store_id]; if (sl && su.includes(sl) && o.sku === r.sku) { (byKey[`${r.store_id}::${o.sku}`] ??= []).push(o); break; } }
  }
  const realProfit = (o: any) => {
    const qty = Number(o.quantity); const up = Number(o.unit_price);
    const ship = Number(o.raw?.shippingPrice ?? 0); const fvf = Number(o.final_value_fee ?? 0);
    const c = cost[baseSkuOf(o.sku)] ?? 0;
    return (up * qty + ship) / VAT - fvf - COURIER * qty - c * packSizeOf(o.sku) * qty;
  };

  type Acc = { actual_units: number; actual_profit: number; cf_units: number; cf_profit: number };
  const mk = (): Acc => ({ actual_units: 0, actual_profit: 0, cf_units: 0, cf_profit: 0 });
  const total = mk(); const byAcct: Record<string, Acc> = {};

  for (const [k, r] of rp) {
    const gl = goLive(r.queued_at); const periodD = Math.max(0, (nowMs - gl) / 86_400_000);
    const os = byKey[k] ?? [];
    // baseline: sales in the 90d before the reprice
    const blStart = new Date(r.queued_at).getTime() - BASELINE_DAYS * 86_400_000;
    const bl = os.filter((o) => { const t = new Date(o.order_date).getTime(); return t >= blStart && t < new Date(r.queued_at).getTime(); });
    let oldRate = 0, oldPPU = 0;
    if (bl.length) {
      const blUnits = bl.reduce((s, o) => s + Number(o.quantity), 0);
      const firstT = Math.min(...bl.map((o) => new Date(o.order_date).getTime()));
      const spanD = Math.max(1, Math.min(BASELINE_DAYS, (new Date(r.queued_at).getTime() - firstT) / 86_400_000));
      oldRate = blUnits / spanD;
      const blProfit = bl.reduce((s, o) => s + realProfit(o), 0);
      oldPPU = blUnits ? blProfit / blUnits : 0;
    }
    // actual: sales since go-live
    const act = os.filter((o) => new Date(o.order_date).getTime() >= gl);
    const actualUnits = act.reduce((s, o) => s + Number(o.quantity), 0);
    const actualProfit = act.reduce((s, o) => s + realProfit(o), 0);
    const cfUnits = oldRate * periodD; const cfProfit = cfUnits * oldPPU;

    const a = (byAcct[sname[r.store_id]] ??= mk());
    for (const t of [total, a]) { t.actual_units += actualUnits; t.actual_profit += actualProfit; t.cf_units += cfUnits; t.cf_profit += cfProfit; }
  }

  const round = (a: Acc) => ({
    actual_units: Math.round(a.actual_units), actual_profit: Math.round(a.actual_profit * 100) / 100,
    cf_units: Math.round(a.cf_units * 10) / 10, cf_profit: Math.round(a.cf_profit * 100) / 100,
    value: Math.round((a.actual_profit - a.cf_profit) * 100) / 100,
  });

  const t = round(total);
  if (body.persist) {
    const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    await admin.from("reprice_payoff_daily").upsert({
      snapshot_date: londonDate, generated_at: new Date().toISOString(), repriced_skus: skus.length,
      actual_units: t.actual_units, actual_profit: t.actual_profit, cf_units: t.cf_units, cf_profit: t.cf_profit, value: t.value,
    }, { onConflict: "snapshot_date" });
  }

  return json({
    ok: true, generated_at: new Date().toISOString(), repriced_skus: skus.length, earliest_reprice: earliest,
    total: t,
    by_account: Object.entries(byAcct).map(([account, a]) => ({ account, ...round(a) })).sort((x, y) => y.value - x.value),
    assumptions: { courier_per_unit: COURIER, vat: VAT - 1, baseline_days: BASELINE_DAYS, go_live: "21:00 UTC after the queue day", note: "counterfactual = usual pre-reprice sales rate × period × old per-unit profit" },
  });
});
