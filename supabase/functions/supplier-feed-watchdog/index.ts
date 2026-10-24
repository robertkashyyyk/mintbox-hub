// supplier-feed-watchdog — daily health check for every stock supplier feed. Emails
// Clive + Robert if a feed ERRORED or wasn't RECEIVED/applied within its expected window.
// v3 (2026-08-31): replyTo=team inbox (replies to hub@partsdochub.com bounce — send-only). v2: "last applied" now also counts the most recent run that actually wrote
// stock (edge_function_runs written>0), not only the processed-messages marker — so a
// fragile mark-processed write can't produce a false NO-FEED alarm while the feed is
// genuinely applying. Generic across feeds; add rows to FEEDS.
//
// v4 (2026-10-24): the "last wrote" fallback now looks back by TIME (ended_at >= now() -
// staleHours), not by a fixed 40-row window. klokkerholm-ingest runs hourly but only
// writes on a fresh report (every 3–4 days), so the writing run fell outside the last 40
// rows and last_wrote came back null → false NO-FEED alarm. A time window always catches
// the writing run if it happened inside the feed's staleHours.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";

const env = (k: string) => Deno.env.get(k);
const resend = new Resend(env("RESEND_API_KEY"));
const TO = ["clive@partsdoc.co.uk", "robert@kashyyyk.co.uk"];
const FROM = "PartsDoc Hub <hub@partsdochub.com>";

const FEEDS = [
  { supplier: "NGK", label: "NGK", runType: "supplier-feed-ngk-cron", fn: "sync-supplier-feed", staleHours: 48, receipt: "agent" },
  { supplier: "KKH", label: "Klokkerholm", runType: "klokkerholm-ingest-cron", fn: "klokkerholm-ingest", staleHours: 96, receipt: "processed" },
];

const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const ms = (t: string | null) => (t ? new Date(t).getTime() : 0);

Deno.serve(async (req) => {
  const startedAt = new Date();
  try {
    if (req.method === "OPTIONS") return new Response("ok");
    const supabase = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!);
    const force = (await req.json().catch(() => ({})))?.test === true;
    const now = Date.now();
    const alerts: Array<{ label: string; kind: string; detail: string }> = [];
    const statusRows: Array<Record<string, unknown>> = [];

    for (const f of FEEDS) {
      // (a) most recent run error
      const { data: er } = await supabase.from("edge_function_runs").select("status, message, details, ended_at")
        .eq("function_name", f.fn).order("ended_at", { ascending: false }).limit(1).maybeSingle();
      if (er && er.status === "error") {
        const d: any = er.details ?? {};
        alerts.push({ label: f.label, kind: "ERROR", detail: `last run errored (${er.message ?? "error"})${d.error ? ": " + d.error : ""}${d.note ? " — " + d.note : ""}` });
      }
      // (b) last APPLIED = max of the receipt marker AND the most recent run that actually wrote stock
      let receiptTs: string | null = null;
      if (f.receipt === "processed") {
        const { data } = await supabase.from("supplier_feed_processed_messages").select("processed_at").eq("supplier", f.supplier).order("processed_at", { ascending: false }).limit(1).maybeSingle();
        receiptTs = data?.processed_at ?? null;
      } else {
        const { data } = await supabase.from("agent_runs").select("finished_at").eq("run_type", f.runType).eq("status", "complete").order("finished_at", { ascending: false }).limit(1).maybeSingle();
        receiptTs = data?.finished_at ?? null;
      }
      // robust fallback: most recent edge_function_run for this fn that wrote >0, looked up
      // by TIME window (not a fixed row count) so an hourly feed's infrequent writing run
      // is still found within its staleHours.
      let wroteTs: string | null = null;
      const sinceTs = new Date(now - f.staleHours * 3.6e6).toISOString();
      const { data: wrote } = await supabase.from("edge_function_runs").select("ended_at, details")
        .eq("function_name", f.fn).gte("ended_at", sinceTs).order("ended_at", { ascending: false });
      for (const r of (wrote ?? [])) {
        const d: any = r.details ?? {};
        const w = Number(d.written ?? d?.[f.supplier]?.written ?? 0);
        if (w > 0) { wroteTs = r.ended_at; break; }
      }
      const lastApplied = ms(receiptTs) >= ms(wroteTs) ? receiptTs : wroteTs;
      const ageH = lastApplied ? (now - ms(lastApplied)) / 3.6e6 : Infinity;
      if (ageH > f.staleHours) {
        alerts.push({ label: f.label, kind: "NO FEED", detail: lastApplied ? `no feed applied for ${Math.round(ageH)}h (limit ${f.staleHours}h) — last ${new Date(lastApplied).toISOString().slice(0, 16)}Z` : "never applied / no record" });
      }
      statusRows.push({ feed: f.label, last_applied: lastApplied, age_hours: Number.isFinite(ageH) ? Math.round(ageH) : null, receipt_marker: receiptTs, last_wrote: wroteTs, last_run_status: er?.status ?? null, last_run_message: er?.message ?? null });
    }

    let emailed = false;
    if (alerts.length || force) {
      const rows = alerts.length
        ? alerts.map((a) => `<tr><td style="padding:6px 12px;border:1px solid #ddd"><b>${h(a.label)}</b></td><td style="padding:6px 12px;border:1px solid #ddd;color:#b00">${h(a.kind)}</td><td style="padding:6px 12px;border:1px solid #ddd">${h(a.detail)}</td></tr>`).join("")
        : `<tr><td colspan="3" style="padding:6px 12px;border:1px solid #ddd">All feeds healthy (test send).</td></tr>`;
      const suppliersInAlert = [...new Set(alerts.map((a) => a.label))].join(", ");
      const subject = alerts.length ? `⚠ Error with supplier feed: ${suppliersInAlert}` : "Supplier feed watchdog — test (all healthy)";
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px">
        <h2 style="margin:0 0 8px">${alerts.length ? "Supplier feed problem detected" : "Supplier feed watchdog test"}</h2>
        <p style="margin:0 0 12px;color:#555">Automated daily check of the stock supplier feeds. ${alerts.length ? "One or more feeds need attention:" : ""}</p>
        <table style="border-collapse:collapse;margin:8px 0"><thead><tr>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Feed</th>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Issue</th>
          <th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Detail</th></tr></thead><tbody>${rows}</tbody></table>
        <p style="margin:12px 0 0;color:#888;font-size:12px">Checked ${startedAt.toISOString().slice(0, 16)}Z. Feeds monitored: ${FEEDS.map((f) => f.label).join(", ")}.</p></div>`;
      const sent = await resend.emails.send({ from: FROM, to: force ? ["robert@kashyyyk.co.uk"] : TO, replyTo: TO, subject, html });
      emailed = !sent.error;
    }

    const result = { alerts, emailed, status: statusRows };
    await supabase.from("edge_function_runs").insert({ function_name: "supplier-feed-watchdog", started_at: startedAt.toISOString(), ended_at: new Date().toISOString(), status: alerts.length ? "alert" : "ok", message: alerts.length ? `${alerts.length} alert(s)` : "healthy", details: result }).then(() => {}, () => {});
    return new Response(JSON.stringify(result, null, 2), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }, null, 2), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
