// klokkerholm-ingest v2 (2026-08-25) — READS-FREE. Pulls the "Stock availability report"
// from sourcing@ (Gmail OAuth), and equalises WH6 KKH stock to it.
//
// Fixes over v1: (1) parser finds the header row DYNAMICALLY (Klokkerholm added a title
// row ~Aug, breaking the row-1 assumption → 0 rows parsed); (2) Gmail query uses
// `in:anywhere` so a spam-filtered report is still ingested; (3) READS-FREE engine (WH6
// is feeds-only, so the last value written IS the current level): level+membership from
// the snapshot (trued-up to actual WH6 by scripts/kkh-snapshot-trueup.py), ProductId from
// products_cache, do-not-sell forces target 0, deltas applied via BulkStockMovement.
// Mintsoft's ~2 req/s limit makes per-SKU reads impossible on the edge; bulk writes only.
//
// v3 (2026-10-24): (Fix A) every failed BulkStockMovement item is logged to
// public.supplier_feed_anomalies (open row per supplier+sku+type, seen_count bumped on
// repeat), so the stubborn SKUs are visible with Mintsoft's own Message. (Fix B) the
// message is marked processed when there are NO failures OR every failure is an anomaly
// already logged on a previous run (newFailures === 0) — so a report whose only failures
// are known, un-fixable SKUs stops being re-processed hourly.
//
// SAFETY: dry-run unless app_settings.ordering.klokkerholm_live=true; POST {dryRun:true}
// forces dry-run. Per-run write cap. Message marked processed per the Fix B rule above.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as XLSX from "npm:xlsx@0.18.5";

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const WH = 6, ACTION_IN = 0, ACTION_OUT = 1, SUP = "KKH", WRITE_CHUNK = 200;
const GMAIL_QUERY = 'from:noreply@klokkerholm.com subject:"Stock availability report" has:attachment in:anywhere newer_than:30d';
const env = (k: string) => Deno.env.get(k);
const msHeaders = { "ms-apikey": env("MINTSOFT_API_KEY")!, "Content-Type": "application/json" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gmailToken(): Promise<string> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GMAIL_OAUTH_CLIENT_ID")!, client_secret: env("GMAIL_OAUTH_CLIENT_SECRET")!,
      refresh_token: env("GMAIL_OAUTH_REFRESH_TOKEN")!, grant_type: "refresh_token",
    }),
  });
  const b = await r.json();
  if (!r.ok || !b.access_token) throw new Error(`OAuth: ${b.error ?? r.status} ${b.error_description ?? ""}`);
  return b.access_token as string;
}
const gapi = (tok: string, path: string) =>
  fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${tok}` } })
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(`Gmail ${path}: ${j.error?.message ?? r.status}`); return j; });

function findXlsxPart(payload: any): { attachmentId: string; filename: string } | null {
  const walk = (p: any): any => {
    if (!p) return null;
    if (/\.xlsx$/i.test((p.filename ?? "") as string) && p.body?.attachmentId) return { attachmentId: p.body.attachmentId, filename: p.filename };
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
function targetForState(state: string): number | null {
  const s = state.trim().toUpperCase();
  if (s === "IN STOCK") return 999;
  if (s === "OUT OF STOCK") return 0;
  if (s === "CRITICAL") return 1;
  return null;
}
function parseXlsx(bytes: Uint8Array): { rows: { part: string; target: number }[]; totalRows: number; headerRow: number; stateCounts: Record<string, number> } {
  const wb = XLSX.read(bytes, { type: "array" });
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
  let hIdx = -1, partCol = -1, stateCol = -1;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = (aoa[i] ?? []).map((c) => String(c).trim().toLowerCase());
    const pc = row.findIndex((c) => c === "partnumber" || c === "part number");
    const sc = row.findIndex((c) => c === "stock availability");
    if (pc >= 0 && sc >= 0) { hIdx = i; partCol = pc; stateCol = sc; break; }
  }
  const out: { part: string; target: number }[] = []; const stateCounts: Record<string, number> = {};
  if (hIdx >= 0) {
    for (let i = hIdx + 1; i < aoa.length; i++) {
      const part = String((aoa[i] ?? [])[partCol] ?? "").trim(); if (!part) continue;
      const raw = String((aoa[i] ?? [])[stateCol] ?? "").trim().toUpperCase();
      stateCounts[raw] = (stateCounts[raw] ?? 0) + 1;
      const t = targetForState(raw); if (t === null) continue;
      out.push({ part, target: t });
    }
  }
  return { rows: out, totalRows: aoa.length, headerRow: hIdx, stateCounts };
}
const resolveSku = (part: string) => `KKH-${part.replace(/-/g, "")}`;

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
  const log = async (supabase: any, status: string, message: string, details: unknown) =>
    supabase.from("edge_function_runs").insert({ function_name: "klokkerholm-ingest", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status, message, details }).then(() => {}, () => {});
  try {
    if (req.method === "OPTIONS") return new Response("ok");
    const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    // Optional override: process a SPECIFIC message id (used to re-apply a known-good feed). Bypasses
    // the newest-selection and the already-processed skip below.
    const forceMsgId = typeof body?.msgId === "string" && body.msgId.trim() ? body.msgId.trim() : null;
    const live = ((await (async () => { const { data } = await supabase.from("app_settings").select("value").eq("key", "ordering.klokkerholm_live").maybeSingle(); return data?.value; })()) === true) && body?.dryRun !== true;
    const maxWrites = Number(await (async () => { const { data } = await supabase.from("app_settings").select("value").eq("key", "ordering.klokkerholm_max_writes_per_run").maybeSingle(); return data?.value; })()) || 600;
    const { data: feed } = await supabase.from("supplier_feeds").select("location_id").eq("supplier", SUP).maybeSingle();
    const locationId = feed?.location_id ?? 32947;

    const tok = await gmailToken();
    const list = await gapi(tok, `messages?q=${encodeURIComponent(GMAIL_QUERY)}&maxResults=10`);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    if (!ids.length && !forceMsgId) { const out = { ok: true, note: "no Klokkerholm report found (incl spam)", live }; await log(supabase, "ok", "no-mail", out); return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } }); }
    // SELECTION — only ever consider the SINGLE NEWEST matching email (Gmail lists newest-first). If it
    // is already processed, write nothing — never walk BACKWARDS onto an older, still-unprocessed feed
    // (same clone flaw as elta-ingest; fixed 26 Oct). forceMsgId re-applies a specific message.
    const newest = ids[0];
    const msgId = forceMsgId ?? newest;
    if (!forceMsgId) {
      const { data: done } = await supabase.from("supplier_feed_processed_messages").select("message_id").eq("supplier", SUP).eq("message_id", newest);
      if ((done ?? []).length) { const out = { ok: true, skipped: "already processed", live, newest }; await log(supabase, "ok", "already-processed", out); return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } }); }
    }

    const msg = await gapi(tok, `messages/${msgId}?format=full`);
    const part = findXlsxPart(msg.payload);
    if (!part) throw new Error(`message ${msgId} has no .xlsx`);
    const att = await gapi(tok, `messages/${msgId}/attachments/${part.attachmentId}`);
    const parsed = parseXlsx(b64urlToBytes(att.data));
    if (parsed.rows.length < 1000) { const out = { ok: false, error: `parsed only ${parsed.rows.length} rows (headerRow=${parsed.headerRow}) — format issue, aborting`, msgId }; await log(supabase, "error", "parse-fail", out); return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { "Content-Type": "application/json" } }); }

    const snap = new Map<string, number>();
    { let from = 0; const P = 1000; for (;;) { const { data } = await supabase.from("supplier_feed_snapshot").select("part_number, qty").eq("supplier", SUP).range(from, from + P - 1); if (!data?.length) break; for (const r of data) snap.set(r.part_number, r.qty); if (data.length < P) break; from += P; } }
    const dns = new Set<string>();
    { const { data } = await supabase.from("v_supplier_do_not_sell").select("sku").eq("supplier", SUP); for (const r of (data ?? [])) dns.add(r.sku); }
    const wantSkus = [...new Set(parsed.rows.filter((f) => snap.has(f.part)).map((f) => resolveSku(f.part)))];
    const pidMap = new Map<string, number>();
    for (let i = 0; i < wantSkus.length; i += 300) { const { data } = await supabase.from("products_cache").select("sku, mintsoft_product_id").in("sku", wantSkus.slice(i, i + 300)); for (const r of (data ?? [])) if (r.mintsoft_product_id) pidMap.set(r.sku, r.mintsoft_product_id); }

    const meta = new Map<number, { part: string; sku: string; prev: number; target: number }>();
    const stockIns: Array<Record<string, unknown>> = [], stockOuts: Array<Record<string, unknown>> = [];
    const sample: Array<Record<string, unknown>> = [];
    let noop = 0, skipped = 0, dnsForced = 0;
    for (const f of parsed.rows) {
      if (!snap.has(f.part)) { skipped++; continue; }
      const sku = resolveSku(f.part); const pid = pidMap.get(sku);
      if (!pid) { skipped++; continue; }
      const blocked = dns.has(sku); if (blocked) dnsForced++;
      const target = blocked ? 0 : f.target;
      const prev = snap.get(f.part)!; const delta = target - prev;
      if (delta === 0) { noop++; continue; }
      meta.set(pid, { part: f.part, sku, prev, target });
      const item = { ProductId: pid, WarehouseId: WH, LocationId: locationId, Quantity: Math.abs(delta), Comment: `Klokkerholm Stock Feed & ${new Date().toISOString().slice(0, 10)}` };
      if (delta > 0) stockIns.push({ ...item, Action: ACTION_IN }); else stockOuts.push({ ...item, Action: ACTION_OUT });
      if (sample.length < 20) sample.push({ sku, old: prev, new: target, delta, dns: blocked });
    }
    const proposed = stockIns.length + stockOuts.length;

    if (proposed > maxWrites) { const out = { ok: false, cap_tripped: true, proposed, cap: maxWrites, msgId, note: "exceeds cap — nothing applied" }; await log(supabase, "error", "cap-tripped", out); return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } }); }

    if (!live) { const out = { live: false, msgId, feed_date: (msg.payload?.headers ?? []).find((h: any) => h.name === "Date")?.value, feed_rows: parsed.rows.length, header_row: parsed.headerRow, state_counts: parsed.stateCounts, proposed, stock_in: stockIns.length, stock_out: stockOuts.length, noop, skipped, dns_forced: dnsForced, sample }; await log(supabase, "ok", "dry-run", out); return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } }); }

    let written = 0, failed = 0; const advanced: Array<{ supplier: string; part_number: string; qty: number }> = [];
    const failureItems: Array<{ pid: number; sku: string; part: string; prev: number; target: number; action: number; message: string }> = [];
    for (const [act, arr] of [[ACTION_IN, stockIns], [ACTION_OUT, stockOuts]] as Array<[number, Array<Record<string, unknown>>]>) {
      for (let i = 0; i < arr.length; i += WRITE_CHUNK) {
        const chunk = arr.slice(i, i + WRITE_CHUNK);
        let resp: Array<{ ID: number; Success: boolean; Message: string }>;
        try { resp = await bulkMove(act, chunk); } catch { failed += chunk.length; continue; }
        for (const it of resp) {
          const m = meta.get(it.ID);
          if (it.Success) { written++; if (m) advanced.push({ supplier: SUP, part_number: m.part, qty: m.target }); }
          else { failed++; if (m) failureItems.push({ pid: it.ID, sku: m.sku, part: m.part, prev: m.prev, target: m.target, action: act, message: String(it.Message ?? "") }); }
        }
      }
    }
    for (let i = 0; i < advanced.length; i += 1000) await supabase.from("supplier_feed_snapshot").upsert(advanced.slice(i, i + 1000), { onConflict: "supplier,part_number" }).then(() => {}, () => {});

    // Fix A — record each failed write as an OPEN anomaly (update the open row if it
    // exists & bump seen_count, else insert). newFailures counts the ones not previously
    // open, which drives Fix B below.
    let newFailures = 0;
    for (const fi of failureItems) {
      const { data: existing } = await supabase.from("supplier_feed_anomalies")
        .select("id, seen_count").eq("supplier", SUP).eq("sku", fi.sku)
        .eq("anomaly_type", "feed_write_failed").neq("status", "resolved").maybeSingle();
      const detail = `${fi.action === ACTION_IN ? "IN" : "OUT"} target=${fi.target} (was ${fi.prev}): ${fi.message}`;
      if (existing) {
        await supabase.from("supplier_feed_anomalies").update({ seen_count: (Number(existing.seen_count) || 1) + 1, last_seen_run_at: startedAt.toISOString(), mintsoft_product_id: fi.pid, warehouse_id: WH, feed_target: fi.target, attempted_delta: fi.target - fi.prev, detail }).eq("id", existing.id).then(() => {}, () => {});
      } else {
        newFailures++;
        await supabase.from("supplier_feed_anomalies").insert({ supplier: SUP, sku: fi.sku, mintsoft_product_id: fi.pid, warehouse_id: WH, anomaly_type: "feed_write_failed", feed_target: fi.target, attempted_delta: fi.target - fi.prev, detail, status: "open", last_seen_run_at: startedAt.toISOString(), seen_count: 1 }).then(() => {}, () => {});
      }
    }

    // Fix B — done when there are no failures, OR every failure is a previously-logged
    // (known) anomaly. Stops hourly re-processing of a report whose only failures are the
    // known, un-fixable SKUs; the watchdog then sees the feed as applied.
    const complete = failed === 0 || newFailures === 0;
    if (complete) await supabase.from("supplier_feed_processed_messages").upsert({ supplier: SUP, message_id: msgId, summary: { written, failed, noop, skipped, anomalies: failureItems.length } }, { onConflict: "supplier,message_id" }).then(() => {}, () => {});

    const summary = { supplier: SUP, live: true, msgId, feed_rows: parsed.rows.length, proposed, written, failed, new_failures: newFailures, anomalies: failureItems.length, noop, skipped, dns_forced: dnsForced, remaining: proposed - written - failed, complete };
    await supabase.from("agent_runs").insert({ run_type: "klokkerholm-ingest-cron", status: failed > 0 ? "error" : "complete", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), summary }).then(() => {}, () => {});
    await supabase.from("supplier_feeds").update({ last_run_at: new Date().toISOString(), last_run_summary: summary }).eq("supplier", SUP).then(() => {}, () => {});
    await log(supabase, "ok", "live", summary);
    return new Response(JSON.stringify(summary, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const err = { error: String((e as Error)?.message ?? e), stack: (e as Error)?.stack?.slice(0, 600) };
    try { const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!); await log(supabase, "error", "exception", err); } catch (_) { /* ignore */ }
    return new Response(JSON.stringify(err, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
