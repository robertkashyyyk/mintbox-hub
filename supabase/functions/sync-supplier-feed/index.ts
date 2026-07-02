// sync-supplier-feed — nightly Supplier Stock Feed equaliser (cloud port of the
// proven local partsdoc-purchasing/scripts/sync-supplier-feed.ts).
//
// Per enabled supplier in supplier_feeds: SFTP-pull the feed, DIFF against the last
// snapshot (only act on SKUs whose feed qty changed — keeps each run well inside the
// 60s edge limit; there's no bulk WH6 read), resolve the Hub SKU (NGK algorithmic /
// FG7 mapping table), read the Remote-Warehouse (WH6) level, and equalise via a
// StockMovement (Action 0 StockIn / 1 StockOut, Quantity, at Primary 32947).
//
// SAFETY: dry-run unless app_settings.ordering.supplier_feed_live = true (logs the
// plan, writes nothing). Per-run write cap (ordering.supplier_feed_max_writes_per_run).
// Failures (phantom OnHand / infinite stock / unmatched / unmapped) are upserted into
// supplier_feed_anomalies for the Hub "Supplier Feeds" page. Snapshot only advances
// for handled SKUs (and never in dry-run), so unfinished work retries next run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import SftpClient from "npm:ssh2-sftp-client@10.0.3";

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const WH = 6;                 // Remote Warehouse (feeds-only)
const PRIMARY_LOCATION = 32947;
const ACTION_IN = 0, ACTION_OUT = 1;

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
      // dedupe by code: prefer branded; else max
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
async function wh6Level(sku: string): Promise<{ productId: number; level: number; sellable: number } | null> {
  return await withRetry(async () => {
    const r = await fetch(`${MINTSOFT_BASE}/api/Product/StockLevels?WarehouseId=${WH}&SKU=${encodeURIComponent(sku)}&Breakdown=true`, { headers: msHeaders, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`StockLevels ${sku} ${r.status}`);
    const d = await r.json(); const row = d[0];
    return row ? { productId: row.ProductId, level: row.Level ?? 0, sellable: row.TotalStockLevel ?? 0 } : null;
  });
}
async function move(productId: number, delta: number): Promise<{ ok: boolean; msg: string }> {
  const action = delta > 0 ? ACTION_IN : ACTION_OUT;
  const r = await fetch(`${MINTSOFT_BASE}/api/Warehouse/StockMovement?Action=${action}`, {
    method: "POST", headers: msHeaders,
    body: JSON.stringify({ ProductId: productId, WarehouseId: WH, LocationId: PRIMARY_LOCATION, Action: action, Quantity: Math.abs(delta), Comment: "supplier feed equalise (auto)" }),
    signal: AbortSignal.timeout(25_000),
  });
  const b = await r.json().catch(() => ({}));
  return (!r.ok || b?.Success === false) ? { ok: false, msg: b?.Message ?? `HTTP ${r.status}` } : { ok: true, msg: "OK" };
}

Deno.serve(async (req) => {
  try {
  if (req.method === "OPTIONS") return new Response("ok");
  const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = new Date();
  const onlySupplier = (await req.json().catch(() => ({})))?.supplier?.toUpperCase?.();

  const setting = async (k: string, dflt: unknown) => {
    const { data } = await supabase.from("app_settings").select("value").eq("key", k).maybeSingle();
    return data ? data.value : dflt;
  };
  const live = (await setting("ordering.supplier_feed_live", false)) === true;
  const maxWrites = Number(await setting("ordering.supplier_feed_max_writes_per_run", 300)) || 300;

  const { data: feeds } = await supabase.from("supplier_feeds")
    .select("supplier, sftp_remote_path, enabled, mapping_kind").eq("enabled", true);
  const results: Record<string, unknown> = {};

  for (const feed of (feeds ?? [])) {
    const SUP = feed.supplier.toUpperCase();
    if (onlySupplier && SUP !== onlySupplier) continue;
    const cfg = CFG[SUP]; if (!cfg) continue;
    const runStart = Date.now();
    let written = 0, failed = 0, noop = 0, skipped = 0, planned = 0;

    try {
      // 1) SFTP pull
      const pass = env(`${SUP}_SFTP_PASS`);
      if (!pass) { results[SUP] = { error: `missing ${SUP}_SFTP_PASS secret` }; continue; }
      const sftp = new SftpClient();
      // Force a Deno-compatible cipher: the edge runtime's ssh2 can't do aes-*-ctr
      // ("Unknown cipher"), but chacha20-poly1305 is pure-JS in ssh2 and the servers
      // offer it. Without this, NGK's 35.198.92.12 negotiates aes128-ctr and fails.
      await sftp.connect({
        host: cfg.sftpHost, port: cfg.sftpPort, username: cfg.sftpUser,
        password: pass.replace(/\r/g, "").trim(),
        algorithms: { cipher: ["aes256-cbc", "aes128-cbc", "aes256-gcm@openssh.com"] },
      });
      // Resilient fetch: the SFTP user is often chrooted to its home, so the absolute
      // configured path can be "Permission denied". Try the path, then the basename
      // relative to home, then list-and-match by filename.
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
      const text = new TextDecoder("latin1").decode(buf);
      const feedRows = parseFeed(cfg, text);

      // 2) snapshot diff
      const snap = new Map<string, number>();
      { let from = 0; const P = 1000;
        for (;;) { const { data } = await supabase.from("supplier_feed_snapshot").select("part_number, qty").eq("supplier", SUP).range(from, from + P - 1);
          if (!data?.length) break; for (const r of data) snap.set(r.part_number, r.qty); if (data.length < P) break; from += P; } }
      const changed = feedRows.filter((f) => snap.get(f.part) !== f.qty);

      // 3) FG7 mapping table (only for changed parts)
      let skuMap: Map<string, string> | null = null;
      if (cfg.mapping === "table") {
        skuMap = new Map();
        let from = 0; const P = 1000;
        for (;;) { const { data } = await supabase.from("supplier_feed_mappings").select("part_number, true_sku").eq("supplier", SUP).eq("active", true).range(from, from + P - 1);
          if (!data?.length) break; for (const r of data) skuMap.set(r.part_number, r.true_sku); if (data.length < P) break; from += P; }
      }
      const resolve = (part: string) => cfg.mapping === "algorithmic" ? `${cfg.prefix}${part.padStart(5, "0")}` : (skuMap!.get(part) ?? null);

      // 4) equalise changed (budget + time guard)
      const snapUpdates: { supplier: string; part_number: string; qty: number }[] = [];
      const anomaly = async (sku: string, type: string, detail: string, extra: Record<string, unknown> = {}) => {
        const { data: ex } = await supabase.from("supplier_feed_anomalies").select("id, seen_count").eq("supplier", SUP).eq("sku", sku).eq("anomaly_type", type).neq("status", "resolved").maybeSingle();
        const common = { detail, last_seen_run_at: new Date().toISOString(), ...extra };
        if (ex) await supabase.from("supplier_feed_anomalies").update({ ...common, seen_count: (ex.seen_count ?? 1) + 1 }).eq("id", ex.id);
        else await supabase.from("supplier_feed_anomalies").insert({ supplier: SUP, sku, anomaly_type: type, status: "open", ...common });
      };

      // Process changed SKUs in CONCURRENT chunks — the per-SKU WH6 read is the
      // bottleneck (slow from the edge IP), so parallelism is essential to fit 60s.
      const CONC = 12;
      for (let i = 0; i < changed.length; i += CONC) {
        if (Date.now() - runStart > 48_000) break;             // headroom under 60s
        if (live && written >= maxWrites) break;
        const chunk = changed.slice(i, i + CONC);
        await Promise.all(chunk.map(async (f) => {
          const sku = resolve(f.part);
          if (!sku) { skipped++; await anomaly(`${SUP}:${f.part}`, "unmapped", `Feed part ${f.part} has no mapping`, { feed_target: f.qty }); snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.qty }); return; }
          let lv; try { lv = await wh6Level(sku); } catch { return; }   // read failed → leave for next run
          if (!lv) { skipped++; await anomaly(sku, "unmatched", `Mapped SKU not in Mintsoft WH${WH}`, { feed_target: f.qty }); snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.qty }); return; }
          const target = (cfg.riskFloor && f.qty > 0 && f.qty < cfg.riskFloor) ? 0 : f.qty;
          const delta = target - lv.level;
          if (delta === 0) { noop++; snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.qty }); return; }
          if (!live) { planned++; return; }                     // dry-run: don't write/advance
          const w = await move(lv.productId, delta);
          if (w.ok) { written++; snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.qty }); }
          else {
            failed++;
            const gap = lv.level - lv.sellable;
            const type = /infinite stock/i.test(w.msg) ? "infinite_stock" : (/not enough stock available to remove|Available:/i.test(w.msg) ? "phantom_onhand" : "other");
            await anomaly(sku, type, w.msg, { onhand: lv.level, sellable: lv.sellable, gap, feed_target: target });
          }
        }));
      }
      if (snapUpdates.length) await supabase.from("supplier_feed_snapshot").upsert(snapUpdates, { onConflict: "supplier,part_number" });

      const summary = { supplier: SUP, live, feed_rows: feedRows.length, changed: changed.length, written, failed, noop, skipped, planned, remaining: changed.length - (written + failed + noop + skipped + planned) };
      results[SUP] = summary;
      await supabase.from("agent_runs").insert({ run_type: `supplier-feed-${SUP.toLowerCase()}-cron`, status: failed > 0 ? "error" : "complete", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary });
      if (live) await supabase.from("supplier_feeds").update({ last_run_at: new Date().toISOString(), last_run_summary: summary }).eq("supplier", feed.supplier);
    } catch (e) {
      results[SUP] = { error: String((e as Error)?.message ?? e) };
      await supabase.from("agent_runs").insert({ run_type: `supplier-feed-${SUP.toLowerCase()}-cron`, status: "error", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary: results[SUP] });
    }
  }

  try { await supabase.from("edge_function_runs").insert({ function_name: "sync-supplier-feed", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "ok", message: live ? "live" : "dry-run", details: results }); } catch (_) { /* logging table optional */ }
  return new Response(JSON.stringify({ live, results }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e), stack: (e as Error)?.stack?.slice(0, 800) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
