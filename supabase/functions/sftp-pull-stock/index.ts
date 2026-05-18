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
// Mintsoft has emitted two naming styles over time; accept either.
const FILE_PREFIXES = ["pdochubInventory", "InventoryExport"];

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
        privateKey = trimmed;
      } else {
        try {
          privateKey = new TextDecoder().decode(Uint8Array.from(atob(trimmed.replace(/\s+/g, "")), c => c.charCodeAt(0)));
        } catch {
          privateKey = trimmed;
        }
      }
    } else if (!password && keyRaw) {
      privateKey = keyRaw;
    }
    if (!privateKey && !password) {
      throw new Error("No SFTP credential set (MINTSOFT_FTP_PRIVATE_KEY_B64 / _KEY / _PASSWORD)");
    }

    console.log(`[sftp] connecting to ${SFTP_USER}@${SFTP_HOST}:${SFTP_PORT} (auth=${privateKey ? "key" : "password"}, pwlen=${password?.length ?? 0})`);
    const t0 = Date.now();
    const connectOpts: any = {
      host: SFTP_HOST,
      port: SFTP_PORT,
      username: SFTP_USER,
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
    console.log(`[sftp] connected in ${Date.now() - t0}ms`);

    // Find newest pdochubInventory*.csv
    console.log(`[sftp] listing ${SFTP_DIR}`);
    const list = await sftp.list(SFTP_DIR);
    console.log(`[sftp] list returned ${list.length} entries`);
    const candidates = list
      .filter(
        (f) =>
          f.type === "-" &&
          FILE_PREFIXES.some((p) => f.name.startsWith(p)) &&
          f.name.toLowerCase().endsWith(".csv"),
      )
      .sort((a, b) => b.modifyTime - a.modifyTime);

    if (candidates.length === 0) {
      await log("warn", "No inventory CSV file found", {
        dir: SFTP_DIR,
        prefixes: FILE_PREFIXES,
        seen: list.map((f) => f.name),
      });
      return new Response(
        JSON.stringify({ ok: true, processed: 0, message: "no file" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    chosenFile = candidates[0].name;
    const remotePath = `${SFTP_DIR}/${chosenFile}`;
    console.log(`[sftp] downloading ${remotePath}`);

    // Download to memory
    const buf = (await sftp.get(remotePath)) as Buffer;
    const text = buf.toString("utf-8");
    console.log(`[sftp] downloaded ${text.length} bytes`);

    // Parse CSV
    const rows: Array<Record<string, string>> = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    // Build SKU -> {stock_level, on_order, mintsoft_back_orders} map (latest wins if dup)
    type Row = { stock_level: number | null; on_order: number | null; mintsoft_back_orders: number | null };
    const stockMap = new Map<string, Row>();
    const numOrNull = (v: unknown): number | null => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    let skipped = 0;
    // Column-name variants Mintsoft has been observed to emit.
    const pickCol = (r: Record<string, string>, names: string[]): unknown => {
      for (const n of names) {
        if (r[n] !== undefined) return r[n];
        // case-insensitive fallback
        const k = Object.keys(r).find((x) => x.toLowerCase() === n.toLowerCase());
        if (k) return r[k];
      }
      return undefined;
    };
    const WAREHOUSE_FILTER = "coleraine"; // case-insensitive substring match (matches ColeraineLIVE, Coleraine Live, etc)
    let wrongWarehouse = 0;
    const warehouseSeen = new Map<string, number>();
    for (const r of rows) {
      const warehouse = (pickCol(r, ["Warehouse"]) as string | undefined)?.toString().trim() ?? "";
      warehouseSeen.set(warehouse, (warehouseSeen.get(warehouse) ?? 0) + 1);
      if (!warehouse.toLowerCase().includes(WAREHOUSE_FILTER)) {
        wrongWarehouse++;
        continue;
      }
      const sku = (pickCol(r, ["SKU", "Sku"]) as string | undefined)?.toString().trim();
      const stock_level = numOrNull(pickCol(r, ["StockLevel", "Stock", "OnHand"]));
      const on_order = numOrNull(pickCol(r, ["OnOrder", "On Order"]));
      const mintsoft_back_orders = numOrNull(pickCol(r, ["RequiredByBackOrder", "OnBackOrder", "BackOrder", "BackOrders", "OnBackorder"]));
      if (!sku || stock_level === null) {
        skipped++;
        continue;
      }
      stockMap.set(sku, { stock_level, on_order, mintsoft_back_orders });
    }
    console.log(`[sftp] warehouses seen:`, Object.fromEntries(warehouseSeen));
    console.log(`[sftp] kept ${stockMap.size} SKUs matching '${WAREHOUSE_FILTER}', dropped ${wrongWarehouse} from other warehouses`);

    // Bulk update via single RPC call. Send in chunks to keep payload sane.
    const entries = Array.from(stockMap.entries());
    const CHUNK = 1500;
    let updated = 0;
    let notFound = 0;
    console.log(`[sftp] bulk-updating ${entries.length} SKUs in chunks of ${CHUNK}`);

    for (let i = 0; i < entries.length; i += CHUNK) {
      const payload = entries.slice(i, i + CHUNK).map(([sku, v]) => ({
        sku,
        stock_level: v.stock_level,
        on_order: v.on_order,
        mintsoft_back_orders: v.mintsoft_back_orders,
      }));
      const t = Date.now();
      const { data, error } = await supabase.rpc("bulk_update_stock_from_sftp", {
        _payload: payload,
      });
      if (error) {
        console.error("bulk_update_stock_from_sftp error", error.message);
        throw new Error(`bulk update failed: ${error.message}`);
      }
      const row = Array.isArray(data) ? data[0] : data;
      const u = Number(row?.updated_count ?? 0);
      const nf = Number(row?.not_found_count ?? 0);
      updated += u;
      notFound += nf;
      console.log(`[sftp] chunk ${i / CHUNK + 1}: updated=${u} not_found=${nf} in ${Date.now() - t}ms`);
    }

    // SAFETY: file deletion temporarily disabled while we validate new Mintsoft exports.
    // Re-enable once we're confident in the run output.
    console.log(`[sftp] file deletion disabled (validation mode); leaving ${chosenFile} in place`);

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
