// ============================================================================
// ebay-token-health — daily (cron) expiry watch for eBay credentials.
// Refresh tokens last ~18 months; all five will be consented the same week, so they
// expire together. The signing key lasts 3 years. Emails Robert via Resend at
// 60 / 45 / 30 / 21 / 14 days and then daily from 7 days (90 days ahead for the signing
// key), and whenever an account's token_status is 'error' (refresh refused). Silent
// otherwise. Callers: service only (shared requireCaller).
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { requireCaller } from "../_shared/internal_auth.ts";

const FN = "ebay-token-health";
const TO = ["robert@kashyyyk.co.uk"];
const MILESTONES = new Set([90, 60, 45, 30, 21, 14]);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  const caller = await requireCaller(req, { fn: FN, trustGatewayServiceJwt: true });
  if (caller instanceof Response) return caller;
  let dryRun = false;
  try { dryRun = (await req.json())?.dryRun === true; } catch { /* no body */ }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: rows, error } = await supa.rpc("ebay_token_health", { p_warn_days: 60 });
  if (error) return json({ ok: false, error: error.message }, 500);
  const { data: broken } = await supa.from("ebay_accounts").select("code, last_error").eq("token_status", "error");

  const due = ((rows ?? []) as any[]).filter((r) =>
    r.status === "expired" || (r.days_left <= 7) ||
    (MILESTONES.has(r.days_left) && (r.kind === "signing_key" || r.days_left <= 60)));
  if (due.length === 0 && !(broken ?? []).length) return json({ ok: true, alerts: 0, checked: (rows ?? []).length });

  const html = `
    ${due.length ? `<p><b>eBay credentials expiring:</b></p><ul>${due.map((r) =>
      `<li>${esc(r.kind === "refresh_token" ? `Account ${r.account_code} refresh token` : `App signing key ${r.account_code}`)}:
       ${r.days_left <= 0 ? "<b>expired</b>" : `${esc(r.days_left)} days left`} (${esc(String(r.expires_at).slice(0, 10))})</li>`).join("")}</ul>
      <p>Refresh tokens: re-consent the account (a new consent link from ebay-oauth-start). Signing key: ebay-admin create_signing_key with force.</p>` : ""}
    ${(broken ?? []).length ? `<p><b>eBay refused the refresh token</b> (re-consent needed): ${
      (broken as any[]).map((b) => `${esc(b.code)} (${esc(b.last_error)})`).join(", ")}</p>` : ""}`;
  const subject = `⚠️ eBay connection: ${due.length + (broken ?? []).length} credential${due.length + (broken ?? []).length > 1 ? "s" : ""} need attention`;
  if (dryRun) return json({ ok: true, dryRun: true, subject, html });

  const sent = await new Resend(Deno.env.get("RESEND_API_KEY")).emails.send({
    from: "PartsDoc Hub <hub@partsdochub.com>", to: TO, subject, html,
  });
  return json({ ok: !sent.error, alerts: due.length, broken: (broken ?? []).length, resend_error: sent.error?.message ?? null });
});
