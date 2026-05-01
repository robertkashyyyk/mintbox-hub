// Daily SFTP stock pull from Digital Ocean droplet.
// Connects with SSH key auth, finds newest pdochubInventory*.csv,
// upserts current_stock from StockLevel column, deletes the file.
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
const FILE_PREFIX = "pdochubInventory";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const log = async (
    status: "ok" | "error" | "warn",
    message: string,
    details: Record<string, unknown> = {},
  ) => {
    const endedAt = new Date();
    await supabase.from("edge_function_runs").insert({
      function_name: "sftp-pull-stock",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_ms: endedAt.getTime() - startedAt.getTime(),
      status,
      message,
      details,
    });
  };

  const sftp = new SftpClient();
  let chosenFile: string | null = null;

  try {
    let privateKey = Deno.env.get("MINTSOFT_FTP_PRIVATE_KEY");
    if (!privateKey) throw new Error("MINTSOFT_FTP_PRIVATE_KEY not set");
    // Normalize: env vars sometimes lose real newlines; restore \n -> newline
    // and ensure CR/LF stripped, trailing newline present.
    privateKey = privateKey.replace(/\\n/g, "\n").replace(/\r/g, "");
    if (!privateKey.endsWith("\n")) privateKey += "\n";

    await sftp.connect({
      host: SFTP_HOST,
      port: SFTP_PORT,
      username: SFTP_USER,
      privateKey,
      readyTimeout: 20_000,
    });

    // Find newest pdochubInventory*.csv
    const list = await sftp.list(SFTP_DIR);
    const candidates = list
      .filter(
        (f) =>
          f.type === "-" &&
          f.name.startsWith(FILE_PREFIX) &&
          f.name.toLowerCase().endsWith(".csv"),
      )
      .sort((a, b) => b.modifyTime - a.modifyTime);

    if (candidates.length === 0) {
      await log("warn", "No pdochubInventory*.csv file found", {
        dir: SFTP_DIR,
        seen: list.map((f) => f.name),
      });
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "no file" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    chosenFile = candidates[0].name;
    const remotePath = `${SFTP_DIR}/${chosenFile}`;

    // Download to memory
    const buf = (await sftp.get(remotePath)) as Buffer;
    const text = buf.toString("utf-8");

    // Parse CSV
    const rows: Array<Record<string, string>> = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    // Build SKU -> StockLevel map (latest wins if dup)
    const stockMap = new Map<string, number>();
    let skipped = 0;
    for (const r of rows) {
      const sku = r.SKU?.trim();
      const lvl = Number(r.StockLevel);
      if (!sku || !Number.isFinite(lvl)) {
        skipped++;
        continue;
      }
      stockMap.set(sku, lvl);
    }

    // Chunked update
    const now = new Date().toISOString();
    const skus = Array.from(stockMap.entries());
    const CHUNK = 500;
    let updated = 0;
    let notFound = 0;

    for (let i = 0; i < skus.length; i += CHUNK) {
      const slice = skus.slice(i, i + CHUNK);
      // Use upsert-style update via RPC-less batching: do parallel updates per row is too slow.
      // Instead: for each chunk, run a single SQL via PostgREST `.in()` pattern is read-only.
      // We use the `update` with `in` filter per stock value — group SKUs by value to minimize calls.
      const byValue = new Map<number, string[]>();
      for (const [sku, lvl] of slice) {
        const arr = byValue.get(lvl) ?? [];
        arr.push(sku);
        byValue.set(lvl, arr);
      }
      for (const [lvl, skuList] of byValue) {
        const { data, error } = await supabase
          .from("products_cache")
          .update({ current_stock: lvl, last_stock_sync: now })
          .in("sku", skuList)
          .select("sku");
        if (error) {
          console.error("update error", error.message);
          continue;
        }
        const hit = data?.length ?? 0;
        updated += hit;
        notFound += skuList.length - hit;
      }
    }

    // Delete the source file
    await sftp.delete(remotePath);

    await log("ok", `Synced ${updated} SKUs from ${chosenFile}`, {
      file: chosenFile,
      rows_in_csv: rows.length,
      unique_skus: stockMap.size,
      updated,
      not_found_in_db: notFound,
      skipped_invalid: skipped,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        file: chosenFile,
        rows: rows.length,
        unique_skus: stockMap.size,
        updated,
        not_found: notFound,
        skipped,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("sftp-pull-stock failed:", msg);
    await log("error", msg, { file: chosenFile });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    try {
      await sftp.end();
    } catch (_) { /* ignore */ }
  }
});
