// threeds-reprice-reconcile
// Nightly "did the prices take?" check for the 3D repricer.
//
// 1. Page the 3D Sellers catalogue (/v1/products) → sku → current price.
// 2. For every row in threeds_reprice_pending (status='pending'):
//      - price matches (within tolerance) → mark 'applied' (it took; drop from file)
//      - no match but older than staleDays → mark 'expired' (assume it took; drop)
//      - otherwise leave pending (retry — stays in the file next import)
// 3. Rewrite each affected store's SFTP file from the REMAINING pending set, so
//    confirmed/expired rows leave the file and 3D stops re-importing them.
//
// CAVEAT: /v1/products is 3D's MASTER price (one value per product, sometimes a
// non-GBP currency), so it may not equal the per-marketplace UK eBay price the
// SFTP import sets. This runs in "observe + best-effort confirm" mode: it only
// clears rows on a confident price match, otherwise the staleDays valve prevents
// the file from growing forever. Pass {dryRun:true} to inspect without writing.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Client from "npm:ssh2-sftp-client@10.0.3";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = (Deno.env.get("THREE_DS_BASE_URL") ?? "https://api.3dsellers.com").replace(/\/$/, "");
const API_KEY = Deno.env.get("THREEDS_API_KEY") ?? Deno.env.get("THREE_DS_API_KEY");
const TIME_BUDGET_MS = 110_000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function tds(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${API_KEY}` },
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, json: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!API_KEY) return json({ error: "THREEDS_API_KEY not configured" }, 500);

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth: service_role bearer (cron) — mirror ingest-3ds-orders.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authorised = bearer === serviceKey;
  if (!authorised && bearer) {
    try {
      const payload = JSON.parse(atob(bearer.split(".")[1] ?? ""));
      authorised = payload?.role === "service_role";
    } catch { /* ignore */ }
  }
  if (!authorised) return json({ error: "Unauthorized" }, 401);

  let body: { tolerance?: number; staleDays?: number; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const tolerance = typeof body.tolerance === "number" ? body.tolerance : 0.05;
  const staleDays = typeof body.staleDays === "number" ? body.staleDays : 7;
  const dryRun = body.dryRun === true;

  const admin = createClient(url, serviceKey);

  // 1. Catalogue price map (sku → {price, ccy}).
  const priceMap = new Map<string, { price: number; ccy: string | null }>();
  const start = Date.now();
  let page = 1;
  const limit = 200;
  let total = Infinity;
  let pagesRead = 0;
  while ((page - 1) * limit < total && Date.now() - start < TIME_BUDGET_MS) {
    const res = await tds(`/v1/products?page=${page}&limit=${limit}`);
    if (!res.ok) return json({ error: `3D products fetch failed: ${res.status}` }, 502);
    const data: any[] = res.json?.data ?? [];
    total = res.json?.metadata?.total ?? data.length;
    for (const p of data) {
      if (p?.sku != null) priceMap.set(String(p.sku), { price: Number(p?.price?.price), ccy: p?.price?.currency ?? null });
    }
    pagesRead++;
    if (data.length < limit) break;
    page++;
  }

  // 2. Pending rows.
  const { data: pending, error: pendErr } = await admin
    .from("threeds_reprice_pending")
    .select("id, store_id, sku, price, queued_at")
    .eq("status", "pending");
  if (pendErr) return json({ error: `load pending failed: ${pendErr.message}` }, 500);

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const applied: { id: string; verified: number }[] = [];
  const expired: { id: string; verified: number | null }[] = [];
  const observed: any[] = [];
  const affectedStores = new Set<string>();

  for (const row of pending ?? []) {
    const obs = priceMap.get(String(row.sku));
    const ageDays = (nowMs - new Date(row.queued_at).getTime()) / 86_400_000;
    const match = obs && isFinite(obs.price) && Math.abs(obs.price - Number(row.price)) <= tolerance;
    if (match) {
      applied.push({ id: row.id, verified: obs!.price });
      affectedStores.add(row.store_id);
    } else if (ageDays > staleDays) {
      expired.push({ id: row.id, verified: obs?.price ?? null });
      affectedStores.add(row.store_id);
    }
    observed.push({ sku: row.sku, expected: Number(row.price), observed: obs?.price ?? null, ccy: obs?.ccy ?? null });
  }

  if (dryRun) {
    return json({
      ok: true, dryRun: true, pagesRead, catalogue: priceMap.size,
      pending: pending?.length ?? 0, wouldApply: applied.length, wouldExpire: expired.length,
      sample: observed.slice(0, 25),
    });
  }

  // 3a. Flip statuses (per-row to capture verified_price).
  for (const a of applied) {
    await admin.from("threeds_reprice_pending")
      .update({ status: "applied", applied_at: nowIso, verified_price: a.verified })
      .eq("id", a.id);
  }
  for (const e of expired) {
    await admin.from("threeds_reprice_pending")
      .update({ status: "expired", applied_at: nowIso, verified_price: e.verified })
      .eq("id", e.id);
  }

  // 3b. Rewrite the SFTP file for affected stores from remaining pending.
  let filesRewritten = 0;
  const host = Deno.env.get("THREEDS_SFTP_HOST");
  const port = parseInt(Deno.env.get("THREEDS_SFTP_PORT") ?? "22", 10);
  const username = Deno.env.get("THREEDS_SFTP_USER");
  const password = Deno.env.get("THREEDS_SFTP_PASSWORD");
  if (affectedStores.size > 0 && host && username && password) {
    const escape = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (const storeId of affectedStores) {
      const { data: store } = await admin
        .from("threeds_stores").select("sftp_filename, enabled").eq("id", storeId).maybeSingle();
      if (!store?.sftp_filename || !store.enabled) continue;
      const { data: still } = await admin
        .from("threeds_reprice_pending").select("sku, price")
        .eq("store_id", storeId).eq("status", "pending").order("sku");
      const csv = ["SKU,Price", ...(still ?? []).map((r) => `${escape(String(r.sku).trim())},${Number(r.price).toFixed(2)}`)].join("\n") + "\n";
      const sftp = new Client();
      try {
        await sftp.connect({ host, port, username, password, readyTimeout: 20000 });
        await sftp.put(Buffer.from(csv, "utf-8"), store.sftp_filename);
        await sftp.end();
        filesRewritten++;
      } catch (_e) {
        try { await sftp.end(); } catch { /* ignore */ }
      }
    }
  }

  return json({
    ok: true, pagesRead, catalogue: priceMap.size,
    pending: pending?.length ?? 0, applied: applied.length, expired: expired.length,
    filesRewritten,
  });
});
