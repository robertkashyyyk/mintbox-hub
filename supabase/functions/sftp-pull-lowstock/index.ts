// Plain LSA filter rule applied: only persists rows where LSA > 1.
// Writes to existing products_cache.low_stock_alert_level column (the one already
// being kept fresh by Mintsoft API enrichment) so we have one source of truth.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import SftpClient from "npm:ssh2-sftp-client@10.0.3";
import { parse } from "npm:csv-parse@5.5.6/sync";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SFTP_HOST = "138.68.139.54";
const SFTP_PORT = 22;
const SFTP_USER = "mintsoft_export";
const SFTP_DIR = "/home/mintsoft_export";
const FILE_PATTERNS = [
  "product_stocklowstockalertsforftp",
  "pdochubLowStockAlerts",
  "ColeraineLowStockAlerts",
];
const LSA_MIN_THRESHOLD_DEFAULT = 1;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const log = async (status: "ok" | "error" | "warn", message: string, details: Record<string, unknown> = {}) => {
    const endedAt = new Date();
    await supabase.from("edge_function_runs").insert({
      function_name: "sftp-pull-lowstock",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - startedAt.getTime(),
      status, message, details,
    });
  };

  const sftp = new SftpClient();
  let chosenFile: string | null = null;
  try {
    const password = Deno.env.get("MINTSOFT_FTP_PASSWORD");
    if (!password) throw new Error("MINTSOFT_FTP_PASSWORD secret not set");
    await sftp.connect({
      host: SFTP_HOST, port: SFTP_PORT, username: SFTP_USER, password,
      readyTimeout: 20_000,
      algorithms: { serverHostKey: ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"] },
    } as any);

    const list = await sftp.list(SFTP_DIR);
    const candidates = list
      .filter((f) =>
        f.type === "-" &&
        f.name.toLowerCase().endsWith(".csv") &&
        FILE_PATTERNS.some((p) => f.name.toLowerCase().startsWith(p.toLowerCase())))
      .sort((a, b) => b.modifyTime - a.modifyTime);

    if (candidates.length === 0) {
      await log("warn", "No low-stock-alert CSV file found", {
        dir: SFTP_DIR, patterns: FILE_PATTERNS, seen: list.map((f) => f.name),
      });
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "no file" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    chosenFile = candidates[0].name;
    const remotePath = `${SFTP_DIR}/${chosenFile}`;
    const buf = (await sftp.get(remotePath)) as Buffer;
    const text = buf.toString("utf-8");
    const rows: Array<Record<string, string>> = parse(text, {
      columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
    });

    const headers = Object.keys(rows[0] ?? {});
    const findHeader = (...candidates: string[]): string | null => {
      const lower = headers.map((h) => h.toLowerCase());
      for (const c of candidates) {
        const idx = lower.indexOf(c.toLowerCase());
        if (idx !== -1) return headers[idx];
      }
      return null;
    };
    const skuKey = findHeader("SKU", "ClientSKU", "Sku");
    const lsaKey = findHeader("LowStockLevel", "LowStockAlert", "LSA", "ReorderLevel", "Level");
    if (!skuKey || !lsaKey) {
      throw new Error(`Could not find SKU/LSA columns. Headers: ${headers.join(", ")}`);
    }

    const lsaMap = new Map<string, number>();
    let skippedInvalid = 0, skippedBelowThreshold = 0;
    for (const r of rows) {
      const sku = (r[skuKey] ?? "").trim();
      const lsa = Number(r[lsaKey]);
      if (!sku || !Number.isFinite(lsa)) { skippedInvalid++; continue; }
      if (lsa <= LSA_MIN_THRESHOLD) { skippedBelowThreshold++; continue; }
      lsaMap.set(sku, lsa);
    }

    const allSkus = Array.from(lsaMap.keys());
    const existing = new Set<string>();
    const LOOKUP_CHUNK = 1000;
    for (let i = 0; i < allSkus.length; i += LOOKUP_CHUNK) {
      const slice = allSkus.slice(i, i + LOOKUP_CHUNK);
      const { data, error } = await supabase
        .from("products_cache").select("sku").in("sku", slice);
      if (error) throw error;
      for (const r of data || []) existing.add(r.sku);
    }

    const updates = allSkus
      .filter((s) => existing.has(s))
      .map((s) => ({ sku: s, low_stock_alert_level: lsaMap.get(s)! }));

    let updated = 0;
    const UPSERT_BATCH = 500;
    for (let i = 0; i < updates.length; i += UPSERT_BATCH) {
      const batch = updates.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("products_cache").upsert(batch, { onConflict: "sku" });
      if (error) console.error(`[lsa] batch ${i} error:`, error.message);
      else updated += batch.length;
    }

    try { await sftp.delete(remotePath); } catch (_) { /* ignore */ }

    const summary = {
      file: chosenFile, rows_in_csv: rows.length,
      kept_above_threshold: lsaMap.size,
      skipped_below_threshold: skippedBelowThreshold,
      skipped_invalid: skippedInvalid,
      matched_in_cache: existing.size, updated,
    };
    await log("ok", `Synced ${updated} LSA values from ${chosenFile}`, summary);
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sftp-pull-lowstock failed:", msg);
    await log("error", msg, { file: chosenFile });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sftp.end(); } catch (_) { /* ignore */ }
  }
});
