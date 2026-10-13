// ============================================================================
// job-health-alert — daily silent-failure check across ALL pg_cron jobs.
// Reads public.get_job_health() (real HTTP outcomes from public.cron_http_calls,
// cron.job_run_details for SQL jobs, expected window per schedule) and emails
// Robert via Resend when any job is stale (no real success within its window) or
// degraded (more failed runs than good ones in the last 24 h). Sends nothing when
// all jobs are healthy. Every check is logged in public.job_health_runs.
//
// Body: { dryRun?: boolean }  -> build the email and return it, but don't send.
// Auth: service key / service_role JWT only (cron).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TO = ["robert@kashyyyk.co.uk"];
const CALLER_FN = "job-health-alert";

function ctEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}
function serviceKeys(): string[] {
  const keys = [Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""];
  try {
    const s = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    for (const v of Object.values(s ?? {})) if (typeof v === "string") keys.push(v);
  } catch { /* not JSON — ignore */ }
  return keys.filter(Boolean);
}
function bearerRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role ?? null;
  } catch { return null; }
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (t: unknown) => (t ? new Date(String(t)).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "never");

type Row = {
  jobid: number; jobname: string; schedule: string; kind: string; tracked: boolean; max_gap: string;
  last_ok: string | null; last_attempt: string | null; last_outcome: string | null; last_detail: string | null;
  ok_24h: number; bad_24h: number; status: string;
};

function table(rows: Row[]): string {
  const cell = "padding:6px 10px;border:1px solid #ddd;vertical-align:top";
  const td = `style="${cell}"`;
  const tdMono = `style="${cell};font-family:monospace"`;
  const tdRight = `style="${cell};text-align:right"`;
  const th = 'style="padding:6px 10px;border:1px solid #ddd;text-align:left"';
  return `<table style="border-collapse:collapse;font-size:13px">
    <tr><th ${th}>Job</th><th ${th}>Schedule</th><th ${th}>Expected within</th><th ${th}>Last real success</th>
        <th ${th}>Last 24 h (ok / failed)</th><th ${th}>Last outcome</th></tr>
    ${rows.map((r) => `<tr>
      <td ${td}><span style="font-family:monospace">${esc(r.jobname)}</span> <span style="color:#888">#${esc(r.jobid)} · ${esc(r.kind)}${r.kind === "http" && !r.tracked ? " (outcome not tracked)" : ""}</span></td>
      <td ${tdMono}>${esc(r.schedule)}</td>
      <td ${td}>${esc(r.max_gap)}</td>
      <td ${td}>${esc(fmt(r.last_ok))}</td>
      <td ${tdRight}>${esc(r.ok_24h)} / ${esc(r.bad_24h)}</td>
      <td ${td}><b>${esc(r.last_outcome ?? "")}</b><div style="font-family:monospace;font-size:11px;color:#555;max-width:420px;white-space:pre-wrap">${esc(r.last_detail ?? "")}</div></td>
    </tr>`).join("")}
  </table>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const authed = !!bearer && (serviceKeys().some((k) => ctEqual(bearer, k)) || bearerRole(bearer) === "service_role");
  if (!authed) {
    console.warn(`[auth] ${CALLER_FN} rejected`);
    return json({ error: "Unauthorized" }, 401);
  }

  let dryRun = false;
  try { const b = await req.json(); dryRun = b?.dryRun === true; } catch { /* no body */ }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await supa.rpc("get_job_health");
  if (error) {
    await supa.from("job_health_runs").insert({ jobs: 0, stale: 0, degraded: 0, error: `get_job_health: ${error.message}` });
    return json({ ok: false, stage: "get_job_health", error: error.message }, 500);
  }
  const rows = (data ?? []) as Row[];
  const stale = rows.filter((r) => r.status === "stale");
  const degraded = rows.filter((r) => r.status === "degraded");
  const fresh = rows.filter((r) => r.status === "new");

  const detail = { stale: stale.map((r) => r.jobname), degraded: degraded.map((r) => r.jobname), new: fresh.map((r) => r.jobname) };
  if (stale.length === 0 && degraded.length === 0) {
    await supa.from("job_health_runs").insert({ jobs: rows.length, stale: 0, degraded: 0, emailed: false, detail });
    return json({ ok: true, jobs: rows.length, stale: 0, degraded: 0, emailed: false });
  }

  const subject = stale.length
    ? `⚠️ Hub: ${stale.length} scheduled job${stale.length > 1 ? "s" : ""} not running` + (degraded.length ? ` (+${degraded.length} failing)` : "")
    : `⚠️ Hub: ${degraded.length} scheduled job${degraded.length > 1 ? "s" : ""} failing most runs`;
  const html = `
    ${stale.length ? `<p><b>No successful run within the expected window:</b></p>${table(stale)}` : ""}
    ${degraded.length ? `<p style="margin-top:16px"><b>Running, but failing more often than not in the last 24 hours:</b></p>${table(degraded)}` : ""}
    <p style="color:#666;font-size:12px;margin-top:16px">
      "Real success" for HTTP jobs means the edge function answered 2xx without <code>ok:false</code>
      (public.cron_http_calls); for SQL jobs it is cron.job_run_details. ${rows.length} active jobs checked.
      Windows come from each schedule (public.cron_expected_gap) or public.job_health_overrides.
      This repeats daily until the job recovers.</p>`;

  if (dryRun) {
    await supa.from("job_health_runs").insert({ jobs: rows.length, stale: stale.length, degraded: degraded.length, emailed: false, detail: { ...detail, dryRun: true } });
    return json({ ok: true, dryRun: true, jobs: rows.length, stale: stale.length, degraded: degraded.length, subject, html });
  }

  const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
  const sent = await resend.emails.send({ from: "PartsDoc Hub <hub@partsdochub.com>", to: TO, subject, html });
  await supa.from("job_health_runs").insert({
    jobs: rows.length, stale: stale.length, degraded: degraded.length,
    emailed: !sent.error, resend_id: sent.data?.id ?? null, error: sent.error?.message ?? null, detail,
  });
  return json({
    ok: !sent.error, jobs: rows.length, stale: stale.length, degraded: degraded.length,
    emailed: !sent.error, resend_id: sent.data?.id ?? null, resend_error: sent.error?.message ?? null,
  });
});
