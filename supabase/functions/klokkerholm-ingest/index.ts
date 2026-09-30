// klokkerholm-ingest — pulls the Klokkerholm "Stock availability report" from the
// sourcing@ mailbox (Gmail API, OAuth refresh token), and equalises Remote-Warehouse
// (WH6) stock to it. Replaces the manual sheet+upload flow. Cloud port of the proven
// local klokkerholm-*.py chain.
//
// FLOW: OAuth (refresh→access) → list new messages from noreply@klokkerholm.com,
// dedupe by Gmail message-ID → download Stock.xlsx → parse (Partnumber / Stock
// Availability) → target (IN STOCK 999 / OUT 0 / CRITICAL 1) → resolve SKU (KKH- +
// digits) → GATE (intersection ∩ live WH6 via products_cache; do-not-sell force-0) →
// DIFF vs snapshot (only act on changed feed state) → StockMovement @ KKH location
// (32947), behind a per-run write cap → advance snapshot, mark message processed.
//
// SAFETY: dry-run unless app_settings.ordering.klokkerholm_live = true (logs the plan,
// writes nothing, does NOT mark the message processed or advance snapshot — so flipping
// live re-processes it for real). Per-run write cap halts a runaway feed. First run with
// an empty snapshot SEEDS the baseline (no Mintsoft writes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "npm:xlsx@0.18.5";

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const WH = 6;
const ACTION_IN = 0, ACTION_OUT = 1;
const SUP = "KKH";
const GMAIL_QUERY = 'from:noreply@klokkerholm.com subject:"Stock availability report" has:attachment newer_than:21d';

const env = (k: string) => Deno.env.get(k);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const msHeaders = { "ms-apikey": env("MINTSOFT_API_KEY")!, "Content-Type": "application/json" };

