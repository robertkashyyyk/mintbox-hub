// threeds-reprice-auto-snapshot
// Builds the daily Auto-Report snapshot: the configured band (default Loss) across
// ALL enabled accounts, frozen for the day. Cron fires hourly; this runs only at
// the configured London hour (DST-aware) and only once per day — unless {force:true}.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// POR band thresholds — mirror src/lib/reprice.ts BANDS.
const BANDS = { loss_max: -1.0, breakeven_max: 1.0, poor_max: 9.99, average_max: 19.99, good_max: 24.99, great_max: 29.99 };
function classifyBand(por: number | null): string | null {
  if (por == null || !isFinite(por)) return null;
  if (por <= BANDS.loss_max) return "loss";
  if (por <= BANDS.breakeven_max) return "breakeven";
  if (por <= BANDS.poor_max) return "poor";
  if (por <= BANDS.average_max) return "average";
  if (por <= BANDS.good_max) return "good";
  if (por <= BANDS.great_max) return "great";
  return "amazing";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let ok = bearer === serviceKey;
  if (!ok && bearer) {
    try { ok = JSON.parse(atob(bearer.split(".")[1] ?? ""))?.role === "service_role"; } catch { /* ignore */ }
  }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: { force?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const force = body.force === true;

  const admin = createClient(url, serviceKey);

  // Settings
  const { data: settingRow } = await admin
    .from("app_settings").select("value").eq("key", "reprice.auto_report").maybeSingle();
  const cfg = (settingRow?.value ?? {}) as any;
  const enabled = cfg.enabled !== false;
  const runHour = Number(cfg.run_hour_london ?? 8);
  const lookback = Number(cfg.lookback_days ?? 30);
  const band = String(cfg.current_band ?? "loss");

  if (!enabled && !force) return json({ ok: true, skipped: "disabled" });

  // London-local hour + date (DST-aware).
  const now = new Date();
  const londonHour = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(now), 10);
  const londonDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(now); // YYYY-MM-DD

  if (!force && londonHour !== runHour) return json({ ok: true, skipped: `hour ${londonHour} != ${runHour}` });

  // Already ran today?
  const { count: existing } = await admin
    .from("threeds_reprice_auto_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("snapshot_date", londonDate);
  if (!force && (existing ?? 0) > 0) return json({ ok: true, skipped: "already ran today", date: londonDate });

  // Enabled stores
  const { data: stores } = await admin
    .from("threeds_stores").select("id, store_name, mintsoft_channel, enabled").eq("enabled", true);

  const rows: any[] = [];
  const perStore: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const s of stores ?? []) {
    // Retry a couple of times — the heavy RPC can hit a transient timeout.
    let cands: any = null; let error: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await admin.rpc("get_threeds_reprice_candidates", { p_channel: s.mintsoft_channel, p_days: lookback });
      cands = r.data; error = r.error;
      if (!error) break;
    }
    if (error) { perStore[s.store_name] = -1; errors[s.store_name] = error.message ?? String(error); continue; }
    const inBand = (cands ?? []).filter((c: any) => classifyBand(c.por_pct) === band);
    perStore[s.store_name] = inBand.length;
    for (const c of inBand) {
      rows.push({
        snapshot_date: londonDate, store_id: s.id, store_name: s.store_name, mintsoft_channel: s.mintsoft_channel,
        sku: c.sku, base_sku: c.base_sku, pack_size: c.pack_size, product_name: c.product_name, brand_name: c.brand_name,
        units_sold: c.units_sold, revenue: c.revenue, base_unit_cost: c.base_unit_cost, pack_cost_unit: c.pack_cost_unit,
        cost_total: c.cost_total, real_fee_rate: c.real_fee_rate, fees_total: c.fees_total, courier_total: c.courier_total,
        postage_unit: c.postage_unit, profit: c.profit, por_pct: c.por_pct, current_price: c.current_price, current_stock: c.current_stock,
      });
    }
  }

  // Replace today's snapshot.
  await admin.from("threeds_reprice_auto_snapshots").delete().eq("snapshot_date", londonDate);
  if (rows.length > 0) {
    await admin.from("threeds_reprice_auto_snapshots").insert(rows);
  }

  // Notify: drop a task (assigned to a super_user). Best-effort.
  let taskCreated = false;
  if (rows.length > 0) {
    const { data: su } = await admin.from("user_roles").select("user_id").eq("role", "super_user").limit(1).maybeSingle();
    const owner = su?.user_id ?? null;
    if (owner) {
      const acctCount = Object.values(perStore).filter((n) => n > 0).length;
      await admin.from("tasks").insert({
        created_by: owner, assigned_to: owner, task_type: "system_generated",
        title: `3D Reprice Auto-Report ready — ${rows.length} candidates`,
        description: `Daily ${band} → review across ${acctCount} account(s). Open 3D Reprice → Auto-Report.`,
        status: "todo", priority_level: 3, due_date: new Date().toISOString(),
        source_module: "threeds_reprice", source_rule: "auto_report_daily",
        tags: ["reprice", "auto-report", "3d"],
      });
      taskCreated = true;
    }
  }

  return json({ ok: true, date: londonDate, total: rows.length, perStore, errors, taskCreated, force });
});
