// Pull the Mintsoft "Bundle Report | ALL" CSV from the same SFTP as the SKU-map
// export, and (a) in dry-run: report the file's schema so we can map columns
// before writing anything; (b) live: upsert parent->child(+qty) bundle rows into
// public.sku_relationships (relationship_type='bundle'), full-refresh per run.
//
// Same SFTP as sftp-pull-sku-map: mintsoft_export@138.68.139.54:/home/mintsoft_export,
// secret MINTSOFT_FTP_PASSWORD (or MINTSOFT_FTP_PRIVATE_KEY[_B64]).
//
// Runs in the BACKGROUND via EdgeRuntime.waitUntil; HTTP returns the agent_runs
// row id immediately so the UI / caller can poll summary for progress.
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
// Bundle report file prefixes (case-insensitive). Broadened until we see the real name.
const FILE_PREFIXES = ["BundleReport", "Bundle", "pdochubBundle", "MintsoftBundle"];

// Candidate header names for each field — dry-run reveals the real ones if these miss.
const PARENT_KEYS = ["ParentSKU", "Parent SKU", "BundleSKU", "Bundle SKU", "ParentProductSKU", "KitSKU", "SKU", "ProductSKU"];
const CHILD_KEYS = ["ChildSKU", "Child SKU", "ComponentSKU", "Component SKU", "LinkedSKU", "Linked SKU", "ItemSKU", "ProductInBundleSKU"];
const QTY_KEYS = ["Quantity", "Qty", "ComponentQty", "ComponentQuantity", "LinkQuantity", "KitQuantity", "Units"];
const PARENT_ID_KEYS = ["ParentProductID", "ParentID", "BundleProductID", "KitProductID"];
const CHILD_ID_KEYS = ["ChildProductID", "ComponentProductID", "LinkedProductID", "ProductInBundleID"];

function pick(r: Record<string, string>, names: string[]): string | undefined {
  for (const n of names) {
    if (r[n] !== undefined && r[n] !== "") return r[n];
    const k = Object.keys(r).find((x) => x.toLowerCase() === n.toLowerCase());
    if (k && r[k] !== undefined && r[k] !== "") return r[k];
  }
  return undefined;
}

