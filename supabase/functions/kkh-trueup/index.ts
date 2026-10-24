// kkh-trueup v2 (24 Oct 2026). Scheduled daily 10:15 (after the KKH ingest) as the
// standing replacement for the unscheduled scripts/kkh-snapshot-trueup.py. For each OPEN
// KKH feed_write_failed anomaly, read the ACTUAL WH6 qty from Mintsoft, then move it to the
// feed target (0/1) using the correct delta (the hourly feed failed because it tried to
// remove 998/999 from a snapshot-claimed 999 while Mintsoft held fewer → "[MS]Not Enough
// stock"). Also trues up supplier_feed_snapshot to the target so the feed stops re-proposing
// the bad delta, and resolves the anomaly (resolved_by is a uuid column → left null).
// Caps at 50 SKUs/run (aborts + flags above that, as a mass-drift guard). Returns
// before/after per SKU. POST {dryRun:true} to preview.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const WH = 6, LOC = 32947, SUP = "KKH", ACTION_IN = 0, ACTION_OUT = 1;
const env = (k: string) => Deno.env.get(k);
const msHeaders = { "ms-apikey": env("MINTSOFT_API_KEY")!, "Content-Type": "application/json", "Accept": "application/json" };
const resolveSku = (part: string) => `KKH-${String(part).replace(/-/g, "")}`;

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") return new Response("ok");
    const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const live = body?.dryRun !== true;

    const { data: anomalies } = await supabase.from("supplier_feed_anomalies")
      .select("id, sku, mintsoft_product_id, feed_target")
      .eq("supplier", SUP).eq("anomaly_type", "feed_write_failed").neq("status", "resolved").order("sku");
    if (!anomalies?.length) return new Response(JSON.stringify({ ok: true, note: "no open KKH feed_write_failed anomalies", count: 0 }, null, 2), { headers: { "Content-Type": "application/json" } });

    // Safety cap: if an unusually large number of SKUs are failing, something systemic is
    // wrong (whole-feed drift, location mis-setup). Abort and flag rather than mass-moving
    // stock. ok:false makes cron_http_post record body_ok=false so the job doctor flags it.
    const CAP = 50;
    if (anomalies.length > CAP) {
      const out = { ok: false, aborted: true, count: anomalies.length, cap: CAP, note: `>${CAP} open KKH feed_write_failed anomalies — aborting, needs a human (likely whole-feed drift or location mis-setup)` };
      await supabase.from("edge_function_runs").insert({ function_name: "kkh-trueup", started_at: new Date().toISOString(), ended_at: new Date().toISOString(), status: "error", message: out.note, details: out }).then(() => {}, () => {});
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // sku -> part_number map from the snapshot (so we can true up the snapshot row)
    const skuToPart = new Map<string, string>();
    { let from = 0; const P = 1000; for (;;) { const { data } = await supabase.from("supplier_feed_snapshot").select("part_number").eq("supplier", SUP).range(from, from + P - 1); if (!data?.length) break; for (const r of data) skuToPart.set(resolveSku(r.part_number), r.part_number); if (data.length < P) break; from += P; } }

    const results: Array<Record<string, unknown>> = [];
    for (const a of anomalies) {
      const pid = a.mintsoft_product_id as number;
      const target = Number(a.feed_target);
      // read actual Mintsoft inventory for this product
      let wh6Total = 0, locQty: number | null = null;
      try {
        const r = await fetch(`${MINTSOFT_BASE}/api/Product/${pid}/Inventory?breakdown=true`, { headers: msHeaders, signal: AbortSignal.timeout(30_000) });
        const inv = await r.json();
        if (Array.isArray(inv)) {
          for (const row of inv) {
            if (row.WarehouseId === WH) {
              wh6Total += Number(row.StockLevel ?? 0);
              if (row.LocationId === LOC) locQty = (locQty ?? 0) + Number(row.StockLevel ?? 0);
            }
          }
        }
      } catch (e) {
        results.push({ sku: a.sku, pid, error: `inventory read failed: ${String((e as Error)?.message ?? e)}` });
        continue;
      }
      // Prefer the managed location's qty; fall back to the WH6 total.
      const before = locQty ?? wh6Total;
      const delta = target - before;
      const plan = delta === 0 ? "noop (already at target)" : delta < 0 ? `OUT ${-delta}` : `IN ${delta}`;
      let applied = delta === 0, message = delta === 0 ? "already at target" : "";

      if (live && delta !== 0) {
        const action = delta < 0 ? ACTION_OUT : ACTION_IN;
        const item = [{ ProductId: pid, WarehouseId: WH, LocationId: LOC, Quantity: Math.abs(delta), Comment: `KKH true-up 2026-10-24 -> target ${target}` }];
        try {
          const mr = await fetch(`${MINTSOFT_BASE}/api/Warehouse/BulkStockMovement?Action=${action}`, { method: "POST", headers: msHeaders, body: JSON.stringify(item), signal: AbortSignal.timeout(45_000) });
          const arr = await mr.json();
          const r0 = Array.isArray(arr) ? arr[0] : arr;
          applied = !!r0?.Success; message = String(r0?.Message ?? (mr.ok ? "" : `HTTP ${mr.status}`));
        } catch (e) { message = `move failed: ${String((e as Error)?.message ?? e)}`; }
      }

      const after = applied ? target : before;
      if (live && applied) {
        const part = skuToPart.get(a.sku);
        if (part) await supabase.from("supplier_feed_snapshot").upsert({ supplier: SUP, part_number: part, qty: target }, { onConflict: "supplier,part_number" }).then(() => {}, () => {});
        // NB: resolved_by is a uuid column — leave it null; attribution goes in detail.
        await supabase.from("supplier_feed_anomalies").update({ status: "resolved", resolved_at: new Date().toISOString(), detail: `RESOLVED (kkh-trueup): WH6 trued ${before} -> ${target}` }).eq("id", a.id).then(() => {}, () => {});
      }
      results.push({ sku: a.sku, pid, wh6_before: before, wh6_total: wh6Total, target, plan, applied, wh6_after: after, message });
    }

    const summary = { live, count: results.length, applied: results.filter((r) => r.applied).length, failed: results.filter((r) => r.applied === false && !("error" in r)).length, results };
    await supabase.from("agent_runs").insert({ run_type: "kkh-trueup", status: "complete", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), summary }).then(() => {}, () => {});
    return new Response(JSON.stringify(summary, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
