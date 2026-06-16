// Stock Count Game — push captured counts to Mintsoft.
//
// Capture is already durable (stock_count_events rows written by the
// capture_stock_count RPC). This function is the decoupled, retryable sync step:
// per SKU it sets Main Warehouse on-hand -> 0 (wipes dummy stock) and Coleraine
// Live on-hand -> the entered count, via Product/BulkOnHandStockUpdate.
//
// BulkOnHandStockUpdate sets on-hand ABSOLUTELY (not a delta) so it is idempotent
// — re-sending the same payload is harmless, which makes retries safe.
//
// Input:  { event_ids: string[] }   (the events captured this game session)
// Output: { synced, flagged, failed, results: [...] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";

// Default warehouse IDs; overridden by app_settings (warehouse.coleraine_id / warehouse.main_id).
const DEFAULT_COLERAINE_ID = 5;
const DEFAULT_MAIN_ID = 3;

interface EventRow {
  id: string;
  sku: string;
  mintsoft_product_id: number | null;
  counted_qty: number;
}

interface ResultItem {
  event_id: string;
  sku: string;
  status: "synced" | "flagged" | "failed";
  error?: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function readSettingInt(
  admin: ReturnType<typeof createClient>,
  key: string,
  fallback: number,
): Promise<number> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = (data as any)?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Build the two on-hand rows for one SKU. Isolated here because the exact
// Mintsoft BulkOnHandStockUpdate field names are pending account confirmation
// (open item) — adjust ProductId/WarehouseId/OnHand here if the schema differs.
function onHandRows(productId: number, mainId: number, coleraineId: number, qty: number) {
  return [
    { ProductId: productId, WarehouseId: mainId, OnHand: 0 },
    { ProductId: productId, WarehouseId: coleraineId, OnHand: qty },
  ];
}

async function postBulkOnHand(rows: unknown[], apiKey: string): Promise<{ ok: boolean; detail: string }> {
  const resp = await fetch(`${MINTSOFT_BASE}/api/Product/BulkOnHandStockUpdate`, {
    method: "POST",
    headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  const text = await resp.text();
  return { ok: resp.ok, detail: `${resp.status}: ${text.slice(0, 300)}` };
}

// Light re-validation: if real stock has appeared in Coleraine since we offered
// this SKU, don't clobber a fresh real count — flag it instead.
async function coleraineOnHand(sku: string, coleraineId: number, apiKey: string): Promise<number | null> {
  try {
    const url = `${MINTSOFT_BASE}/api/Product/StockLevels?WarehouseId=${coleraineId}&SKU=${encodeURIComponent(sku)}`;
    const r = await fetch(url, { headers: { "ms-apikey": apiKey, "Content-Type": "application/json" } });
    if (!r.ok) return null;
    const arr = await r.json();
    if (Array.isArray(arr) && arr.length > 0) {
      const match = arr.find((x: any) => x?.SKU === sku) ?? arr[0];
      // Mintsoft /Product/StockLevels exposes TotalStockLevel / Level (NOT AvailableQuantity,
      // which doesn't exist — reading it made this guard silently always return null).
      const n = Number(match?.TotalStockLevel ?? match?.Level);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  } catch {
    return null; // network blip — don't block the write on the guard
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mintsoftKey = Deno.env.get("MINTSOFT_API_KEY");

  if (!mintsoftKey) return json({ error: "MINTSOFT_API_KEY not set" }, 500);

  // ---- Auth: any authenticated staff. The game is a floor-staff task, so we
  // deliberately do not require senior/super here (capture is open to authenticated
  // too). Tighten with has_any_role if stock writes need to be restricted. ----
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);

  let body: { event_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const eventIds = Array.isArray(body.event_ids) ? body.event_ids.filter((x) => typeof x === "string") : [];
  if (eventIds.length === 0 || eventIds.length > 500) {
    return json({ error: "event_ids must be 1-500 entries" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const coleraineId = await readSettingInt(admin, "warehouse.coleraine_id", DEFAULT_COLERAINE_ID);
  const mainId = await readSettingInt(admin, "warehouse.main_id", DEFAULT_MAIN_ID);

  // Only sync events still needing it. Already-synced rows are skipped (idempotent).
  const { data: rows, error: loadErr } = await admin
    .from("stock_count_events")
    .select("id, sku, mintsoft_product_id, counted_qty")
    .in("id", eventIds)
    .in("sync_status", ["pending", "failed"]);
  if (loadErr) return json({ error: loadErr.message }, 500);

  const events = (rows as EventRow[]) ?? [];
  const results: ResultItem[] = [];

  // Partition: missing Mintsoft ID -> failed; real Coleraine stock now -> flagged.
  const toSync: EventRow[] = [];
  for (const ev of events) {
    if (!ev.mintsoft_product_id) {
      results.push({ event_id: ev.id, sku: ev.sku, status: "failed", error: "No Mintsoft product ID" });
      await admin.from("stock_count_events")
        .update({ sync_status: "failed", sync_error: "No Mintsoft product ID" })
        .eq("id", ev.id);
      continue;
    }
    const live = await coleraineOnHand(ev.sku, coleraineId, mintsoftKey);
    if (live !== null && live > 0) {
      results.push({ event_id: ev.id, sku: ev.sku, status: "flagged", error: `Coleraine now ${live} — not overwritten` });
      await admin.from("stock_count_events")
        .update({ sync_status: "flagged", sync_error: `Real Coleraine stock (${live}) appeared since offered` })
        .eq("id", ev.id);
      continue;
    }
    toSync.push(ev);
  }

  if (toSync.length > 0) {
    const payload = toSync.flatMap((ev) =>
      onHandRows(ev.mintsoft_product_id!, mainId, coleraineId, ev.counted_qty)
    );

    let res = await postBulkOnHand(payload, mintsoftKey);
    if (!res.ok) {
      await new Promise((r) => setTimeout(r, 700)); // one retry — transient 5xx / cold start
      res = await postBulkOnHand(payload, mintsoftKey);
    }

    const nowIso = new Date().toISOString();
    if (res.ok) {
      const ids = toSync.map((e) => e.id);
      await admin.from("stock_count_events")
        .update({ sync_status: "synced", synced_at: nowIso, sync_error: null })
        .in("id", ids);
      for (const ev of toSync) results.push({ event_id: ev.id, sku: ev.sku, status: "synced" });
    } else {
      const ids = toSync.map((e) => e.id);
      await admin.from("stock_count_events")
        .update({ sync_status: "failed", sync_error: res.detail })
        .in("id", ids);
      for (const ev of toSync) results.push({ event_id: ev.id, sku: ev.sku, status: "failed", error: res.detail });
    }
  }

  const summary = {
    synced: results.filter((r) => r.status === "synced").length,
    flagged: results.filter((r) => r.status === "flagged").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
  return json(summary);
});
