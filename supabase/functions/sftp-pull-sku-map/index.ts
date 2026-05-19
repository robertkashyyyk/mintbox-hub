// Pull Mintsoft SKU -> ProductID mapping CSV from SFTP, upsert into
// mintsoft_sku_map, then backfill products_cache.mintsoft_product_id for
// orphans and auto-create cache rows for new true-format SKUs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import SftpClient from "npm:ssh2-sftp-client@10.0.3";
import { parse } from "npm:csv-parse@5.5.6/sync";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SFTP_HOST = "138.68.139.54";
const SFTP_PORT = 22;
const SFTP_USER = "mintsoft_export";
const SFTP_DIR = "/home/mintsoft_export";
const FILE_PREFIXES = ["pdochubMintsoftProductIDList", "SkuMapExport", "MintsoftProductIDList"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const recordRun = async (
    status: "succeeded" | "failed" | "partial",
    summary: Record<string, unknown>,
    errorMessage?: string,
  ) => {
    try {
      await supabase.from("agent_runs").insert({
        run_type: "sftp_pull_sku_map",
        started_at: startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        status,
        summary,
        error_message: errorMessage ?? null,
      });
    } catch (_) { /* ignore */ }
  };

  const sftp = new SftpClient();
  let chosenFile: string | null = null;

  try {
    const password = Deno.env.get("MINTSOFT_FTP_PASSWORD")?.replace(/\r/g, "").trim();
    const keyB64 = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY_B64");
    const keyRaw = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY");
    let privateKey: string | null = null;
    if (!password && keyB64) {
      const trimmed = keyB64.trim();
      if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) privateKey = trimmed;
      else {
        try {
          privateKey = new TextDecoder().decode(
            Uint8Array.from(atob(trimmed.replace(/\s+/g, "")), (c) => c.charCodeAt(0)),
          );
        } catch { privateKey = trimmed; }
      }
    } else if (!password && keyRaw) privateKey = keyRaw;
    if (!privateKey && !password) throw new Error("No SFTP credential set");

    const connectOpts: any = {
      host: SFTP_HOST, port: SFTP_PORT, username: SFTP_USER,
      readyTimeout: 20_000,
      algorithms: { serverHostKey: ["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256"] },
    };
    if (password) {
      connectOpts.tryKeyboard = true;
      connectOpts.password = password;
      sftp.on("keyboard-interactive", (_n, _i, _l, _p, finish) => finish([password]));
    }
    if (privateKey) connectOpts.privateKey = privateKey;
    await sftp.connect(connectOpts);

    const list = await sftp.list(SFTP_DIR);
    const candidates = list
      .filter((f) => f.type === "-" &&
        FILE_PREFIXES.some((p) => f.name.toLowerCase().startsWith(p.toLowerCase())) &&
        f.name.toLowerCase().endsWith(".csv"))
      .sort((a, b) => b.modifyTime - a.modifyTime);

    if (candidates.length === 0) {
      await recordRun("partial", { message: "no file found", prefixes: FILE_PREFIXES, seen: list.map((f) => f.name) });
      return new Response(JSON.stringify({ ok: true, message: "no file" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    chosenFile = candidates[0].name;
    const remotePath = `${SFTP_DIR}/${chosenFile}`;
    const buf = (await sftp.get(remotePath)) as Buffer;
    const text = buf.toString("utf-8");

    // Auto-detect delimiter
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

    const rows: Array<Record<string, string>> = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      delimiter: delim,
      bom: true,
    });

    const pick = (r: Record<string, string>, names: string[]): string | undefined => {
      for (const n of names) {
        if (r[n] !== undefined && r[n] !== "") return r[n];
        const k = Object.keys(r).find((x) => x.toLowerCase() === n.toLowerCase());
        if (k && r[k] !== undefined && r[k] !== "") return r[k];
      }
      return undefined;
    };

    const payload: Array<{ sku: string; mintsoft_product_id: number; name: string | null }> = [];
    let skipped = 0;
    for (const r of rows) {
      const sku = pick(r, ["SKU", "Sku"])?.toString().trim();
      const idStr = pick(r, ["ProductID", "PRODUCTID", "ProductId", "ID", "Id"])?.toString().trim();
      const name = pick(r, ["Name", "ProductName"])?.toString().trim() ?? null;
      const id = idStr ? Number(idStr) : NaN;
      if (!sku || !Number.isFinite(id)) { skipped++; continue; }
      payload.push({ sku, mintsoft_product_id: id, name });
    }

    const CHUNK = 1500;
    let upserted = 0;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK);
      const { data, error } = await supabase.rpc("bulk_upsert_sku_map", { _payload: slice });
      if (error) throw new Error(`bulk_upsert_sku_map failed: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      upserted += Number(row?.upserted_count ?? 0);
    }

    const { data: applyData, error: applyErr } = await supabase.rpc("apply_sku_map_to_cache");
    if (applyErr) throw new Error(`apply_sku_map_to_cache failed: ${applyErr.message}`);
    const applyRow = Array.isArray(applyData) ? applyData[0] : applyData;
    const resolved = Number(applyRow?.resolved_count ?? 0);
    const created = Number(applyRow?.created_count ?? 0);

    const summary = {
      file: chosenFile, rows_in_csv: rows.length, parsed_rows: payload.length,
      skipped_invalid: skipped, upserted, resolved, created, delimiter: delim,
    };
    await recordRun("succeeded", summary);

    return new Response(JSON.stringify({ ok: true, ...summary }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sftp-pull-sku-map failed:", msg);
    await recordRun("failed", { file: chosenFile }, msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try { await sftp.end(); } catch (_) { /* ignore */ }
  }
});
