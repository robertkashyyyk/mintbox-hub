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
// Loose match: any csv whose name contains "lowstock" or "lsa" (case-insensitive)
const LOOSE_MATCH = /(lowstock|lsa)/i;
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
    // Auth: prefer password because this integration is confirmed to work via
    // password-only SFTP in Cyberduck; fall back to SSH key only if password
    // is absent.
    const keyB64 = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY_B64");
    const keyRaw = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY");
    const password = Deno.env.get("MINTSOFT_FTP_PASSWORD")?.replace(/\r/g, "").trim();
    let privateKey: string | null = null;
    if (!password && keyB64) {
      const trimmed = keyB64.trim();
      if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
        privateKey = trimmed; // already PEM
      } else {
        try {
          privateKey = new TextDecoder().decode(Uint8Array.from(atob(trimmed.replace(/\s+/g, "")), c => c.charCodeAt(0)));
        } catch {
          privateKey = trimmed; // not base64, use as-is
        }
      }
    } else if (!password && keyRaw) {
      privateKey = keyRaw;
    }
    if (!privateKey && !password) {
      throw new Error("No SFTP credential set (MINTSOFT_FTP_PRIVATE_KEY_B64 / _KEY / _PASSWORD)");
    }

    // Load configurable threshold from app_settings (fallback to default).
    let lsaMinThreshold = LSA_MIN_THRESHOLD_DEFAULT;
    try {
      const { data: setting } = await supabase
        .from("app_settings").select("value").eq("key", "lsa.min_threshold").maybeSingle();
      const v = Number(setting?.value);
      if (Number.isFinite(v)) lsaMinThreshold = v;
    } catch (_) { /* keep default */ }

    const connectOpts: any = {
      host: SFTP_HOST, port: SFTP_PORT, username: SFTP_USER,
      readyTimeout: 20_000,
      algorithms: { serverHostKey: ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"] },
    };
    if (password) {
      connectOpts.tryKeyboard = true;
      sftp.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
        console.log(`[sftp] keyboard-interactive prompt count=${prompts?.length ?? 0}`);
        finish([password]);
      });
    }
    if (privateKey) connectOpts.privateKey = privateKey;
    if (password) connectOpts.password = password;
    await sftp.connect(connectOpts);

    // Discover dirs dynamically: home dir + every subdirectory it contains
    // (Mintsoft may move the LSA drop into any sibling of product_stock).
    type Found = { dir: string; name: string; modifyTime: number };
    let allCandidates: Found[] = [];
    const allSeen: string[] = [];
    const allCsvs: string[] = [];

    let subdirs: string[] = [];
    try {
      const home = await sftp.list(SFTP_DIR);
      for (const f of home) {
        allSeen.push(`${SFTP_DIR}/${f.name}${f.type === "d" ? "/" : ""}`);
        if (f.type === "d" && !f.name.startsWith(".")) subdirs.push(`${SFTP_DIR}/${f.name}`);
        if (f.type === "-" && f.name.toLowerCase().endsWith(".csv")) {
          allCsvs.push(`${SFTP_DIR}/${f.name}`);
        }
      }
    } catch (e) {
      console.log(`[lsa] could not list home ${SFTP_DIR}: ${e instanceof Error ? e.message : e}`);
    }
    const SEARCH_DIRS = [SFTP_DIR, ...subdirs];
    console.log(`[lsa] scanning dirs: ${SEARCH_DIRS.join(", ")}`);

    for (const dir of SEARCH_DIRS) {
      if (dir === SFTP_DIR) continue; // already listed above
      try {
        const list = await sftp.list(dir);
        for (const f of list) {
          allSeen.push(`${dir}/${f.name}${f.type === "d" ? "/" : ""}`);
          if (f.type === "-" && f.name.toLowerCase().endsWith(".csv")) {
            allCsvs.push(`${dir}/${f.name}`);
          }
        }
      } catch (e) {
        console.log(`[lsa] could not list ${dir}: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Match by FILE_PATTERNS first, then fall back to loose match.
    const csvFiles = [...allSeen]
      .filter((p) => p.toLowerCase().endsWith(".csv"))
      .map((p) => {
        const i = p.lastIndexOf("/");
        return { dir: p.slice(0, i), name: p.slice(i + 1) };
      });

    for (const f of csvFiles) {
      const nameLower = f.name.toLowerCase();
      const matchesPattern = FILE_PATTERNS.some((p) => nameLower.startsWith(p.toLowerCase()));
      const matchesLoose = LOOSE_MATCH.test(nameLower);
      if (matchesPattern || matchesLoose) {
        try {
          const stat = await sftp.stat(`${f.dir}/${f.name}`);
          allCandidates.push({ dir: f.dir, name: f.name, modifyTime: stat.modifyTime });
        } catch {
          allCandidates.push({ dir: f.dir, name: f.name, modifyTime: 0 });
        }
      }
    }
    allCandidates.sort((a, b) => b.modifyTime - a.modifyTime);

    // Fallback: if LIST didn't reveal anything, try each known pattern by
    // direct stat() — some SFTP servers hide files from LIST but allow GET.
    if (allCandidates.length === 0) {
      const probeDirs = [SFTP_DIR, `${SFTP_DIR}/product_stock`];
      const probeNames = FILE_PATTERNS.map((p) => `${p}.csv`);
      for (const dir of probeDirs) {
        for (const name of probeNames) {
          const path = `${dir}/${name}`;
          try {
            const stat = await sftp.stat(path);
            console.log(`[lsa] direct stat hit: ${path} mtime=${stat.modifyTime}`);
            allCandidates.push({ dir, name, modifyTime: stat.modifyTime });
          } catch (_) { /* not found, skip */ }
        }
      }
      allCandidates.sort((a, b) => b.modifyTime - a.modifyTime);
    }

    if (allCandidates.length === 0) {
      await log("warn", "No low-stock-alert CSV file found", {
        dirs: SEARCH_DIRS, patterns: FILE_PATTERNS, loose_match: LOOSE_MATCH.source,
        seen: allSeen, csvs_seen: allCsvs,
      });
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "no file", seen: allSeen, csvs_seen: allCsvs }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const picked = allCandidates[0];
    chosenFile = picked.name;
    const remotePath = `${picked.dir}/${picked.name}`;
    const buf = (await sftp.get(remotePath)) as Buffer;
    const text = buf.toString("utf-8");
    const rows: Array<Record<string, string>> = parse(text, {
      columns: true, skip_empty_lines: true, trim: true, relax_column_count: true,
    });

    const headers = Object.keys(rows[0] ?? {});
    const norm = (s: string) => s.replace(/^\uFEFF/, "").trim().toLowerCase();
    const findHeader = (...candidates: string[]): string | null => {
      const lower = headers.map(norm);
      for (const c of candidates) {
        const idx = lower.indexOf(norm(c));
        if (idx !== -1) return headers[idx];
      }
      return null;
    };
    const skuKey = findHeader("SKU", "ClientSKU", "Sku");
    const lsaKey = findHeader(
      "Low Stock Alert Level",
      "LowStockAlertLevel",
      "LowStockLevel",
      "LowStockAlert",
      "LSA",
      "ReorderLevel",
      "Level",
    );
    if (!skuKey || !lsaKey) {
      throw new Error(`Could not find SKU/LSA columns. Headers: ${headers.join(", ")}`);
    }

    const lsaMap = new Map<string, number>();
    let skippedInvalid = 0, skippedBelowThreshold = 0;
    for (const r of rows) {
      const sku = (r[skuKey] ?? "").trim();
      const lsa = Number(r[lsaKey]);
      if (!sku || !Number.isFinite(lsa)) { skippedInvalid++; continue; }
      if (lsa <= lsaMinThreshold) { skippedBelowThreshold++; continue; }
      lsaMap.set(sku, lsa);
    }

    // Bulk update via RPC — same pattern as sftp-pull-stock (avoids PostgREST
    // URL-length issues and per-row HTTP fragility).
    const entries = Array.from(lsaMap.entries());
    const CHUNK = 5000;
    let updated = 0;
    let notFound = 0;
    const allMissing: Array<{ sku: string; lsa: number }> = [];
    console.log(`[lsa] bulk-updating ${entries.length} SKUs in chunks of ${CHUNK}`);
    for (let i = 0; i < entries.length; i += CHUNK) {
      const payload = entries.slice(i, i + CHUNK).map(([sku, lsa]) => ({ sku, lsa }));
      const t = Date.now();
      const { data, error } = await supabase.rpc("bulk_update_lsa_from_sftp", {
        _payload: payload,
      });
      if (error) {
        console.error("bulk_update_lsa_from_sftp error", error.message);
        throw new Error(`bulk update failed: ${error.message}`);
      }
      const row = Array.isArray(data) ? data[0] : data;
      const u = Number(row?.updated_count ?? 0);
      const nf = Number(row?.not_found_count ?? 0);
      updated += u;
      notFound += nf;
      const missing = (row?.not_found_skus ?? []) as Array<{ sku: string; lsa: number }>;
      if (Array.isArray(missing) && missing.length) allMissing.push(...missing);
      console.log(`[lsa] chunk ${i / CHUNK + 1}: updated=${u} not_found=${nf} in ${Date.now() - t}ms`);
    }

    // Persist unmatched SKUs so they can be reviewed in the UI (Housekeeping).
    if (allMissing.length) {
      const nowIso = new Date().toISOString();
      // Upsert via RPC-friendly batches; use upsert with onConflict to bump last_seen_at/seen_count.
      const UPS_CHUNK = 1000;
      for (let i = 0; i < allMissing.length; i += UPS_CHUNK) {
        const slice = allMissing.slice(i, i + UPS_CHUNK).map(m => ({
          sku: m.sku, lsa: Number(m.lsa) || 0,
          last_seen_at: nowIso, source_file: chosenFile,
        }));
        const { error: upErr } = await supabase
          .from("lsa_unmatched_skus")
          .upsert(slice, { onConflict: "sku", ignoreDuplicates: false });
        if (upErr) console.error("[lsa] upsert unmatched err", upErr.message);
      }
      // Bump seen_count for existing rows via a simple SQL-ish increment using RPC isn't strictly
      // necessary; the upsert above refreshes last_seen_at + lsa. seen_count stays 1 on first
      // sighting, which is enough to spot persistent misses across days when paired with last_seen_at.
    }

    // Keep file on the server (do NOT delete) so we always have a recoverable
    // snapshot to re-run if anything looks off.
    // try { await sftp.delete(remotePath); } catch (_) { /* ignore */ }

    const summary = {
      file: chosenFile, rows_in_csv: rows.length,
      kept_above_threshold: lsaMap.size,
      skipped_below_threshold: skippedBelowThreshold,
      skipped_invalid: skippedInvalid,
      updated, not_found_in_db: notFound,
    };
    await log("ok", `Synced ${updated} LSA values from ${chosenFile}`, summary);
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    try {
      console.error("[lsa] raw err type:", typeof err, "keys:", err && Object.keys(err));
      console.error("[lsa] raw err json:", JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})));
    } catch (_) { /* ignore */ }
    const msg =
      err instanceof Error ? err.message :
      typeof err === "string" ? err :
      err && (err.message || err.error_description || err.details || err.hint || err.code)
        ? [err.message, err.details, err.hint, err.code].filter(Boolean).join(" | ")
        : JSON.stringify(err);
    console.error("sftp-pull-lowstock failed:", msg);
    await log("error", msg, { file: chosenFile });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sftp.end(); } catch (_) { /* ignore */ }
  }
});
