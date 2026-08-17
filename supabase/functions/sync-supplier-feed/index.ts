// sync-supplier-feed — nightly Supplier Stock Feed equaliser (cloud port of the
// proven local partsdoc-purchasing/scripts/sync-supplier-feed.ts).
//
// v3 (2026-07-28) — READS-FREE bulk engine. Mintsoft hard-rate-limits to ~2 req/s per
// API key, so reading WH6 (per-SKU OR the full 238-page bulk) can't fit the 150s edge
// limit — the old per-SKU-read engine only cleared ~12 of ~1,700 changed SKUs/night.
// WH6 is FEEDS-ONLY (nothing else writes it), so the last value we wrote IS the current
// level: the engine reads ZERO from Mintsoft. Level+membership come from the snapshot
// (trued-up to actual WH6 by scripts/ngk-snapshot-trueup.py — presence = in WH6, qty =
// WH6 OnHand); ProductId from products_cache. delta = feed - snapshot, computed in
// memory, applied via BulkStockMovement (Action 0 StockIn / 1 StockOut, Primary 32947).
// Only writes hit Mintsoft (~9 requests), so it clears the whole backlog in one run.
//
// SAFETY: dry-run unless app_settings.ordering.supplier_feed_live=true. POST {dryRun:true}
// forces dry-run without touching the flag. Per-run write CAP halts a runaway feed.
// Snapshot advances (→feed target) ONLY for successfully-written SKUs; failures (phantom /
// infinite-stock) keep their old baseline and retry next run, and are logged as anomalies.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import SftpClient from "npm:ssh2-sftp-client@10.0.3";

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const WH = 6;
const PRIMARY_LOCATION = 32947;
const ACTION_IN = 0, ACTION_OUT = 1;
const WRITE_CHUNK = 200;

type SupCfg = {
  feedFormat: "ngk-semicolon" | "fg7-csv";
  mapping: "algorithmic" | "table";
  prefix?: string;
  sftpHost: string; sftpPort: number; sftpUser: string;
  riskFloor?: number;
};
const CFG: Record<string, SupCfg> = {
  NGK: { feedFormat: "ngk-semicolon", mapping: "algorithmic", prefix: "NGK-",
         sftpHost: "35.198.92.12", sftpPort: 22, sftpUser: "Parts Doc" },
  FG7: { feedFormat: "fg7-csv", mapping: "table",
         sftpHost: "138.68.139.54", sftpPort: 22, sftpUser: "fg7upload", riskFloor: 2 },
};

const env = (k: string) => Deno.env.get(k);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msHeaders = { "ms-apikey": env("MINTSOFT_API_KEY")!, "Content-Type": "application/json" };

function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur); return out;
}

function parseFeed(cfg: SupCfg, text: string): { part: string; qty: number }[] {
  const byPart = new Map<string, number>();
  if (cfg.feedFormat === "ngk-semicolon") {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      const [code, , qtyStr, brand = ""] = line.split(";");
      if (!code || !/^\d+$/.test(code)) continue;
      const qty = parseInt(qtyStr ?? "0", 10); if (!Number.isFinite(qty)) continue;
      if (!byPart.has(code) || brand.trim()) byPart.set(code, Math.max(byPart.get(code) ?? 0, qty));
    }
  } else {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const hdr = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const pi = hdr.indexOf("part number"), qi = hdr.indexOf("free stk");
    for (let i = 1; i < lines.length; i++) {
      const f = splitCsvLine(lines[i]); const part = (f[pi] ?? "").trim();
      if (!part) continue;
      const qty = parseInt((f[qi] ?? "0").trim(), 10); if (!Number.isFinite(qty)) continue;
      byPart.set(part, qty);
    }
  }
  return [...byPart.entries()].map(([part, qty]) => ({ part, qty }));
}

async function withRetry<T>(fn: () => Promise<T>, n = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= n; i++) { try { return await fn(); } catch (e) { last = e; if (i < n) await sleep(1200 * i); } }
  throw last;
}