// ---- Gmail (OAuth refresh token → access token → read sourcing@) ----
async function gmailToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GMAIL_OAUTH_CLIENT_ID")!, client_secret: env("GMAIL_OAUTH_CLIENT_SECRET")!,
      refresh_token: env("GMAIL_OAUTH_REFRESH_TOKEN")!, grant_type: "refresh_token",
    }),
  });
  const b = await r.json();
  if (!r.ok || !b.access_token) throw new Error(`OAuth token: ${b.error ?? r.status} ${b.error_description ?? ""}`);
  return b.access_token as string;
}
const gapi = (tok: string, path: string) =>
  fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${tok}` } })
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(`Gmail ${path}: ${j.error?.message ?? r.status}`); return j; });

function findXlsxPart(payload: any): { attachmentId: string; filename: string } | null {
  const walk = (p: any): any => {
    if (!p) return null;
    const fn = (p.filename ?? "") as string;
    if (/\.xlsx$/i.test(fn) && p.body?.attachmentId) return { attachmentId: p.body.attachmentId, filename: fn };
    for (const c of (p.parts ?? [])) { const hit = walk(c); if (hit) return hit; }
    return null;
  };
  return walk(payload);
}
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- feed parse + target ----
function targetForState(state: string): number | null {
  const s = state.trim().toUpperCase();
  if (s === "IN STOCK") return 999;
  if (s === "OUT OF STOCK") return 0;
  if (s === "CRITICAL") return 1;
  return null;                                    // unknown state → ignore row
}
const _norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const _isPartHdr = (h: string) => h === "partnumber" || /^part\s*(number|no|nr|nummer)?$/.test(h);
const _isStockHdr = (h: string) => (h.includes("stock") && (h.includes("avail") || h.includes("status"))) || h === "availability";
function sheetGrids(bytes: Uint8Array): { name: string; rows: unknown[][] }[] {
  const wb = XLSX.read(bytes, { type: "array" });
  return wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: "" }) }));
}
// Robust: scan every sheet, locate the header row (may sit under a title row) by
// finding a part-number column + a stock-availability column with tolerant matching.
function parseXlsx(bytes: Uint8Array): { part: string; target: number }[] {
  for (const { rows } of sheetGrids(bytes)) {
    for (let r = 0; r < Math.min(rows.length, 20); r++) {
      const cells = (rows[r] ?? []).map(_norm);
      const pIdx = cells.findIndex(_isPartHdr);
      const sIdx = cells.findIndex(_isStockHdr);
      if (pIdx >= 0 && sIdx >= 0) {
        const out: { part: string; target: number }[] = [];
        for (let i = r + 1; i < rows.length; i++) {
          const part = String((rows[i] ?? [])[pIdx] ?? "").trim();
          const t = targetForState(String((rows[i] ?? [])[sIdx] ?? ""));
          if (part && t !== null) out.push({ part, target: t });
        }
        return out;
      }
    }
  }
  return [];
}
const resolveSku = (part: string) => `KKH-${part.replace(/-/g, "")}`;

// ---- Mintsoft ----
async function withRetry<T>(fn: () => Promise<T>, n = 4): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= n; i++) { try { return await fn(); } catch (e) { last = e; if (i < n) await sleep(1200 * i); } }
  throw last;
}
async function wh6Level(sku: string): Promise<{ productId: number; level: number } | null> {
  return await withRetry(async () => {
    const r = await fetch(`${MINTSOFT_BASE}/api/Product/StockLevels?WarehouseId=${WH}&SKU=${encodeURIComponent(sku)}`, { headers: msHeaders, signal: AbortSignal.timeout(25_000) });
    if (!r.ok) throw new Error(`StockLevels ${sku} ${r.status}`);
    const d = await r.json(); const row = d[0];
    return row ? { productId: row.ProductId, level: row.Level ?? 0 } : null;
  });
}
async function move(productId: number, delta: number, locationId: number): Promise<{ ok: boolean; msg: string }> {
  const action = delta > 0 ? ACTION_IN : ACTION_OUT;
  const r = await fetch(`${MINTSOFT_BASE}/api/Warehouse/StockMovement?Action=${action}`, {
    method: "POST", headers: msHeaders,
    body: JSON.stringify({ ProductId: productId, WarehouseId: WH, LocationId: locationId, Action: action, Quantity: Math.abs(delta), Comment: `Klokkerholm Stock Feed & ${new Date().toISOString().slice(0, 10)}` }),
    signal: AbortSignal.timeout(25_000),
  });
  const b = await r.json().catch(() => ({}));
  return (!r.ok || b?.Success === false) ? { ok: false, msg: b?.Message ?? `HTTP ${r.status}` } : { ok: true, msg: "OK" };
}

Deno.serve(async (req) => {
  const startedAt = new Date();
  try {
    if (req.method === "OPTIONS") return new Response("ok");
    let body: any = {};
    try { body = await req.json(); } catch { /* no body — scheduled fire */ }
    const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
    const setting = async (k: string, dflt: unknown) => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", k).maybeSingle();
      return data ? data.value : dflt;
    };
    const live = (await setting("ordering.klokkerholm_live", false)) === true;
    const maxWrites = Number(await setting("ordering.klokkerholm_max_writes_per_run", 600)) || 600;

    const { data: feed } = await supabase.from("supplier_feeds").select("location_id, enabled").eq("supplier", SUP).maybeSingle();
    const locationId = feed?.location_id ?? 32947;

    // 1) newest unprocessed Klokkerholm message in sourcing@
    const tok = await gmailToken();
    const list = await gapi(tok, `messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=10`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    if (!ids.length) {
      const out = { ok: true, note: "no Klokkerholm messages in sourcing@ (query matched nothing)", live };
      await supabase.from("edge_function_runs").insert({ function_name: "klokkerholm-ingest", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "ok", message: "no-mail", details: out }).then(() => {}, () => {});
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
    }
    const { data: done } = await supabase.from("supplier_feed_processed_messages").select("message_id").eq("supplier", SUP).in("message_id", ids);
    const doneSet = new Set((done ?? []).map((d) => d.message_id));
    const msgId = ids.find((id) => !doneSet.has(id));   // ids come newest-first
    if (!msgId) {
      const out = { ok: true, note: "latest Klokkerholm feed already processed", live, newest: ids[0] };
      await supabase.from("edge_function_runs").insert({ function_name: "klokkerholm-ingest", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "ok", message: "already-processed", details: out }).then(() => {}, () => {});
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // 2) download + parse Stock.xlsx
    const msg = await gapi(tok, `messages/${msgId}?format=full`);
    const part = findXlsxPart(msg.payload);
    if (!part) throw new Error(`message ${msgId} has no .xlsx attachment`);
    const att = await gapi(tok, `messages/${msgId}/attachments/${part.attachmentId}`);
    if (body?.debug) {
      const grids = sheetGrids(b64urlToBytes(att.data));
      return new Response(JSON.stringify({ debug: true, filename: part.filename,
        sheets: grids.map((g) => ({ name: g.name, rowCount: g.rows.length, first6: g.rows.slice(0, 6) })) }, null, 2),
        { headers: { "Content-Type": "application/json" } });
    }
    const feedRows = parseXlsx(b64urlToBytes(att.data));
    if (feedRows.length < 1000) throw new Error(`parsed only ${feedRows.length} rows from ${part.filename} — suspicious, aborting`);

    // 3) snapshot diff (act only on changed feed state)
    const snap = new Map<string, number>();
    { let from = 0; const P = 1000;
      for (;;) { const { data } = await supabase.from("supplier_feed_snapshot").select("part_number, qty").eq("supplier", SUP).range(from, from + P - 1);
        if (!data?.length) break; for (const r of data) snap.set(r.part_number, r.qty); if (data.length < P) break; from += P; } }

    // FIRST-RUN SEED: empty snapshot → record baseline, write nothing to Mintsoft.
    if (snap.size === 0) {
      const seed = feedRows.map((f) => ({ supplier: SUP, part_number: f.part, qty: f.target }));
      for (let i = 0; i < seed.length; i += 1000) await supabase.from("supplier_feed_snapshot").upsert(seed.slice(i, i + 1000), { onConflict: "supplier,part_number" });
      await supabase.from("supplier_feed_processed_messages").insert({ supplier: SUP, message_id: msgId, summary: { seeded: seed.length } });
      const out = { ok: true, seeded: seed.length, note: "baseline snapshot seeded (no writes)", msgId };
      await supabase.from("edge_function_runs").insert({ function_name: "klokkerholm-ingest", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "ok", message: "seeded", details: out }).then(() => {}, () => {});
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    // 4) gate sets: in-scope (∩ live WH6 via products_cache) + do-not-sell
    const inScope = new Set<string>();
    { let from = 0; const P = 1000;
      for (;;) { const { data } = await supabase.from("products_cache").select("sku").ilike("sku", "KKH-%").not("mintsoft_product_id", "is", null).range(from, from + P - 1);
        if (!data?.length) break; for (const r of data) inScope.add(r.sku); if (data.length < P) break; from += P; } }
    const dns = new Set<string>();
    { const { data } = await supabase.from("v_supplier_do_not_sell").select("sku").eq("supplier", SUP);
      for (const r of (data ?? [])) dns.add(r.sku); }

    // changed = feed state differs from snapshot
    const changed = feedRows.filter((f) => snap.get(f.part) !== f.target);
    const snapUpdates: { supplier: string; part_number: string; qty: number }[] = [];
    const inScopeChanged = changed.filter((f) => inScope.has(resolveSku(f.part)));
    const offScopeChanged = changed.filter((f) => !inScope.has(resolveSku(f.part)));
    // off-scope changed never touch Mintsoft — just advance their snapshot
    for (const f of offScopeChanged) snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.target });

    // write-cap guard (count in-scope changed that would actually move)
    if (inScopeChanged.length > maxWrites) {
      const out = { ok: false, cap_tripped: true, in_scope_changed: inScopeChanged.length, cap: maxWrites, note: "proposed writes exceed cap — halted, nothing applied", msgId };
      await supabase.from("edge_function_runs").insert({ function_name: "klokkerholm-ingest", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "error", message: "cap-tripped", details: out }).then(() => {}, () => {});
      return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 5) equalise in-scope changed (dry-run unless live), budgeted + concurrent
    let written = 0, failed = 0, noop = 0, skipped = 0, planned = 0;
    const plan: any[] = [];
    const runStart = Date.now();
    const CONC = 10;
    let stoppedEarly = false;
    for (let i = 0; i < inScopeChanged.length; i += CONC) {
      if (Date.now() - runStart > 45_000) { stoppedEarly = true; break; }
      const chunk = inScopeChanged.slice(i, i + CONC);
      await Promise.all(chunk.map(async (f) => {
        const sku = resolveSku(f.part);
        let lv; try { lv = await wh6Level(sku); } catch { return; }   // read failed → retry next run
        if (!lv) { skipped++; snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.target }); return; } // no WH6 record → hold, advance snap
        const target = dns.has(sku) ? 0 : f.target;                  // do-not-sell force 0
        const delta = target - lv.level;
        if (delta === 0) { noop++; snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.target }); return; }
        if (!live) { planned++; if (plan.length < 50) plan.push({ sku, old: lv.level, new: target, delta }); return; }
        const w = await move(lv.productId, delta, locationId);
        if (w.ok) { written++; snapUpdates.push({ supplier: SUP, part_number: f.part, qty: f.target }); }
        else { failed++; }
      }));
    }

    // 6) persist — snapshot always advances for handled; message marked processed only
    // on a COMPLETE live run (partial/dry-run leaves it for a re-run).
    if (live && snapUpdates.length) for (let i = 0; i < snapUpdates.length; i += 1000) await supabase.from("supplier_feed_snapshot").upsert(snapUpdates.slice(i, i + 1000), { onConflict: "supplier,part_number" });
    const complete = live && !stoppedEarly;
    if (complete) await supabase.from("supplier_feed_processed_messages").upsert({ supplier: SUP, message_id: msgId, summary: { written, failed, noop, skipped } }, { onConflict: "supplier,message_id" });

    const summary = { supplier: SUP, live, msgId, feed_rows: feedRows.length, changed: changed.length,
      in_scope_changed: inScopeChanged.length, off_scope_changed: offScopeChanged.length,
      written, failed, noop, skipped, planned, stoppedEarly, complete, sample_plan: plan };
    await supabase.from("agent_runs").insert({ run_type: "klokkerholm-ingest-cron", status: failed > 0 ? "error" : "complete", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary }).then(() => {}, () => {});
    if (live) await supabase.from("supplier_feeds").update({ last_run_at: new Date().toISOString(), last_run_summary: summary }).eq("supplier", SUP).then(() => {}, () => {});
    await supabase.from("edge_function_runs").insert({ function_name: "klokkerholm-ingest", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: "ok", message: live ? "live" : "dry-run", details: summary }).then(() => {}, () => {});
    return new Response(JSON.stringify(summary, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const err = { error: String((e as Error)?.message ?? e), stack: (e as Error)?.stack?.slice(0, 600) };
    return new Response(JSON.stringify(err, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
