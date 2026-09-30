// Weekly Friday ops-checklist reminder to Steven.
//
// Fired hourly on Fridays by pg_cron; DST-safe (fn gates on London Friday >= run-hour,
// once/week). Reminds Steven of his three recurring Friday jobs:
//   a. Log the eBay Stats ODR   b. Log the Response Times   c. Do the 3D Import
// 3D import cadence: the smaller import every week; the LARGER one every 4 weeks.
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
const DEFAULT_RECIPIENTS = ["steven@partsdoc.co.uk"];
const DEFAULT_RUN_HOUR = 11;         // 11:00 London
const RUN_WEEKDAY = "Friday";
// 4-week cadence anchor (a Monday). Large 3D-import week = every 4th week from here.
const LARGE_ANCHOR = Date.UTC(2026, 0, 5); // Mon 5 Jan 2026
const HUB_URL = "https://partsdochub.com";

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  let body = {};
  try { body = await req.json(); } catch { /* scheduled fire */ }
  const isTest = body.test === true;
  const force = body.force === true || isTest;

  const runHour = await readSetting(admin, "weekly_friday_ops.run_hour", DEFAULT_RUN_HOUR);
  const { weekday, hour, dateKey } = londonNow(new Date());

  if (!force && (weekday !== RUN_WEEKDAY || hour < runHour)) {
    return json({ skipped: true, reason: `not the run window (London ${weekday} ${hour}:00, want ${RUN_WEEKDAY} >=${runHour}:00)` });
  }
  const lastSent = await readSetting(admin, "weekly_friday_ops.last_sent_week", null);
  if (!isTest && lastSent === dateKey) return json({ skipped: true, reason: "already sent today", date: dateKey });

  // Is this a "large 3D import" week? (every 4th week from the anchor)
  const weeksSince = Math.floor((Date.parse(dateKey + "T00:00:00Z") - LARGE_ANCHOR) / (7 * 86_400_000));
  const largeWeek = ((weeksSince % 4) + 4) % 4 === 0;

  const importLine = largeWeek
    ? `<strong>Both</strong> the weekly smaller import <strong>and</strong> the <strong>larger 4-weekly import</strong> — this is a 4-week week.`
    : `The <strong>weekly smaller import</strong>.`;

  const prettyDate = new Date(dateKey).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const html = `
  <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333">
    <div style="background:#0f766e;color:#fff;padding:18px 20px;border-radius:8px 8px 0 0">
      <h2 style="margin:0">Friday ops checklist</h2>
      <p style="margin:6px 0 0;opacity:.9">${prettyDate}</p>
    </div>
    <div style="padding:20px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
      <p>Morning Steven — three jobs to slot into today:</p>
      <ol style="line-height:1.9;font-size:15px">
        <li><strong>Log the eBay Stats — ODR</strong> (cases / LDR / CCWSR / TDR) into the Hub</li>
        <li><strong>Log the Response Times</strong> (open messages at 7 / 14 / 30 days)</li>
        <li><strong>Do the 3D Import</strong> — ${importLine}</li>
      </ol>
      <p style="margin:22px 0">
        <a href="${HUB_URL}" style="background:#0f766e;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block">Open the Hub →</a>
      </p>
      <p style="color:#666;font-size:12px">Automated reminder — logging the ODR & response-time stats keeps the trends in the weekly Orin report accurate.</p>
    </div>
    ${isTest ? `<p style="color:#b45309;font-size:12px;text-align:center">⚠️ TEST send — the real Friday reminder is unaffected.</p>` : ""}
  </div>`;

  const recipients = isTest
    ? [body.test_email].filter(Boolean)
    : await readSetting(admin, "weekly_friday_ops.recipients", DEFAULT_RECIPIENTS);
  if (recipients.length === 0) return json({ error: "no recipients" }, 400);

  const sent = await resend.emails.send({
    from: FROM,
    to: recipients,
    subject: `Friday ops checklist — ODR, response times${largeWeek ? " & the 4-weekly 3D import" : " & 3D import"}${isTest ? " [TEST]" : ""}`,
    html,
  });

  if (!isTest) await admin.from("app_settings").upsert({ key: "weekly_friday_ops.last_sent_week", value: dateKey });

  return json({ date: dateKey, largeWeek, emailed: true, test: isTest, recipients, resend_id: sent?.data?.id ?? null });
});
