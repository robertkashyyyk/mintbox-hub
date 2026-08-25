// late-skus-weekly-email — weekly digest of the worst late-despatch SKUs.
// Calls get_late_despatch_skus and emails Steven & Clive an inline table + a CSV
// attachment (the same list downloadable on the Despatch KPIs page).
// Body: { test?: true (robert only), to?: string[] (override recipients), days?: 30, sla?: 48, limit?: 200, cc?: string[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const REAL = ["steven@partsdoc.co.uk", "clive@partsdoc.co.uk", "clivejardine@me.com"];
const TEST = ["robert@kashyyyk.co.uk"];
const PAGE = "https://partsdochub.com/operations/despatch-kpis";
const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const esc = (v: unknown) => { const t = String(v ?? ""); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = await req.json().catch(() => ({} as any));
  const isTest = body?.test === true;
  const toOverride: string[] | null = Array.isArray(body?.to) && body.to.length ? body.to : null;
  const days = Number.isFinite(+body?.days) ? +body.days : 30;
  const sla = Number.isFinite(+body?.sla) ? +body.sla : 48;
  const limit = Number.isFinite(+body?.limit) ? +body.limit : 200;
  const cc: string[] = Array.isArray(body?.cc) ? body.cc : [];
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  const { data, error } = await supabase.rpc("get_late_despatch_skus", {
    from_date: d(from), to_date: d(to), sla_hours: sla, limit_n: limit,
  });
  if (error) return json({ ok: false, stage: "rpc", error: error.message }, 500);
  const rows = (data ?? []) as any[];

  const csv = [
    ["SKU", "Product", "Brand", "LateOrders", "AvgHours", "WorstHours"].join(","),
    ...rows.map((r) => [r.sku, r.product_name ?? "", r.brand_name ?? "", r.late_orders, r.avg_hours, r.worst_hours].map(esc).join(",")),
  ].join("\n") + "\n";
  const filename = `late-skus-over${sla}h-${days}d-${d(to)}.csv`;

  const tableRows = rows.slice(0, 40).map((r) => `<tr>
    <td style="padding:5px 9px;border-bottom:1px solid #eee;font-family:monospace;">${h(r.sku)}</td>
    <td style="padding:5px 9px;border-bottom:1px solid #eee;">${h(r.product_name)}</td>
    <td style="padding:5px 9px;border-bottom:1px solid #eee;">${h(r.brand_name)}</td>
    <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${h(r.late_orders)}</td>
    <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;">${h(r.avg_hours)}h</td>
    <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;color:${Number(r.worst_hours) > 168 ? "#dc2626" : "#64748b"};">${h(r.worst_hours)}h</td>
  </tr>`).join("");

  const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;line-height:1.5;max-width:760px;margin:0 auto;">
    <div style="background:#1e293b;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:20px;">Late-Despatch SKUs — Weekly</h1></div>
    <div style="padding:20px;">
      <p>Hi Steven &amp; Clive,</p>
      <p><strong>${rows.length}</strong> SKUs sat in orders that took over <strong>${sla}h</strong> to despatch in the last <strong>${days} days</strong> — these are usually a stock or back-order problem, and fixing the top ones lifts our despatch SLA. Full list is attached as a CSV; the worst 40 are below.</p>
      ${rows.length === 0 ? `<p style="color:#059669;">Nothing breached the ${sla}h threshold this period — good week.</p>` : `
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
        <tr style="background:#f1f5f9;text-align:left;">
          <th style="padding:6px 9px;">SKU</th><th style="padding:6px 9px;">Product</th><th style="padding:6px 9px;">Brand</th>
          <th style="padding:6px 9px;text-align:right;">Late orders</th><th style="padding:6px 9px;text-align:right;">Avg</th><th style="padding:6px 9px;text-align:right;">Worst</th>
        </tr>${tableRows}
      </table>${rows.length > 40 ? `<p style="font-size:12px;color:#64748b;">…and ${rows.length - 40} more in the attached CSV.</p>` : ""}`}
      <p style="font-size:13px;margin-top:16px;">Full interactive view (change the window / SLA, drill into any SKU): <a href="${PAGE}">Despatch KPIs → Late SKUs</a>.</p>
    </div>
    <div style="background:#f1f5f9;padding:14px;text-align:center;font-size:12px;color:#64748b;">Automated weekly from the PartsDoc Hub.${isTest ? " <strong>[TEST]</strong>" : ""}</div>
  </body></html>`;

  const toList = toOverride ?? (isTest ? TEST : REAL);
  const sent = await resend.emails.send({
    from: "PartsDoc Hub <hub@partsdochub.com>", to: toList, cc: cc.length ? cc : undefined,
    subject: `Late-despatch SKUs — ${rows.length} over ${sla}h (last ${days}d)${isTest ? " [TEST]" : ""}`,
    html: emailHtml,
    attachments: [{ filename, content: encodeBase64(csv) }],
  });

  return json({ ok: !sent.error, rows: rows.length, days, sla, emailed: toList, cc,
    resend_id: sent.data?.id ?? null, resend_error: sent.error ?? null });
});