async function doWork(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  dryRun: boolean,
) {
  const sftp = new SftpClient();
  let chosenFile: string | null = null;

  const updateRun = async (patch: Record<string, unknown>) => {
    try { await supabase.from("agent_runs").update(patch).eq("id", runId); } catch (_) { /* ignore */ }
  };
  // agent_runs.status CHECK allows only 'running' | 'complete' | 'error'.
  const finish = async (
    status: "succeeded" | "failed" | "partial",
    summary: Record<string, unknown>,
    errorMessage?: string,
  ) => updateRun({
    finished_at: new Date().toISOString(),
    status: status === "failed" ? "error" : "complete",
    summary, error: errorMessage ?? null,
  });

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

    await updateRun({ summary: { dry_run: dryRun, phase: "connecting" } });
    await sftp.connect(connectOpts);

    await updateRun({ summary: { dry_run: dryRun, phase: "listing" } });
    const list = await sftp.list(SFTP_DIR);
    const candidates = list
      .filter((f) => f.type === "-" &&
        FILE_PREFIXES.some((p) => f.name.toLowerCase().startsWith(p.toLowerCase())) &&
        f.name.toLowerCase().endsWith(".csv"))
      .sort((a, b) => b.modifyTime - a.modifyTime);

    if (candidates.length === 0) {
      await finish("partial", {
        dry_run: dryRun, message: "no bundle file found", prefixes: FILE_PREFIXES,
        seen: list.filter((f) => f.type === "-").map((f) => f.name),
      });
      return;
    }

    chosenFile = candidates[0].name;
    const chosenSize = (candidates[0] as any).size ?? -1;
    await updateRun({ summary: { dry_run: dryRun, phase: "downloading", file: chosenFile, size_bytes: chosenSize } });
    if (chosenSize === 0) {
      await finish("partial", {
        dry_run: dryRun, file: chosenFile, size_bytes: 0,
        message: "report file is 0 bytes — Mintsoft produced no content (report config / no bundle data)",
        other_files: candidates.slice(1, 6).map((f) => ({ name: f.name, size: (f as any).size })),
      });
      return;
    }
    const buf = (await Promise.race([
      sftp.get(`${SFTP_DIR}/${chosenFile}`),
      new Promise((_r, rej) => setTimeout(() => rej(new Error("sftp.get timed out after 30s")), 30_000)),
    ])) as Buffer;
    const text = buf.toString("utf-8");
    const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
    const delim = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";

    const rows: Array<Record<string, string>> = parse(text, {
      columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, delimiter: delim, bom: true,
    });

    const headers = rows.length ? Object.keys(rows[0]) : firstLine.split(delim);

    // DRY-RUN: report schema only, write nothing.
    if (dryRun) {
      const sample = rows.slice(0, 5);
      const detected = {
        parent_sku: rows.length ? (pick(rows[0], PARENT_KEYS) !== undefined ? PARENT_KEYS.find((k) => pick(rows[0], [k])) : null) : null,
        child_sku: rows.length ? (pick(rows[0], CHILD_KEYS) !== undefined ? CHILD_KEYS.find((k) => pick(rows[0], [k])) : null) : null,
        qty: rows.length ? (pick(rows[0], QTY_KEYS) !== undefined ? QTY_KEYS.find((k) => pick(rows[0], [k])) : null) : null,
        parent_id: rows.length ? (pick(rows[0], PARENT_ID_KEYS) !== undefined ? PARENT_ID_KEYS.find((k) => pick(rows[0], [k])) : null) : null,
        child_id: rows.length ? (pick(rows[0], CHILD_ID_KEYS) !== undefined ? CHILD_ID_KEYS.find((k) => pick(rows[0], [k])) : null) : null,
      };
      await finish("succeeded", {
        dry_run: true, file: chosenFile, delimiter: delim, row_count: rows.length,
        headers, detected_mapping: detected, sample_rows: sample,
      });
      return;
    }

    // LIVE: map + full-refresh upsert into sku_relationships (relationship_type='bundle').
    const payload: Array<{ parent_sku: string; child_sku: string; qty: number }> = [];
    let skipped = 0;
    for (const r of rows) {
      const parent = pick(r, PARENT_KEYS)?.toString().trim();
      const child = pick(r, CHILD_KEYS)?.toString().trim();
      const qtyStr = pick(r, QTY_KEYS)?.toString().trim();
      const qty = qtyStr ? Number(qtyStr) : 1;
      if (!parent || !child || parent === child || !Number.isFinite(qty) || qty <= 0) { skipped++; continue; }
      payload.push({ parent_sku: parent, child_sku: child, qty });
    }

    await updateRun({ summary: { dry_run: false, phase: "writing", file: chosenFile, parsed: payload.length, skipped } });
    // Full snapshot: clear existing bundle rows, then insert this run's set in chunks.
    const del = await supabase.from("sku_relationships").delete().eq("relationship_type", "bundle");
    if (del.error) throw new Error(`clear bundle rows failed: ${del.error.message}`);
    let inserted = 0;
    for (let i = 0; i < payload.length; i += 1000) {
      const slice = payload.slice(i, i + 1000).map((p) => ({ ...p, relationship_type: "bundle", is_active: true }));
      const ins = await supabase.from("sku_relationships").insert(slice);
      if (ins.error) throw new Error(`insert failed at ${i}: ${ins.error.message}`);
      inserted += slice.length;
    }

    await finish("succeeded", {
      dry_run: false, file: chosenFile, rows_in_csv: rows.length,
      inserted, skipped_invalid: skipped, distinct_parents: new Set(payload.map((p) => p.parent_sku)).size,
    });
  } catch (e) {
    await finish("failed", { dry_run: dryRun, file: chosenFile }, e instanceof Error ? e.message : String(e));
  } finally {
    try { await sftp.end(); } catch (_) { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let dryRun = true;
  try { const body = await req.json(); if (body && body.dry_run === false) dryRun = false; } catch (_) { /* default dry-run */ }

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({ run_type: "sftp-pull-bundle-map", status: "running", started_at: new Date().toISOString(), summary: { dry_run: dryRun, phase: "starting" } })
    .select("id").single();
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // @ts-ignore EdgeRuntime is provided by the Supabase runtime
  EdgeRuntime.waitUntil(doWork(supabase, run.id as string, dryRun));
  return new Response(JSON.stringify({ run_id: run.id, dry_run: dryRun }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
