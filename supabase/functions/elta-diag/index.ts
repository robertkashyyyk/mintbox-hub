// elta-diag v1 (2026-10-21) — READ-ONLY. Confirms the raw ELTA availability feed
// before we build elta-ingest. Reuses the sourcing@ Gmail OAuth (same secrets as
// klokkerholm-ingest), finds the latest ELTA stock email, and reports sender /
// subject / attachment type + a header-row sample and availability-state counts.
//
// WRITES NOTHING: no Mintsoft calls, no DB inserts, no snapshot/processed-message
// updates. Pure read of Gmail. Safe to invoke repeatedly.
import * as XLSX from "npm:xlsx@0.18.5";

const env = (k: string) => Deno.env.get(k);

// Primary + fallback queries — the feed is expected from stuart.poole@elta.co.uk
// ("ELTA Stock for Parts Doc") in the sourcing@ mailbox, but we cast a little wider
// in case the sender address or subject has drifted.
const QUERIES: Array<{ label: string; q: string }> = [
  { label: "sender", q: 'from:stuart.poole@elta.co.uk in:anywhere newer_than:150d' },
  { label: "elta-domain", q: 'from:elta.co.uk has:attachment in:anywhere newer_than:150d' },
  { label: "subject", q: 'subject:ELTA has:attachment in:anywhere newer_than:150d' },
];

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

const hdr = (headers: any[], name: string) => (headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;

// Walk a Gmail payload and list every attachment part (filename + mimeType + id + size).
function listAttachments(payload: any): Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> {
  const out: Array<{ filename: string; mimeType: string; attachmentId: string; size: number }> = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.filename && p.body?.attachmentId) out.push({ filename: p.filename, mimeType: p.mimeType ?? "", attachmentId: p.body.attachmentId, size: p.body.size ?? 0 });
    for (const c of (p.parts ?? [])) walk(c);
  };
  walk(payload);
  return out;
}
function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Inspect an xlsx: sheet names, first 15 rows as arrays (so we can eyeball the header),
// total rows, and — if a Partnumber/Stock-Availability style header is found — a
// count of distinct availability states and a few sample data rows.
function inspectXlsx(bytes: Uint8Array) {
  const wb = XLSX.read(bytes, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
  const first15 = aoa.slice(0, 15).map((r) => (r as unknown[]).map((c) => String(c)));
  // try to locate a header row
  let hIdx = -1, partCol = -1, stateCol = -1;
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const row = (aoa[i] ?? []).map((c) => String(c).trim().toLowerCase());
    const pc = row.findIndex((c) => c === "partnumber" || c === "part number" || c === "part no" || c === "sku" || c === "code");
    const sc = row.findIndex((c) => c.includes("stock") || c.includes("availab") || c.includes("qty") || c.includes("quantity"));
    if (pc >= 0 && sc >= 0) { hIdx = i; partCol = pc; stateCol = sc; break; }
  }
  const stateCounts: Record<string, number> = {}; const sampleRows: unknown[][] = [];
  let dataRows = 0;
  if (hIdx >= 0) {
    for (let i = hIdx + 1; i < aoa.length; i++) {
      const part = String((aoa[i] ?? [])[partCol] ?? "").trim(); if (!part) continue;
      dataRows++;
      const raw = String((aoa[i] ?? [])[stateCol] ?? "").trim();
      stateCounts[raw] = (stateCounts[raw] ?? 0) + 1;
      if (sampleRows.length < 8) sampleRows.push(aoa[i] as unknown[]);
    }
  }
  return {
    sheetNames: wb.SheetNames, totalRows: aoa.length, first15Rows: first15,
    detectedHeaderRow: hIdx, partColumn: partCol, stateColumn: stateCol,
    dataRowCount: dataRows, distinctStates: Object.keys(stateCounts).length,
    stateCounts, sampleDataRows: sampleRows.map((r) => (r as unknown[]).map((c) => String(c))),
  };
}
function inspectCsv(bytes: Uint8Array) {
  const text = new TextDecoder("utf-8").decode(bytes);
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = (lines[0] ?? "").split(",").map((c) => c.trim());
  // tally distinct values of the 2nd column across all data rows, plus sample codes per value
  const valueCounts: Record<string, number> = {}; const sampleCodesByValue: Record<string, string[]> = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const code = (cols[0] ?? "").trim(); const val = (cols[1] ?? "").trim();
    valueCounts[val] = (valueCounts[val] ?? 0) + 1;
    (sampleCodesByValue[val] ??= []).length < 5 && sampleCodesByValue[val].push(code);
  }
  return { totalLines: lines.length, header, dataRows: lines.length - 1, first20Lines: lines.slice(0, 20), valueCounts, sampleCodesByValue };
}

Deno.serve(async (_req) => {
  try {
    const tok = await gmailToken();
    const perQuery: Array<Record<string, unknown>> = [];
    let chosen: { msgId: string; from: string; subject: string; date: string } | null = null;

    for (const { label, q } of QUERIES) {
      const list = await gapi(tok, `messages?q=${encodeURIComponent(q)}&maxResults=10`);
      const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
      const found: Array<Record<string, unknown>> = [];
      for (const id of ids.slice(0, 5)) {
        const meta = await gapi(tok, `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        const h = meta.payload?.headers ?? [];
        const rec = { id, from: hdr(h, "From"), subject: hdr(h, "Subject"), date: hdr(h, "Date") };
        found.push(rec);
        if (!chosen) chosen = { msgId: id, from: rec.from ?? "", subject: rec.subject ?? "", date: rec.date ?? "" };
      }
      perQuery.push({ query: label, raw: q, resultCount: ids.length, newest: found });
    }

    let attachmentReport: Record<string, unknown> = { note: "no ELTA message found by any query" };
    if (chosen) {
      const full = await gapi(tok, `messages/${chosen.msgId}?format=full`);
      const atts = listAttachments(full.payload);
      const bodySnippet = (full.snippet ?? "").slice(0, 300);
      let inspected: Record<string, unknown> | null = null;
      // pick the first spreadsheet-ish attachment
      const target = atts.find((a) => /\.(xlsx|xls|csv)$/i.test(a.filename)) ?? atts[0];
      if (target) {
        const att = await gapi(tok, `messages/${chosen.msgId}/attachments/${target.attachmentId}`);
        const bytes = b64urlToBytes(att.data);
        if (/\.(xlsx|xls)$/i.test(target.filename) || target.mimeType.includes("spreadsheet") || target.mimeType.includes("excel")) {
          inspected = { kind: "xlsx", filename: target.filename, mimeType: target.mimeType, ...inspectXlsx(bytes) };
        } else if (/\.csv$/i.test(target.filename) || target.mimeType.includes("csv") || target.mimeType.includes("text")) {
          inspected = { kind: "csv", filename: target.filename, mimeType: target.mimeType, ...inspectCsv(bytes) };
        } else {
          inspected = { kind: "unknown", filename: target.filename, mimeType: target.mimeType, byteLength: bytes.length };
        }
      }
      attachmentReport = { chosen, attachmentCount: atts.length, attachments: atts.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })), bodySnippet, inspected };
    }

    return new Response(JSON.stringify({ ok: true, readOnly: true, perQuery, attachmentReport }, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
