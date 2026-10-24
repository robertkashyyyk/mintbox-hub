// hub-job-doctor (2026-10-24) — one daily digest of what broke, what the Hub fixed
// itself, and what needs a human. Runs 07:20 Europe/London, before the existing 07:30 /
// 07:50 alerts (which it will replace after a 1-week parallel bake).
//
// Collect: public.job_doctor_collect() (24h failures from cron.job_run_details +
//   cron_http_calls, classified against public.job_failure_patterns) + the latest
//   supplier-feed-watchdog result.
// Retry: transient + retry_safe only, once per job per day (job_doctor_retries), via the
//   guarded public.job_doctor_refire() (which itself refuses anything not retry_safe).
// Track: public.job_doctor_open_issues holds first_seen/last_seen for non-transient
//   failures so "still broken from before" can show days-open; cleared when a job recovers.
// Email (Resend): Robert always; Clive when a supplier-feed/stock job is involved. Three
//   sections: Fixed itself / Needs you / Still broken from before. Nothing sent if empty.
// Body: { test?: true (email even if empty, to Robert only), dryRun?: true (no retry,
//   no email, just return the report) }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const env = (k: string) => Deno.env.get(k);
const resend = new Resend(env("RESEND_API_KEY"));
const FROM = "PartsDoc Hub <hub@partsdochub.com>";
const ROBERT = "robert@kashyyyk.co.uk";
const CLIVE = "clive@partsdoc.co.uk";
const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const isFeedJob = (j: string) => /klok|supplier|stock|ngk|feed/i.test(j);

const SUGGESTED: Record<string, string> = {
  structural: "Query exceeds its statement timeout — optimise it or raise the function-local statement_timeout; do not retry.",
  config: "Upstream/endpoint rejected the request (4xx) — check the endpoint, params or supplier data.",
  auth: "Missing/invalid auth — the cron is sending no/!valid Bearer, or the function flipped verify_jwt.",
  unknown: "Unrecognised failure — inspect the error and add a pattern to job_failure_patterns.",
};

