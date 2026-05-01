// Pulls the daily ProductStockLevelExport CSV from Mintsoft FTP and bulk-upserts
// stock figures (current_stock, on_order, back_order_qty) into products_cache.
//
// Triggered manually via "Test Now" button or daily cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const FTP_HOST = "138.68.139.54";
const FTP_PORT = 21;
const FTP_USER = "mintsoft_export";
const FTP_DIR = "pdochub-7";
const FTP_FILE = "ColeraineLIVEStockLevelsforHub15.csv";

// ---------- Minimal FTP client (plain FTP, passive mode) ----------

class FtpClient {
  private conn: Deno.TcpConn | null = null;
  private buf = new Uint8Array(0);

  async connect(host: string, port: number) {
    this.conn = await Deno.connect({ hostname: host, port });
    await this.readResponse(); // 220 banner
  }

  private async readResponse(): Promise<string> {
    const dec = new TextDecoder();
    const chunks: string[] = [];
    while (true) {
      const tmp = new Uint8Array(4096);
      const n = await this.conn!.read(tmp);
      if (n === null) break;
      const part = dec.decode(tmp.subarray(0, n));
      chunks.push(part);
      const all = chunks.join("");
      // FTP response complete when we see a line like "XYZ ...\r\n" (not "XYZ-...")
      const lines = all.split(/\r?\n/);
      for (const line of lines) {
        if (/^\d{3} /.test(line)) {
          return all;
        }
      }
    }
    return chunks.join("");
  }

  private async send(cmd: string): Promise<string> {
    const enc = new TextEncoder();
    await this.conn!.write(enc.encode(cmd + "\r\n"));
    return await this.readResponse();
  }

  async login(user: string, pass: string) {
    const u = await this.send(`USER ${user}`);
    if (!/^3\d\d/.test(u.trim().split(/\r?\n/).find((l) => /^\d{3} /.test(l)) || "")) {
      // 230 means already logged in (no PASS needed); 331 means need PASS
    }
    const p = await this.send(`PASS ${pass}`);
    const code = (p.trim().split(/\r?\n/).find((l) => /^\d{3} /.test(l)) || "").slice(0, 3);
    if (code !== "230") throw new Error(`FTP login failed: ${p}`);
  }

  async setBinary() {
    await this.send("TYPE I");
  }

  async cwd(dir: string) {
    const r = await this.send(`CWD ${dir}`);
    const code = (r.trim().split(/\r?\n/).find((l) => /^\d{3} /.test(l)) || "").slice(0, 3);
    if (!code.startsWith("2")) throw new Error(`CWD failed: ${r}`);
  }

  async retrieve(filename: string): Promise<Uint8Array> {
    // PASV
    const pasvResp = await this.send("PASV");
    const m = pasvResp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!m) throw new Error(`PASV parse failed: ${pasvResp}`);
    const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
    const port = parseInt(m[5]) * 256 + parseInt(m[6]);

    const dataConn = await Deno.connect({ hostname: ip, port });
    // Send RETR (do NOT wait for full response yet; data flows on dataConn)
    const enc = new TextEncoder();
    await this.conn!.write(enc.encode(`RETR ${filename}\r\n`));

    // Read the 150 "opening data connection" line
    await this.readResponse();

    // Read all data
    const chunks: Uint8Array[] = [];
    while (true) {
      const tmp = new Uint8Array(65536);
      const n = await dataConn.read(tmp);
      if (n === null) break;
      chunks.push(tmp.subarray(0, n));
    }
    try { dataConn.close(); } catch { /* ignore */ }

