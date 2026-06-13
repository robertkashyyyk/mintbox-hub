// reprice-payoff
// Computes the realised payoff of the 3D repricer: for every sale of a repriced
// item since it was repriced, the profit at the actual (mostly new) price vs the
// counterfactual profit at the OLD price. Returns totals split by sold-at-new vs
// sold-pre-live, plus a per-account breakdown.
//
// v1 derives the "old price" from each SKU's median selling price BEFORE the
// earliest reprice, and reads the repriced set from the live pending queue. A
// durable reprice_events log would make this exact long-term (see report note).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const COURIER = 1.65; // UK courier per unit (repricer estimate)
const VAT = 1.2;
const baseSkuOf = (s: string) => s.replace(/-Q[0-9]+$/i, "");
const packSizeOf = (s: string) => { const m = s.match(/-Q([0-9]+)$/i); return m ? parseInt(m[1], 10) : 1; };
const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // Any authenticated caller (the report) or service role.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(url, serviceKey);

  const { data: stores } = await admin.from("threeds_stores").select("id, store_name, ebay_store_slug");
  const slug: Record<string, string> = {}; const sname: Record<string, string> = {};
  for (const s of stores ?? []) { if (s.ebay_store_slug) slug[s.id] = s.ebay_store_slug; sname[s.id] = s.store_name; }

  // Repriced set (latest price per store+sku) from the pending queue.
  const { data: pending } = await admin.from("threeds_reprice_pending").select("store_id, sku, price, queued_at");
  const rp = new Map<string, { store_id: string; sku: string; price: number; queued_at: string }>();
  for (const r of pending ?? []) {
    const k = `${r.store_id}::${r.sku}`;
    const cur = rp.get(k);
    if (!cur || r.queued_at > cur.queued_at) rp.set(k, r as any);
  }
  if (rp.size === 0) return json({ ok: true, empty: true });
  const skus = Array.from(new Set(Array.from(rp.values()).map((r) => r.sku)));
  const earliest = Array.from(rp.values()).reduce((m, r) => (r.queued_at < m ? r.queued_at : m), "9999");

  // Base costs.
  const baseSkus = Array.from(new Set(skus.map(baseSkuOf)));
  const cost: Record<string, number | null> = {};
  for (let i = 0; i < baseSkus.length; i += 100) {
    const { data } = await admin.from("products_cache").select("sku, cost_price").in("sku", baseSkus.slice(i, i + 100));
    for (const r of data ?? []) cost[r.sku] = r.cost_price;
  }

  // Orders for repriced SKUs from before the earliest reprice (baseline) through now.
  const orders: any[] = [];
  for (let i = 0; i < skus.length; i += 80) {
    let from = 0;
    while (true) {
      const { data } = await admin.from("threeds_order_transactions")
        .select("sku, store_url, unit_price, quantity, final_value_fee, order_date, raw")
        .in("sku", skus.slice(i, i + 80)).gte("order_date", "2026-04-01")
        .range(from, from + 999);
      const batch = data ?? [];
      orders.push(...batch);
      if (batch.length < 1000) break;
      from += 1000;
    }
  }

  // Old-price baseline: median unit_price before the earliest reprice, per SKU.
  const pre: Record<string, number[]> = {};
  for (const o of orders) if (o.order_date < earliest && o.unit_price) (pre[o.sku] ??= []).push(Number(o.unit_price));
  const oldp: Record<string, number | null> = {}; for (const s in pre) oldp[s] = median(pre[s]);

  type Bucket = { sales: number; units: number; profit_now: number; profit_old: number };
  const mk = (): Bucket => ({ sales: 0, units: 0, profit_now: 0, profit_old: 0 });
  const at_new = mk(), pre_live = mk();
  const byAcct: Record<string, Bucket> = {};

  for (const o of orders) {
    const su = o.store_url ?? "";
    let hit: any = null, sid = "";
    for (const [k, r] of rp) {
      const sl = slug[r.store_id];
      if (sl && su.includes(sl) && o.sku === r.sku && o.order_date > r.queued_at) { hit = r; sid = r.store_id; break; }
    }
    if (!hit) continue;
    const c = cost[baseSkuOf(o.sku)]; const ob = oldp[o.sku];
    if (c == null || ob == null) continue;
    const qty = Number(o.quantity); const up = Number(o.unit_price);
    const ship = Number(o.raw?.shippingPrice ?? 0); const fvf = Number(o.final_value_fee ?? 0);
    const costTotal = Number(c) * packSizeOf(o.sku) * qty; const cour = COURIER * qty;
    const gmvNow = up * qty + ship;
    const pn = gmvNow / VAT - fvf - cour - costTotal;
    const gmvOld = ob * qty + ship; const fvfOld = gmvNow > 0 ? fvf * (gmvOld / gmvNow) : fvf;
    const po = gmvOld / VAT - fvfOld - cour - costTotal;
    const b = Math.abs(up - Number(hit.price)) < 0.05 ? at_new : pre_live;
    b.sales++; b.units += qty; b.profit_now += pn; b.profit_old += po;
    const a = (byAcct[sname[sid]] ??= mk());
    a.sales++; a.units += qty; a.profit_now += pn; a.profit_old += po;
  }
  const tot: Bucket = {
    sales: at_new.sales + pre_live.sales, units: at_new.units + pre_live.units,
    profit_now: at_new.profit_now + pre_live.profit_now, profit_old: at_new.profit_old + pre_live.profit_old,
  };
  const round = (b: Bucket) => ({ ...b, profit_now: Math.round(b.profit_now * 100) / 100, profit_old: Math.round(b.profit_old * 100) / 100, uplift: Math.round((b.profit_now - b.profit_old) * 100) / 100 });

  return json({
    ok: true,
    generated_at: new Date().toISOString(),
    repriced_skus: skus.length,
    earliest_reprice: earliest,
    total: round(tot), at_new: round(at_new), pre_live: round(pre_live),
    by_account: Object.entries(byAcct).map(([account, b]) => ({ account, ...round(b) })).sort((x, y) => y.uplift - x.uplift),
    assumptions: { courier_per_unit: COURIER, vat: VAT - 1, old_price: "median pre-reprice sale price" },
  });
});