Deno.serve(async (req) => {
  const startedAt = new Date();
  try {
    if (req.method === "OPTIONS") return new Response("ok");
    const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const test = body?.test === true;
    const dryRun = body?.dryRun === true;
    const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
    const todayStr = today.toISOString().slice(0, 10);

    const { data: rows, error: collectErr } = await supabase.rpc("job_doctor_collect");
    if (collectErr) throw new Error(`collect failed: ${collectErr.message}`);
    const failures: Array<{ jobname: string; kind: string; status_code: number | null; last_error: string; class: string; auto_action: string; retry_safe: boolean }> = rows ?? [];

    // watchdog: most recent supplier-feed-watchdog result (its own alerts)
    let watchdogAlerts: Array<{ label: string; kind: string; detail: string }> = [];
    try {
      const { data: wd } = await supabase.from("edge_function_runs").select("details, status")
        .eq("function_name", "supplier-feed-watchdog").order("ended_at", { ascending: false }).limit(1).maybeSingle();
      watchdogAlerts = ((wd?.details as any)?.alerts ?? []) as Array<{ label: string; kind: string; detail: string }>;
    } catch { /* ignore */ }

    const fixedItself: Array<{ jobname: string; cls: string; result: string }> = [];
    const skippedAlreadySent: string[] = [];
    const currentFlagJobs: string[] = [];

    for (const f of failures) {
      if (f.auto_action === "retry" && f.retry_safe) {
        // once per job per day
        const { data: already } = await supabase.from("job_doctor_retries")
          .select("id").eq("run_date", todayStr).eq("jobname", f.jobname).maybeSingle();
        if (already) { continue; }
        // Report dedup: skip the retry if a real SENT record already exists for this
        // period (ai_reports for orin-*, ops_report_log for weekly-ops). This catches the
        // case that matters — a run that emailed and THEN errored (no ok cron call, but the
        // report did go out). Jobs with no sent record are retry_safe=false, so never reach
        // here; weekly-missing-cost-list self-guards on is_new.
        const { data: sentAlready } = await supabase.rpc("job_doctor_report_sent", { p_jobname: f.jobname });
        if (sentAlready === true) {
          skippedAlreadySent.push(f.jobname);
          if (!dryRun) await supabase.from("job_doctor_retries").insert({ run_date: todayStr, jobname: f.jobname, classified_as: f.class, original_error: f.last_error, retry_fired: false, retry_result: "skipped: sent record already exists for this period" }).then(() => {}, () => {});
          continue;
        }
        let result = "skipped (dry-run)";
        if (!dryRun) {
          const { data: rr, error: rerr } = await supabase.rpc("job_doctor_refire", { p_jobname: f.jobname });
          result = rerr ? `error: ${rerr.message}` : String(rr);
          await supabase.from("job_doctor_retries").insert({ run_date: todayStr, jobname: f.jobname, classified_as: f.class, original_error: f.last_error, retry_fired: result === "refired", retry_result: result }).then(() => {}, () => {});
        }
        fixedItself.push({ jobname: f.jobname, cls: f.class, result });
      } else {
        // non-retryable (flag) OR transient-but-not-retry_safe → needs a human
        currentFlagJobs.push(f.jobname);
        if (!dryRun) {
          const { data: ex } = await supabase.from("job_doctor_open_issues").select("jobname, first_seen").eq("jobname", f.jobname).maybeSingle();
          if (ex) {
            await supabase.from("job_doctor_open_issues").update({ last_seen: todayStr, class: f.class, last_error: f.last_error, resolved: false, resolved_at: null, updated_at: new Date().toISOString() }).eq("jobname", f.jobname).then(() => {}, () => {});
          } else {
            await supabase.from("job_doctor_open_issues").insert({ jobname: f.jobname, class: f.class, last_error: f.last_error, first_seen: todayStr, last_seen: todayStr }).then(() => {}, () => {});
          }
        }
      }
    }

    // recover: any previously-open issue not failing now → mark resolved
    if (!dryRun) {
      const { data: openRows } = await supabase.from("job_doctor_open_issues").select("jobname").eq("resolved", false);
      for (const o of (openRows ?? [])) {
        if (!currentFlagJobs.includes(o.jobname)) {
          await supabase.from("job_doctor_open_issues").update({ resolved: true, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("jobname", o.jobname).then(() => {}, () => {});
        }
      }
    }

    // read back open issues for the two human sections
    const { data: openNow } = await supabase.from("job_doctor_open_issues").select("*").eq("resolved", false).in("jobname", currentFlagJobs.length ? currentFlagJobs : ["__none__"]);
    const needsYou = (openNow ?? []).filter((o) => o.first_seen === todayStr);
    const stillBroken = (openNow ?? []).filter((o) => o.first_seen < todayStr)
      .map((o) => ({ ...o, days_open: Math.max(1, Math.round((Date.parse(todayStr) - Date.parse(o.first_seen)) / 86400000)) }));

    const nothing = fixedItself.length === 0 && needsYou.length === 0 && stillBroken.length === 0 && watchdogAlerts.length === 0;

    let emailed = false;
    if (!dryRun && (!nothing || test)) {
      const sec = (title: string, inner: string) => `<h3 style="margin:16px 0 4px">${title}</h3>${inner}`;
      const fixedHtml = fixedItself.length
        ? `<ul>${fixedItself.map((r) => `<li><b>${h(r.jobname)}</b> (${h(r.cls)}) → re-fired: ${h(r.result)}</li>`).join("")}</ul>`
        : "<p style='color:#888;margin:2px 0'>Nothing.</p>";
      const needsHtml = (needsYou.length || watchdogAlerts.length)
        ? `<ul>${needsYou.map((o) => `<li><b>${h(o.jobname)}</b> — ${h(o.class)}: ${h(SUGGESTED[o.class] ?? "")}<br><span style="color:#777;font-size:12px">${h(String(o.last_error ?? "").slice(0,200))}</span></li>`).join("")
            + watchdogAlerts.map((a) => `<li><b>Supplier feed: ${h(a.label)}</b> — ${h(a.kind)}: ${h(a.detail)}</li>`).join("")}</ul>`
        : "<p style='color:#888;margin:2px 0'>Nothing.</p>";
      const stillHtml = stillBroken.length
        ? `<ul>${stillBroken.map((o: any) => `<li><b>${h(o.jobname)}</b> — ${h(o.class)}, <b>${o.days_open}d open</b>: ${h(SUGGESTED[o.class] ?? "")}</li>`).join("")}</ul>`
        : "<p style='color:#888;margin:2px 0'>Nothing.</p>";
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
        <h2 style="margin:0 0 6px">Hub job doctor — ${todayStr}</h2>
        <p style="margin:0 0 8px;color:#555">Daily digest of scheduled-job health. ${nothing ? "All clear (test send)." : ""}</p>
        ${sec("✅ Fixed itself", fixedHtml)}
        ${sec("⚠ Needs you", needsHtml)}
        ${sec("⏳ Still broken from before", stillHtml)}
        <p style="margin:14px 0 0;color:#999;font-size:12px">Parallel-running alongside the existing alerts for one week, then those retire. Checked ${startedAt.toISOString().slice(0,16)}Z.</p></div>`;
      const involvesFeed = [...fixedItself.map((f) => f.jobname), ...currentFlagJobs].some(isFeedJob) || watchdogAlerts.length > 0;
      const to = test ? [ROBERT] : (involvesFeed ? [ROBERT, CLIVE] : [ROBERT]);
      const subject = nothing ? "Hub job doctor — all clear (test)" : `Hub job doctor — ${needsYou.length + stillBroken.length + watchdogAlerts.length} need(s) you, ${fixedItself.length} auto-fixed`;
      const sent = await resend.emails.send({ from: FROM, to, replyTo: [ROBERT, CLIVE], subject, html });
      emailed = !sent.error;
    }

    const result = { dryRun, test, today: todayStr, fixed_itself: fixedItself, skipped_already_sent: skippedAlreadySent, needs_you: needsYou.map((o) => o.jobname), still_broken: (stillBroken as any[]).map((o) => ({ jobname: o.jobname, days_open: o.days_open })), watchdog_alerts: watchdogAlerts.length, emailed };
    if (!dryRun) await supabase.from("edge_function_runs").insert({ function_name: "hub-job-doctor", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: nothing ? "ok" : "alert", message: nothing ? "all clear" : `${fixedItself.length} fixed, ${needsYou.length + stillBroken.length} open`, details: result }).then(() => {}, () => {});
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
