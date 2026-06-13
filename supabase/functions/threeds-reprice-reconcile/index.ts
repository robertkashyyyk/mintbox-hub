// threeds-reprice-reconcile
// Clears the 3D repricer pending queue once a price has been through the daily 3D
// import, so items don't sit "queued" forever and the file stops re-importing them.
//
// Simple + self-healing (Robert's model): once a queued price has passed its
// go-live (~21:00 UTC, after the evening 3D imports), mark it 'applied' and drop
// it from the SFTP file. We don't try to prove each one "took" — if a price didn't
// take, the item keeps selling at its bad price, stays loss-making, and the daily
// Auto-Report simply re-catches and re-pushes it. The loss-maker pipeline IS the
// retry mechanism.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Client from "npm:ssh2-sftp-client@10.0.3";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// A queued price is live once it's past ~21:00 UTC on/after the day it was queued.
function goLive(queuedIso: string): number {
  const q = new Date(queuedIso); const g = new Date(q);
  g.setUTCHours(21, 0, 0, 0);
  if (q.getTime() >= g.getTime()) g.setUTCDate(g.getUTCDate() + 1);
  return g.getTime();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!; const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let ok = bearer === serviceKey;
  if (!ok && bearer) { try { ok = JSON.parse(atob(bearer.split(".")[1] ?? ""))?.role === "service_role"; } catch { /* ignore */ } }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: { dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const dryRun = body.dryRun === true;

  const admin = createClient(url, serviceKey);
  const { data: stores } = await admin.from("threeds_stores").select("id, sftp_filename, enabled");

  const { data: pending, error } = await admin
    .from("threeds_reprice_pending").select("id, store_id, queued_at").eq("status", "pending");
  if (error) return json({ error: `load pending failed: ${error.message}` }, 500);
  if (!pending || pending.length === 0) return json({ ok: true, pending: 0, applied: 0 });

  const nowMs = Date.now();
  const nowIso = new Date().toISOString();
  const toApply: string[] = []; const affected = new Set<string>();
  for (const r of pending) {
    if (nowMs >= goLive(r.queued_at)) { toApply.push(r.id); affected.add(r.store_id); }
  }

  if (dryRun) return json({ ok: true, dryRun: true, pending: pending.length, wouldApply: toApply.length, stillTooRecent: pending.length - toApply.length });

  for (let i = 0; i < toApply.length; i += 200) {
    await admin.from("threeds_reprice_pending").update({ status: "applied", applied_at: nowIso }).in("id", toApply.slice(i, i + 200));
  }

  // Rewrite each affected store's SFTP file to whatever's still pending.
  let filesRewritten = 0;
  const host = Deno.env.get("THREEDS_SFTP_HOST");
  const port = parseInt(Deno.env.get("THREEDS_SFTP_PORT") ?? "22", 10);
  const username = Deno.env.get("THREEDS_SFTP_USER");
  const password = Deno.env.get("THREEDS_SFTP_PASSWORD");
  if (affected.size > 0 && host && username && password) {
    const escape = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    for (const storeId of affected) {
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

  return json({ ok: true, pending: pending.length, applied: toApply.length, still_pending: pending.length - toApply.length, filesRewritten });
});
