// ============================================================================
// amazon-cron-health-alert — emails Robert when any amazon-* pg_cron job has
// failed two nights running (per public.amazon_cron_health_failing(): latest
// run failed, no success in 36h, failures spanning >=2 distinct days).
// Invoked daily at 07:30 by cron job amazon-cron-health-check.
//
// Body: { to?: string[] }  -> override recipients (default robert@kashyyyk.co.uk)
// Sends nothing when no job qualifies. Built after amazon-nightly-refresh
// failed silently for 8 nights (mv_profit_band_history drop, Oct 2026).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const DEFAULT_TO = ["robert@kashyyyk.co.uk"];

function jwtRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded))?.role ?? null;
  } catch {
    return null;
  }
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const authed = !!bearer && (bearer === SERVICE_KEY || jwtRole(bearer) === "service_role");
  if (!authed) return json({ error: "Unauthorized" }, 401);

  let input: { to?: string[] } = {};
  try {
    input = req.method === "POST" ? await req.json() : {};
  } catch {
    input = {};
  }
  const toList = Array.isArray(input?.to) && input.to.length ? input.to : DEFAULT_TO;

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: failing, error } = await supa.rpc("amazon_cron_health_failing");
  if (error) return json({ error: "health RPC failed", detail: error.message }, 500);

  if (!failing || failing.length === 0) {
    return json({ ok: true, failing: 0, emailed: false });
  }

  const rows = (failing as Array<Record<string, unknown>>)
    .map(
      (f) => `<tr>
        <td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace">${esc(f.jobname)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd">${esc(f.schedule)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd">${esc(f.last_success ?? "never")}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${esc(f.fail_days)}</td>
        <td style="padding:6px 10px;border:1px solid #ddd;font-family:monospace;font-size:12px">${esc(f.latest_error)}</td>
      </tr>`,
    )
    .join("");

  const html = `
    <p>These Amazon pipeline cron jobs have failed on two or more consecutive days
    with no success in the last 36 hours:</p>
    <table style="border-collapse:collapse;font-size:13px">
      <tr>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Job</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Schedule</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Last success</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Days failing</th>
        <th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Latest error</th>
      </tr>
      ${rows}
    </table>
    <p style="color:#666;font-size:12px">Check cron.job_run_details in Supabase for full history.
    This alert repeats daily until the job succeeds again.</p>`;

  const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
  const sent = await resend.emails.send({
    from: "PartsDoc Hub <hub@partsdochub.com>",
    to: toList,
    subject: `⚠️ Amazon cron failing ${failing.length > 1 ? `(${failing.length} jobs)` : `: ${(failing[0] as any).jobname}`}`,
    html,
  });

  return json({
    ok: !sent.error,
    failing: failing.length,
    emailed: !sent.error,
    resend_id: sent.data?.id ?? null,
    resend_error: sent.error?.message ?? null,
  });
});
