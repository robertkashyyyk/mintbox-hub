// Weekly Missing-Cost worklist runner.
//
// Fired hourly on Mondays by pg_cron. Following the house DST-safe pattern, the
// cron fires often and THIS function decides whether it's the configured London
// run-hour. On the first qualifying fire each week it generates the top-N
// missing-cost list (by sales velocity) and emails the notify list — once.
//
// Body (all optional): { force?: boolean, test?: boolean, test_email?: string }
//   force      - bypass the Monday/run-hour gate (manual trigger)
//   test       - generate as normal but email ONLY test_email; never marks the
//                run as emailed, so the real Monday send still happens
//   test_email - recipient for a test send
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM = "PartsDoc Hub <noreply@partsdochub.com>";
const DEFAULT_RECIPIENTS = [
  "accounts@partsdoc.co.uk",
  "clive@partsdoc.co.uk",
  "steven@partsdoc.co.uk",
];
const DEFAULT_RUN_HOUR = 10;
const LIST_URL = "https://partsdochub.com/intelligence/missing-costs";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function londonNow(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  return { weekday, hour };
}

async function readSetting<T>(admin: any, key: string, fallback: T): Promise<T> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return v == null ? fallback : (v as T);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: { force?: boolean; test?: boolean; test_email?: string } = {};
  try {
    body = await req.json();
  } catch {
    // no body — treated as a scheduled fire
  }
  const isTest = body.test === true;
  const force = body.force === true || isTest;

  const runHour = await readSetting<number>(admin, "weekly_missing_costs.run_hour", DEFAULT_RUN_HOUR);
  const { weekday, hour } = londonNow(new Date());

  // Gate: only run on Mondays at/after the configured London hour (unless forced).
  if (!force && (weekday !== "Monday" || hour < runHour)) {
    return json({ skipped: true, reason: `not the run window (London ${weekday} ${hour}:00, want Monday >=${runHour}:00)` });
  }

  // Generate (or fetch existing) this week's list.
  const { data: genRows, error: genErr } = await admin.rpc("generate_weekly_missing_cost_list", { p_limit: 50 });
  if (genErr) return json({ error: `generate failed: ${genErr.message}` }, 500);
  const gen = Array.isArray(genRows) ? genRows[0] : genRows;
  const weekStart: string = gen?.week_start;
  const itemCount: number = gen?.item_count ?? 0;

  // Has this run already been emailed?
  const { data: runRow } = await admin
    .from("weekly_missing_cost_runs")
    .select("email_sent_at")
    .eq("week_start", weekStart)
    .maybeSingle();
  const alreadyEmailed = !!runRow?.email_sent_at;

  if (itemCount === 0) {
    return json({ week_start: weekStart, item_count: 0, emailed: false, note: "nothing to email" });
  }
  if (alreadyEmailed && !isTest) {
    return json({ week_start: weekStart, item_count: itemCount, emailed: false, note: "already emailed this week" });
  }

  // Build a small preview (top 5) for the email.
  const { data: preview } = await admin
    .from("weekly_missing_cost_items")
    .select("rank, sku, name, velocity_per_week")
    .eq("week_start", weekStart)
    .order("rank")
    .limit(5);

  const rows = (preview ?? [])
    .map((p: any) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace">${p.sku}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${(p.name ?? "").slice(0, 48)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${Number(p.velocity_per_week).toFixed(1)}/wk</td></tr>`)
    .join("");

  const prettyWeek = new Date(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
    <div style="background:#0f766e;color:#fff;padding:18px 20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">Weekly Missing-Cost list is ready</h2>
      <p style="margin:6px 0 0;opacity:.9">Week of ${prettyWeek}</p>
    </div>
    <div style="padding:20px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
      <p>This week's run has landed: <strong>${itemCount} best-selling SKUs</strong> that still have no cost price.
      Entering these has the biggest impact on our profit data — they're the fastest movers we're currently blind on.</p>
      <p style="margin:16px 0 6px;font-weight:bold">Top of the list</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#f5f5f5"><th style="padding:6px 10px;text-align:left">SKU</th><th style="padding:6px 10px;text-align:left">Product</th><th style="padding:6px 10px;text-align:right">Velocity</th></tr>
        ${rows}
      </table>
      <p style="margin:22px 0">
        <a href="${LIST_URL}" style="background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Open the Weekly List →</a>
      </p>
      <p style="color:#666;font-size:13px">Click in, enter a cost against each SKU and hit <em>Send to Mintsoft</em>. Items drop off the list as they're done.</p>
    </div>
    ${isTest ? `<p style="color:#b45309;font-size:12px;text-align:center">⚠️ TEST send — the real Monday notification is unaffected.</p>` : ""}
  </div>`;

  const recipients = isTest
    ? [body.test_email].filter(Boolean) as string[]
    : await readSetting<string[]>(admin, "weekly_missing_costs.recipients", DEFAULT_RECIPIENTS);

  if (recipients.length === 0) return json({ error: "no recipients" }, 400);

  const sent = await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `Weekly Missing-Cost list ready — ${itemCount} SKUs (week of ${new Date(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})${isTest ? " [TEST]" : ""}`,
    html,
  });

  // Only stamp the real send so a test never suppresses Monday's email.
  if (!isTest) {
    await admin.from("weekly_missing_cost_runs").update({ email_sent_at: new Date().toISOString() }).eq("week_start", weekStart);
  }

  return json({ week_start: weekStart, item_count: itemCount, emailed: true, test: isTest, recipients, resend_id: (sent as any)?.data?.id ?? null });
});