    // Read 226 "transfer complete"
    await this.readResponse();

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  async quit() {
    try { await this.send("QUIT"); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
  }
}

// ---------- CSV parsing ----------

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    if (!line.includes('"')) return line.split(",").map((s) => s.trim());
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { q = !q; continue; }
      if (ch === "," && !q) { out.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function findCol(headers: string[], names: string[]): number {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const n of names) {
    const idx = lower.indexOf(n.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

// ---------- Main handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Log run
  const { data: runRow } = await supabase
    .from("edge_function_runs")
    .insert({
      function_name: "pull-mintsoft-stock-ftp",
      status: "running",
      message: "Connecting to FTP...",
    })
    .select("id")
    .single();
  const runId = runRow?.id;

  const finish = async (status: string, message: string, details?: unknown) => {
    if (runId) {
      await supabase
        .from("edge_function_runs")
        .update({
          status,
          message,
          ended_at: new Date().toISOString(),
          details: details ? (details as Record<string, unknown>) : null,
        })
        .eq("id", runId);
    }
  };

  const ftp = new FtpClient();
  try {
    const password = Deno.env.get("MINTSOFT_FTP_PASSWORD");
    if (!password) throw new Error("MINTSOFT_FTP_PASSWORD secret not set");

    console.log(`Connecting to ftp://${FTP_HOST}:${FTP_PORT} as ${FTP_USER}`);
    await ftp.connect(FTP_HOST, FTP_PORT);
    await ftp.login(FTP_USER, password);
    await ftp.setBinary();
    await ftp.cwd(FTP_DIR);
    console.log(`Retrieving ${FTP_FILE}...`);
    const bytes = await ftp.retrieve(FTP_FILE);
    await ftp.quit();
    console.log(`Downloaded ${bytes.length} bytes`);

    const text = new TextDecoder("utf-8").decode(bytes);
    const { headers, rows } = parseCsv(text);
    console.log(`Headers: ${headers.join(" | ")}`);
    console.log(`Rows: ${rows.length}`);

    const skuIdx = findCol(headers, ["SKU", "ClientSKU", "Sku"]);
    const onHandIdx = findCol(headers, ["OnHand", "On Hand"]);
    const onOrderIdx = findCol(headers, ["OnOrder", "On Order"]);
    const backOrderIdx = findCol(headers, ["BackOrder", "Back Order", "BackOrderQty"]);

    if (skuIdx === -1 || onHandIdx === -1) {
      throw new Error(`Required columns missing. Headers: ${headers.join(",")}`);
    }

    // Aggregate across warehouses (sum per SKU)
    const agg = new Map<string, { on_hand: number; on_order: number; back_order: number }>();
    for (const r of rows) {
      const sku = r[skuIdx]?.trim();
      if (!sku) continue;
      const on_hand = parseFloat(r[onHandIdx]) || 0;
      const on_order = onOrderIdx >= 0 ? parseFloat(r[onOrderIdx]) || 0 : 0;
      const back_order = backOrderIdx >= 0 ? parseFloat(r[backOrderIdx]) || 0 : 0;
      const cur = agg.get(sku);
      if (cur) {
        cur.on_hand += on_hand;
        cur.on_order += on_order;
        cur.back_order += back_order;
      } else {
        agg.set(sku, { on_hand, on_order, back_order });
      }
    }
    console.log(`Unique SKUs: ${agg.size}`);

    // Only update SKUs that already exist in products_cache (don't pollute with unknown SKUs)
    const allSkus = Array.from(agg.keys());
    const existing = new Set<string>();
    const CHUNK = 1000;
    for (let i = 0; i < allSkus.length; i += CHUNK) {
      const slice = allSkus.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("products_cache")
        .select("sku")
        .in("sku", slice);
      if (error) throw error;
      for (const r of data || []) existing.add(r.sku);
    }
    console.log(`Matched ${existing.size}/${allSkus.length} SKUs in products_cache`);

    const now = new Date().toISOString();
    const updates = allSkus
      .filter((s) => existing.has(s))
      .map((s) => {
        const v = agg.get(s)!;
        return {
          sku: s,
          current_stock: v.on_hand,
          on_order: v.on_order,
          back_order_qty: v.back_order,
          last_stock_sync: now,
        };
      });

    let updated = 0;
    const UPSERT_BATCH = 500;
    for (let i = 0; i < updates.length; i += UPSERT_BATCH) {
      const batch = updates.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("products_cache")
        .upsert(batch, { onConflict: "sku" });
      if (error) {
        console.error(`Batch ${i} error:`, error);
      } else {
        updated += batch.length;
      }
    }

    const summary = {
      file_bytes: bytes.length,
      csv_rows: rows.length,
      unique_skus: agg.size,
      matched_in_cache: existing.size,
      updated,
      headers,
      sample_first_5_rows: rows.slice(0, 5),
    };
    console.log("Done:", JSON.stringify(summary, null, 2));
    await finish("success", `Updated ${updated} SKUs from ${rows.length} rows`, summary);

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("FTP pull failed:", msg);
    try { await ftp.quit(); } catch { /* ignore */ }
    await finish("error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
