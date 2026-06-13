// threeds-reprice-reconcile
// Clears the 3D repricer pending queue once a price has gone LIVE, so items don't
// sit "queued" forever and the SFTP file stops re-importing them.
//
// A pending price is confirmed live by EITHER:
//   (a) SALES-CONFIRMED — the SKU sold at (≈) the new price after it was queued.
//       Rock-solid proof the listing is at the new price. → status 'applied'.
//   (b) IMPORT-CYCLE — it's been queued longer than importCycleHours (default 30),
//       so 3D's daily import has definitely run and applied it. → status 'applied'.
// Otherwise it stays pending. Confirmed rows are dropped from each store's SFTP
// file. (The old 3D /v1/products master-price check never matched the per-market
// eBay price, so it's gone — sales are the reliable signal.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Client from "npm:ssh2-sftp-client@10.0.3";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let ok = bearer === serviceKey;
  if (!ok && bearer) { try { ok = JSON.parse(atob(bearer.split(".")[1] ?? ""))?.role === "service_role"; } catch { /* ignore */ } }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: { tolerance?: number; importCycleHours?: number; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const tol = typeof body.tolerance === "number" ? body.tolerance : 0.05;
  const importCycleHours = typeof body.importCycleHours === "number" ? body.importCycleHours : 30;
  const goLiveHours = typeof body.goLiveHours === "number" ? body.goLiveHours : 18; // by now the evening import has applied it
  const dryRun = body.dryRun === true;

  const admin = createClient(url, serviceKey);

  const { data: stores } = await admin.from("threeds_stores").select("id, store_name, sftp_filename, ebay_store_slug, enabled");
  const slug: Record<string, string> = {};
  for (const s of stores ?? []) if (s.ebay_store_slug) slug[s.id] = s.ebay_store_slug;

  const { data: pending, error: pendErr } = await admin
    .from("threeds_reprice_pending").select("id, store_id, sku, price, queued_at").eq("status", "pending");
  if (pendErr) return json({ error: `load pending failed: ${pendErr.message}` }, 500);
  if (!pending || pending.length === 0) return json({ ok: true, pending: 0 });

  // Sales for the pending SKUs since the earliest queued time (to confirm "went live").
  const skus = Array.from(new Set(pending.map((p) => p.sku)));
  const earliest = pending.reduce((m, p) => (p.queued_at < m ? p.queued_at : m), pending[0].queued_at);
  const orders: any[] = [];
  for (let i = 0; i < skus.length; i += 80) {
    let from = 0;
    while (true) {
      const { data } = await admin.from("threeds_order_transactions")
        .select("sku, store_url, unit_price, order_date")
        .in("sku", skus.slice(i, i + 80)).gte("order_date", earliest).range(from, from + 999);
      const b = data ?? []; orders.push(...b);
      if (b.length < 1000) break; from += 1000;
    }
  }

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const applied: { id: string; verified: number | null; reason: string }[] = [];
  const affectedStores = new Set<string>();

  const notLive: { sku: string; sold: number; expected: number }[] = [];
  for (const row of pending) {
    const sl = slug[row.store_id];
    const ageH = (nowMs - new Date(row.queued_at).getTime()) / 3_600_000;
    // Most recent sale for this store+sku AFTER it was queued (the current state).
    let latestPrice: number | null = null; let latestDate = "";
    if (sl) {
      for (const o of orders) {
        if (o.sku !== row.sku || !(o.store_url ?? "").includes(sl) || o.order_date <= row.queued_at) continue;
        if (o.order_date > latestDate) { latestDate = o.order_date; latestPrice = Number(o.unit_price); }
      }
    }
    const latestAfterGoLive = latestDate && (new Date(latestDate).getTime() - new Date(row.queued_at).getTime()) / 3_600_000 > goLiveHours;
    if (latestPrice != null && Math.abs(latestPrice - Number(row.price)) <= tol) {
      // (a) latest sale is at the new price → confirmed live.
      applied.push({ id: row.id, verified: latestPrice, reason: "sold_at_new" }); affectedStores.add(row.store_id);
    } else if (latestPrice != null && latestAfterGoLive) {
      // Latest sale is at the OLD price AND after the price should have gone live → didn't take. Keep + flag.
      notLive.push({ sku: row.sku, sold: latestPrice, expected: Number(row.price) });
    } else if (ageH > importCycleHours) {
      // (b) no decisive recent sale + been through a daily import → assume live.
      applied.push({ id: row.id, verified: null, reason: "import_cycle" }); affectedStores.add(row.store_id);
    }
  }

  if (dryRun) {
    return json({ ok: true, dryRun: true, pending: pending.length, wouldApply: applied.length,
      bySale: applied.filter((a) => a.reason === "sold_at_new").length, byTime: applied.filter((a) => a.reason === "import_cycle").length,
      not_live_kept: notLive.length, not_live: notLive.slice(0, 20) });
  }

  for (const a of applied) {
    await admin.from("threeds_reprice_pending").update({ status: "applied", applied_at: nowIso, verified_price: a.verified }).eq("id", a.id);
  }

  // Rewrite affected stores' SFTP files from remaining pending.
  let filesRewritten = 0;
  const host = Deno.env.get("THREEDS_SFTP_HOST");
  const port = parseInt(Deno.env.get("THREEDS_SFTP_PORT") ?? "22", 10);
  const username = Deno.env.get("THREEDS_SFTP_USER");
  const password = Deno.env.get("THREEDS_SFTP_PASSWORD");
  if (affectedStores.size > 0 && host && username && password) {
    const escape = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (const storeId of affectedStores) {
      const store = (stores ?? []).find((s) => s.id === storeId);
      if (!store?.sftp_filename || !store.enabled) continue;
      const { data: still } = await admin.from("threeds_reprice_pending")
        .select("sku, price").eq("store_id", storeId).eq("status", "pending").order("sku");
      const csv = ["SKU,Price", ...(still ?? []).map((r) => `${escape(String(r.sku).trim())},${Number(r.price).toFixed(2)}`)].join("\n") + "\n";
      const sftp = new Client();
      try {
        await sftp.connect({ host, port, username, password, readyTimeout: 20000 });
        await sftp.put(Buffer.from(csv, "utf-8"), store.sftp_filename);
        await sftp.end(); filesRewritten++;
      } catch (_e) { try { await sftp.end(); } catch { /* ignore */ } }
    }
  }

  return json({
    ok: true, pending: pending.length, applied: applied.length,
    sold_at_new: applied.filter((a) => a.reason === "sold_at_new").length,
    import_cycle: applied.filter((a) => a.reason === "import_cycle").length,
    not_live_kept: notLive.length, not_live: notLive.slice(0, 20),
    filesRewritten,
  });
});
