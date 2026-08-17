// Weekly "in stock, not listed on eBay" opportunities email.
//
// Fired hourly on Tuesdays by pg_cron. Following the house DST-safe pattern, the
// cron fires often and THIS function decides whether it's the configured London
// run-hour. On the first qualifying fire each week it emails Clive & Jon the
// unlisted-in-stock opportunities digest + week-over-week progress — once.
//
// Uses run_weekly_unlisted(min_capital, write): totals + top10 + progress, and
// (on a real send) snapshots this week's set so next week can show what got listed.
//
// Body (all optional): { force?, test?, test_email? }
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FROM = "PartsDoc Hub <noreply@partsdochub.com>";
const DEFAULT_RECIPIENTS = ["jon@partsdoc.co.uk", "clive@partsdoc.co.uk", "clivejardine@me.com"];
const DEFAULT_RUN_HOUR = 9;
const RUN_WEEKDAY = "Tuesday";
const DEFAULT_MIN_CAPITAL = 25;
const LIST_URL = "https://partsdochub.com/decisions/coverage";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function londonNow(d) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), hour: parseInt(get("hour") || "0", 10), dateKey: `${get("year")}-${get("month")}-${get("day")}` };
}

async function readSetting(admin, key, fallback) {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  const v = data?.value;
  return v == null ? fallback : v;
}

const gbp = (n) => "£" + Math.round(Number(n) || 0).toLocaleString("en-GB");
const shortDate = (s) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  let body = {};
  try { body = await req.json(); } catch { /* scheduled fire */ }
  const isTest = body.test === true;
  const force = body.force === true || isTest;

  const runHour = await readSetting(admin, "weekly_unlisted.run_hour", DEFAULT_RUN_HOUR);
  const minCapital = await readSetting(admin, "weekly_unlisted.min_capital", DEFAULT_MIN_CAPITAL);
  const { weekday, hour, dateKey } = londonNow(new Date());

  if (!force && (weekday !== RUN_WEEKDAY || hour < runHour)) {
    return json({ skipped: true, reason: `not the run window (London ${weekday} ${hour}:00, want ${RUN_WEEKDAY} >=${runHour}:00)` });
  }
  const lastSent = await readSetting(admin, "weekly_unlisted.last_sent_week", null);
  if (!isTest && lastSent === dateKey) return json({ skipped: true, reason: "already sent today", date: dateKey });

  // One-pass: totals + top10 + progress. Write the snapshot only on a real send.
  const { data: d, error: rErr } = await admin.rpc("run_weekly_unlisted", { p_min_capital: minCapital, p_write: !isTest });
  if (rErr) return json({ error: `run failed: ${rErr.message}` }, 500);
  const totalSkus = d?.total_skus ?? 0;
  if (totalSkus === 0) return json({ total_skus: 0, emailed: false, note: "nothing to email" });

  const top = Array.isArray(d?.top) ? d.top : [];
  const rows = top.map((t) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace">${t.sku}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${(t.name ?? "").slice(0, 48)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${Number(t.stock).toLocaleString("en-GB")}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${gbp(t.capital)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${Number(t.sold90) > 0 ? Number(t.sold90) : "—"}</td>
    </tr>`).join("");

  const pg = d?.progress ?? {};
  const progressHtml = pg.prev_date
    ? `<div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:6px;padding:12px 14px;margin:0 0 18px;font-size:13px;color:#065f46">
        <strong>Progress since ${shortDate(pg.prev_date)}:</strong>
        ${Number(pg.now_listed) > 0
          ? `${pg.now_listed} of last week's flagged SKUs ${Number(pg.now_listed) === 1 ? "is" : "are"} now listed on eBay — ${gbp(pg.now_listed_capital)} of capital unlocked. Nice work.`
          : `none of last week's flagged SKUs have been listed yet.`}
        ${Number(pg.newly_flagged) > 0 ? ` ${pg.newly_flagged} newly flagged this week.` : ``}
      </div>`
    : `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:12px 14px;margin:0 0 18px;font-size:13px;color:#1e3a8a">
        This is the first weekly run — from next Tuesday you'll see how many of these have been listed since.
      </div>`;

  const prettyWeek = new Date(dateKey).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#333">
    <div style="background:#0f766e;color:#fff;padding:18px 20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">In stock, not listed on eBay — this week's opportunities</h2>
      <p style="margin:6px 0 0;opacity:.9">Week of ${prettyWeek}</p>
    </div>
    <div style="padding:20px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
      ${progressHtml}
      <p>The Hub has compared everything we hold in stock against our live eBay listing coverage (all 5 UK stores, refreshed nightly). This week it's flagging:</p>
      <ul style="line-height:1.7">
        <li><strong>${totalSkus.toLocaleString("en-GB")} SKUs in stock with no active eBay listing</strong></li>
        <li><strong>${gbp(d.total_capital)} of stock capital</strong> sitting idle with nothing to sell against</li>
        <li><strong>${Number(d.sold_90d).toLocaleString("en-GB")} of them have still sold in the last 90 days</strong> — proven demand, listed nowhere</li>
      </ul>
      <p style="margin:16px 0 6px;font-weight:bold">Top of the list (by capital tied up)</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr style="background:#f5f5f5">
          <th style="padding:6px 10px;text-align:left">SKU</th>
          <th style="padding:6px 10px;text-align:left">Product</th>
          <th style="padding:6px 10px;text-align:right">Stock</th>
          <th style="padding:6px 10px;text-align:right">Capital</th>
          <th style="padding:6px 10px;text-align:right">Sold 90d</th>
        </tr>
        ${rows}
      </table>
      <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px;padding:12px 14px;margin:20px 0;font-size:13px;color:#134e4a">
        <strong>This is what the Hub is flagging, and I'm genuinely happy to be proved wrong.</strong>
        Some of these will be dirt/duplicate SKUs, bundle components that don't sell singly, lines we've
        deliberately not relisted, or things already listed under a different SKU the match doesn't catch.
        Treat it as a prompt to check, not a to-do list — anything that shouldn't be here can be dismissed
        straight off it <em>with a reason</em> (e.g. "won't sell as a single"), so it stays off and we know why.
      </div>
      <p style="margin:22px 0">
        <a href="${LIST_URL}" style="background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Open the full list →</a>
      </p>
    </div>
    ${isTest ? `<p style="color:#b45309;font-size:12px;text-align:center">⚠️ TEST send — the real Tuesday email is unaffected.</p>` : ""}
  </div>`;

  const recipients = isTest
    ? [body.test_email].filter(Boolean)
    : await readSetting(admin, "weekly_unlisted.recipients", DEFAULT_RECIPIENTS);
  if (recipients.length === 0) return json({ error: "no recipients" }, 400);

  const sent = await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `In stock, not listed on eBay — ${totalSkus} opportunities (${gbp(d.total_capital)})${isTest ? " [TEST]" : ""}`,
    html,
  });

  if (!isTest) await admin.from("app_settings").upsert({ key: "weekly_unlisted.last_sent_week", value: dateKey });

  return json({ date: dateKey, total_skus: totalSkus, progress: pg, emailed: true, test: isTest, recipients, resend_id: sent?.data?.id ?? null });
});
