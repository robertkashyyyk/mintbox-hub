import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Client from "npm:ssh2-sftp-client@10.0.3";
import { Buffer } from "node:buffer";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PushRow {
  sku: string;
  new_price: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth. Accept either a logged-in user token OR the service-role key (for
  // automation — e.g. the cross-account "align to validated price" batch).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  let userId: string | null = null;
  let isService = token === serviceKey;
  if (!isService) {
    // Fallback: accept any valid service-role JWT (key formats can differ from env).
    try {
      const claims = JSON.parse(atob(token.split(".")[1] ?? ""));
      if (claims?.role === "service_role") isService = true;
    } catch { /* not a JWT */ }
  }
  if (!isService) {
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return json({ error: "Unauthorized" }, 401);
    }
    userId = userData.user.id;
  }


  // Parse + validate
  let body: { store_id?: string; rows?: PushRow[]; source?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const storeId = body.store_id;
  // Where the price came from: "repricer" (profit) or "liquidation" (clearance).
  // The Repricing Payoff report excludes "liquidation" so deliberate clearance
  // cuts don't get counted as repricing value.
  const source = body.source === "liquidation" ? "liquidation" : "repricer";
  const rows = (body.rows ?? []).filter(
    (r) =>
      r &&
      typeof r.sku === "string" &&
      r.sku.trim().length > 0 &&
      typeof r.new_price === "number" &&
      isFinite(r.new_price) &&
      r.new_price >= 0,
  );
  if (!storeId || rows.length === 0) {
    return json(
      { error: "store_id and at least one valid row required" },
      400,
    );
  }
  if (rows.length > 50000) {
    return json({ error: "Too many rows (max 50,000)" }, 400);
  }

  const admin = createClient(url, serviceKey);

  // Role check (skipped for service/automation calls).
  if (!isService) {
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["super_user", "senior_user"])
      .maybeSingle();
    if (!roleRow) {
      return json({ error: "Forbidden: senior or super role required" }, 403);
    }
  }

  // Load store
  const { data: store, error: storeErr } = await admin
    .from("threeds_stores")
    .select("id, store_name, sftp_filename, enabled")
    .eq("id", storeId)
    .maybeSingle();
  if (storeErr || !store) {
    return json({ error: "Store not found" }, 404);
  }
  if (!store.enabled) {
    return json({ error: "Store is disabled" }, 400);
  }

  // CUMULATIVE: upsert this batch into the pending queue (latest price per SKU
  // wins), then rebuild the SFTP file from the FULL pending set so intra-day
  // pushes accumulate instead of clobbering each other.
  const nowIso = new Date().toISOString();
  const upsertRows = rows.map((r) => ({
    store_id: storeId,
    sku: r.sku.trim(),
    price: Number(r.new_price.toFixed(2)),
    status: "pending",
    source,
    queued_at: nowIso,
    queued_by: userId,
    last_pushed_at: nowIso,
    applied_at: null,
    verified_price: null,
  }));
  const { error: upsertErr } = await admin
    .from("threeds_reprice_pending")
    .upsert(upsertRows, { onConflict: "store_id,sku" });
  if (upsertErr) {
    return json({ error: `Failed to queue prices: ${upsertErr.message}` }, 500);
  }

  // Load the full pending set for this store (everything not yet confirmed live).
  const { data: pending, error: pendErr } = await admin
    .from("threeds_reprice_pending")
    .select("sku, price")
    .eq("store_id", storeId)
    .eq("status", "pending")
    .order("sku", { ascending: true });
  if (pendErr || !pending) {
    return json({ error: `Failed to load pending prices: ${pendErr?.message}` }, 500);
  }

  // Build CSV from the full pending set.
  const escape = (s: string) =>
    /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const csvLines = [
    "SKU,Price",
    ...pending.map(
      (r) => `${escape(String(r.sku).trim())},${Number(r.price).toFixed(2)}`,
    ),
  ];
  const csv = csvLines.join("\n") + "\n";
  const csvPreview = csv.length > 4000 ? csv.slice(0, 4000) + "\n…" : csv;
  const newCount = rows.length;
  const totalPending = pending.length;

  // Insert pending push log
  const { data: pushLog, error: logErr } = await admin
    .from("threeds_reprice_pushes")
    .insert({
      store_id: storeId,
      pushed_by: userId,
      row_count: totalPending, // rows actually written to the file (full pending set)
      csv_preview: csvPreview,
      sftp_path: store.sftp_filename,
      status: "pending",
    })
    .select("id")
    .single();
  if (logErr || !pushLog) {
    return json({ error: "Failed to log push" }, 500);
  }

  // SFTP push
  const host = Deno.env.get("THREEDS_SFTP_HOST");
  const port = parseInt(Deno.env.get("THREEDS_SFTP_PORT") ?? "22", 10);
  const username = Deno.env.get("THREEDS_SFTP_USER");
  const password = Deno.env.get("THREEDS_SFTP_PASSWORD");
  if (!host || !username || !password) {
    await admin
      .from("threeds_reprice_pushes")
      .update({ status: "error", error_message: "SFTP creds missing" })
      .eq("id", pushLog.id);
    return json({ error: "SFTP credentials not configured" }, 500);
  }

  const sftp = new Client();
  try {
    await sftp.connect({
      host,
      port,
      username,
      password,
      readyTimeout: 20000,
    });

    // Ensure parent dir exists (e.g. "reprice/")
    const targetPath = store.sftp_filename;
    const slashIdx = targetPath.lastIndexOf("/");
    if (slashIdx > 0) {
      const dir = targetPath.slice(0, slashIdx);
      try {
        const exists = await sftp.exists(dir);
        if (!exists) await sftp.mkdir(dir, true);
      } catch (_e) {
        // ignore — try the put anyway
      }
    }

    const buf = Buffer.from(csv, "utf-8");
    await sftp.put(buf, targetPath);
    await sftp.end();


    await admin
      .from("threeds_reprice_pushes")
      .update({ status: "success" })
      .eq("id", pushLog.id);

    return json({
      ok: true,
      push_id: pushLog.id,
      added: newCount,            // SKUs added/updated in this push
      row_count: totalPending,    // total prices now in the file (cumulative)
      sftp_path: targetPath,
      store_name: store.store_name,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      await sftp.end();
    } catch (_) {
      /* ignore */
    }
    await admin
      .from("threeds_reprice_pushes")
      .update({ status: "error", error_message: message })
      .eq("id", pushLog.id);
    return json({ error: `SFTP failed: ${message}` }, 502);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