async function bulkMove(action: number, items: unknown[]): Promise<Array<{ ID: number; Success: boolean; Message: string }>> {
  return await withRetry(async () => {
    const r = await fetch(`${MINTSOFT_BASE}/api/Warehouse/BulkStockMovement?Action=${action}`, {
      method: "POST", headers: msHeaders, body: JSON.stringify(items), signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`BulkStockMovement ${action} HTTP ${r.status}`);
    return await r.json();
  });
}

Deno.serve(async (req) => {
  const startedAt = new Date();
  try {
    if (req.method === "OPTIONS") return new Response("ok");
    const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const onlySupplier = body?.supplier?.toUpperCase?.();
    const bodyDryRun = body?.dryRun === true;

    const setting = async (k: string, dflt: unknown) => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", k).maybeSingle();
      return data ? data.value : dflt;
    };
    const live = ((await setting("ordering.supplier_feed_live", false)) === true) && !bodyDryRun;
    const maxWrites = Number(await setting("ordering.supplier_feed_max_writes_per_run", 300)) || 300;

    const { data: feeds } = await supabase.from("supplier_feeds")
      .select("supplier, sftp_remote_path, enabled, mapping_kind").eq("enabled", true);
    const results: Record<string, unknown> = {};

    for (const feed of (feeds ?? [])) {
      const SUP = feed.supplier.toUpperCase();
      if (onlySupplier && SUP !== onlySupplier) continue;
      const cfg = CFG[SUP]; if (!cfg) continue;
      let written = 0, failed = 0, noop = 0, skipped = 0;

      try {
        // 1) SFTP pull
        const pass = env(`${SUP}_SFTP_PASS`);
        if (!pass) { results[SUP] = { error: `missing ${SUP}_SFTP_PASS secret` }; continue; }
        const sftp = new SftpClient();
        await sftp.connect({
          host: cfg.sftpHost, port: cfg.sftpPort, username: cfg.sftpUser,
          password: pass.replace(/\r/g, "").trim(),
          algorithms: { cipher: ["aes256-cbc", "aes128-cbc", "aes256-gcm@openssh.com"] },
        });
        const rp = feed.sftp_remote_path as string;
        const base = rp.split("/").pop()!;
        let buf: Uint8Array | undefined;
        for (const cand of [rp, base, `/${base}`, `./${base}`]) {
          try { buf = await sftp.get(cand) as Uint8Array; break; } catch { /* try next */ }
        }
        if (!buf) {
          for (const dir of [".", "/", rp.replace(/\/[^/]*$/, "") || "/"]) {
            const list = await sftp.list(dir).catch(() => [] as Array<{ name: string }>);
            const hit = list.find((f) => f.name.toLowerCase() === base.toLowerCase());
            if (hit) { buf = await sftp.get(`${dir.replace(/\/$/, "")}/${hit.name}`) as Uint8Array; break; }
          }
        }
        await sftp.end();
        if (!buf) { results[SUP] = { error: `feed file not found/readable: ${rp}` }; continue; }
        const feedRows = parseFeed(cfg, new TextDecoder("latin1").decode(buf));

        // 2) SKU mapping (NGK algorithmic / FG7 table)
        let skuMap: Map<string, string> | null = null;
        if (cfg.mapping === "table") {
          skuMap = new Map();
          let from = 0; const P = 1000;
          for (;;) { const { data } = await supabase.from("supplier_feed_mappings").select("part_number, true_sku").eq("supplier", SUP).eq("active", true).range(from, from + P - 1);
            if (!data?.length) break; for (const r of data) skuMap.set(r.part_number, r.true_sku); if (data.length < P) break; from += P; }
        }
        const resolve = (part: string) => cfg.mapping === "algorithmic" ? `${cfg.prefix}${part.padStart(5, "0")}` : (skuMap!.get(part) ?? null);

        // 3) snapshot = WH6 baseline (presence = in WH6; qty = current level, feeds-only)
        const snap = new Map<string, number>();
        { let from = 0; const P = 1000;
          for (;;) { const { data } = await supabase.from("supplier_feed_snapshot").select("part_number, qty").eq("supplier", SUP).range(from, from + P - 1);
            if (!data?.length) break; for (const r of data) snap.set(r.part_number, r.qty); if (data.length < P) break; from += P; } }

        // 4) ProductId map from products_cache for the SKUs we may write
        const wantSkus = [...new Set(feedRows.filter((f) => snap.has(f.part)).map((f) => resolve(f.part)).filter(Boolean) as string[])];
        const pidMap = new Map<string, number>();
        for (let i = 0; i < wantSkus.length; i += 300) {
          const { data } = await supabase.from("products_cache").select("sku, mintsoft_product_id").in("sku", wantSkus.slice(i, i + 300));
          for (const r of (data ?? [])) if (r.mintsoft_product_id) pidMap.set(r.sku, r.mintsoft_product_id);
        }

        const anomaly = async (sku: string, type: string, detail: string, extra: Record<string, unknown> = {}) => {
          const { data: ex } = await supabase.from("supplier_feed_anomalies").select("id, seen_count").eq("supplier", SUP).eq("sku", sku).eq("anomaly_type", type).neq("status", "resolved").maybeSingle();
          const common = { detail, last_seen_run_at: new Date().toISOString(), ...extra };
          if (ex) await supabase.from("supplier_feed_anomalies").update({ ...common, seen_count: (ex.seen_count ?? 1) + 1 }).eq("id", ex.id);
          else await supabase.from("supplier_feed_anomalies").insert({ supplier: SUP, sku, anomaly_type: type, status: "open", ...common });
        };

        // 5) compute deltas vs baseline (no Mintsoft reads)
        const meta = new Map<number, { part: string; sku: string; prev: number; target: number }>();
        const stockIns: Array<Record<string, unknown>> = [], stockOuts: Array<Record<string, unknown>> = [];
        const sample: Array<Record<string, unknown>> = [];
        for (const f of feedRows) {
          const sku = resolve(f.part);
          if (!sku) { skipped++; await anomaly(`${SUP}:${f.part}`, "unmapped", `Feed part ${f.part} has no mapping`, { feed_target: f.qty }); continue; }
          if (!snap.has(f.part)) { skipped++; continue; }                 // not in WH6 baseline — not carried, skip (no phantom writes)
          const pid = pidMap.get(sku);
          if (!pid) { skipped++; await anomaly(sku, "unmatched", `No Mintsoft ProductId in products_cache`, { feed_target: f.qty }); continue; }
          const prev = snap.get(f.part)!;
          const target = (cfg.riskFloor && f.qty > 0 && f.qty < cfg.riskFloor) ? 0 : f.qty;
          const delta = target - prev;
          if (delta === 0) { noop++; continue; }
          meta.set(pid, { part: f.part, sku, prev, target });
          const item = { ProductId: pid, WarehouseId: WH, LocationId: PRIMARY_LOCATION, Quantity: Math.abs(delta), Comment: "supplier feed equalise (auto)" };
          if (delta > 0) stockIns.push({ ...item, Action: ACTION_IN }); else stockOuts.push({ ...item, Action: ACTION_OUT });
          if (sample.length < 20) sample.push({ sku, old: prev, new: target, delta });
        }
        const proposed = stockIns.length + stockOuts.length;

        // runaway guard
        if (proposed > maxWrites) {
          results[SUP] = { cap_tripped: true, proposed, cap: maxWrites, noop, skipped, note: "proposed writes exceed cap — nothing applied" };
          await supabase.from("agent_runs").insert({ run_type: `supplier-feed-${SUP.toLowerCase()}-cron`, status: "error", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary: results[SUP] }).then(() => {}, () => {});
          continue;
        }

        // dry-run
        if (!live) {
          results[SUP] = { live: false, feed_rows: feedRows.length, proposed, stock_in: stockIns.length, stock_out: stockOuts.length, noop, skipped, sample };
          continue;
        }

        // live: bulk-write; advance snapshot only for successes
        const advanced: Array<{ supplier: string; part_number: string; qty: number }> = [];
        for (const [act, arr] of [[ACTION_IN, stockIns], [ACTION_OUT, stockOuts]] as Array<[number, Array<Record<string, unknown>>]>) {
          for (let i = 0; i < arr.length; i += WRITE_CHUNK) {
            const chunk = arr.slice(i, i + WRITE_CHUNK);
            let resp: Array<{ ID: number; Success: boolean; Message: string }>;
            try { resp = await bulkMove(act, chunk); } catch { failed += chunk.length; continue; }
            for (const it of resp) {
              const m = meta.get(it.ID);
              if (it.Success) { written++; if (m) advanced.push({ supplier: SUP, part_number: m.part, qty: m.target }); continue; }
              failed++;
              const msg = it.Message ?? "";
              const type = /infinite stock/i.test(msg) ? "infinite_stock" : (/not enough stock|Available:/i.test(msg) ? "phantom_onhand" : "other");
              if (m) await anomaly(m.sku, type, msg, { baseline: m.prev, feed_target: m.target });
            }
          }
        }
        for (let i = 0; i < advanced.length; i += 1000) await supabase.from("supplier_feed_snapshot").upsert(advanced.slice(i, i + 1000), { onConflict: "supplier,part_number" }).then(() => {}, () => {});

        const summary = { supplier: SUP, live: true, feed_rows: feedRows.length, proposed, written, failed, noop, skipped, remaining: proposed - written - failed };
        results[SUP] = summary;
        await supabase.from("agent_runs").insert({ run_type: `supplier-feed-${SUP.toLowerCase()}-cron`, status: failed > 0 ? "error" : "complete", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary }).then(() => {}, () => {});
        await supabase.from("supplier_feeds").update({ last_run_at: new Date().toISOString(), last_run_summary: summary }).eq("supplier", SUP).then(() => {}, () => {});
      } catch (e) {
        results[SUP] = { error: String((e as Error)?.message ?? e) };
        await supabase.from("agent_runs").insert({ run_type: `supplier-feed-${SUP.toLowerCase()}-cron`, status: "error", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary: results[SUP] }).then(() => {}, () => {});
      }
    }

    await supabase.from("edge_function_runs").insert({ function_name: "sync-supplier-feed", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "ok", message: live ? "live" : "dry-run", details: results }).then(() => {}, () => {});
    return new Response(JSON.stringify({ live, results }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e), stack: (e as Error)?.stack?.slice(0, 800) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
