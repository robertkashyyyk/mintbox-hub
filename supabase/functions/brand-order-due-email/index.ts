// brand-order-due-email — per-brand reorder reminder.
// Finds brands whose order schedule is due today (brand_order_schedule.next_due_date
// <= current_date, enabled), emails Steven & Clive that brand's current Buy
// Recommendations (inline table + CSV attachment), then rolls the schedule forward.
//
// Called daily by cron with an empty body. Also invokable manually:
//   { test?: true }            -> send to robert only (never mutates schedules)
//   { brand_id: uuid }         -> send just this brand now, ignoring the due date
//                                 (a "send now" preview — never mutates the schedule)
//   { to?: string[] }          -> override recipients
//   { cc?: string[] }          -> add CC
// A schedule is only rolled forward on the real, unforced cron run.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const REAL = ["steven@partsdoc.co.uk", "clive@partsdoc.co.uk", "clivejardine@me.com"];
const TEST = ["robert@kashyyyk.co.uk"];
const PAGE = "https://partsdochub.com/decisions/buying";
const CADENCE_LABEL: Record<string, string> = { weekly: "weekly", fortnightly: "fortnightly", monthly: "monthly", quarterly: "quarterly" };

const h = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
const esc = (v: unknown) => { const t = String(v ?? ""); return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? 0)); return Number.isFinite(n) ? n : 0; };
const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 }).format(n || 0);
const niceDate = (d: string) => { try { return new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }); } catch { return d; } };

// Row status + urgency rank, mirroring rowStatus() on the Buy Recommendations page.
const STATUS_META: Record<string, { label: string; rank: number; color: string }> = {
  critical:  { label: "Critical",     rank: 0, color: "#dc2626" },
  backorder: { label: "Backorder",    rank: 1, color: "#d97706" },
  oos:       { label: "Out of stock", rank: 2, color: "#dc2626" },
  low:       { label: "Low stock",    rank: 3, color: "#64748b" },
  ok:        { label: "OK",           rank: 4, color: "#64748b" },
};
function rowStatus(r: any): keyof typeof STATUS_META {
  const stock = num(r.current_stock), bo = num(r.back_orders), lsa = num(r.low_stock_alert);
  if (bo > 0 && stock < lsa) return "critical";
  if (bo > 0) return "backorder";
  if (stock <= 0) return "oos";
  if (stock < lsa) return "low";
  return "ok";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const body = await req.json().catch(() => ({} as any));
  const isTest = body?.test === true;
  const forceBrand: string | null = typeof body?.brand_id === "string" && body.brand_id ? body.brand_id : null;
  const toOverride: string[] | null = Array.isArray(body?.to) && body.to.length ? body.to : null;
  const cc: string[] = Array.isArray(body?.cc) ? body.cc : [];
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Which schedules to fire this run.
  let q = supabase
    .from("brand_order_schedule")
    .select("id, brand_id, cadence, day_of_month, next_due_date, enabled, brands!inner(name)");
  if (forceBrand) q = q.eq("brand_id", forceBrand);
  else q = q.eq("enabled", true).lte("next_due_date", new Date().toISOString().slice(0, 10));
  const { data: schedules, error: schedErr } = await q;
  if (schedErr) return json({ ok: false, stage: "schedules", error: schedErr.message }, 500);

  const results: any[] = [];
  const toList = toOverride ?? (isTest ? TEST : REAL);
  // A schedule advances only on the genuine cron run — never on a test or a forced preview.
  const mayRoll = !isTest && !forceBrand;

  for (const s of (schedules ?? []) as any[]) {
    const brandName = s.brands?.name ?? "Brand";
    const cadence = String(s.cadence);

    const { data: recData, error: recErr } = await supabase.rpc("get_buy_recommendations", {
      p_supplier_id: null, p_brand_id: s.brand_id, p_include_pending: false,
    });
    if (recErr) { results.push({ brand: brandName, ok: false, stage: "rpc", error: recErr.message }); continue; }

    // needs_order rows only (pending already excluded), sorted by urgency then spend.
    const rows = ((recData ?? []) as any[])
      .filter((r) => r.status !== "po_sent_pending")
      .map((r) => {
        const st = rowStatus(r);
        const qty = num(r.required_qty);
        const cost = r.unit_cost == null ? null : num(r.unit_cost);
        return { ...r, _st: st, _qty: qty, _cost: cost, _line: cost == null ? null : cost * qty };
      })
      .sort((a, b) => STATUS_META[a._st].rank - STATUS_META[b._st].rank || b._line! - a._line! || b._qty - a._qty);

    const totalUnits = rows.reduce((s, r) => s + r._qty, 0);
    const totalSpend = rows.reduce((s, r) => s + (r._line ?? 0), 0);

    const csv = [
      ["SKU", "Product", "Brand", "Supplier", "Status", "Stock", "OnOrder", "BackOrders", "LSA", "RecommendedQty", "UnitCost", "LineCost"].join(","),
      ...rows.map((r) => [
        r.sku, r.product_name ?? "", r.brand_name ?? brandName, r.supplier_name ?? "",
        STATUS_META[r._st].label, num(r.current_stock), num(r.on_order), num(r.back_orders), num(r.low_stock_alert),
        r._qty, r._cost ?? "", r._line ?? "",
      ].map(esc).join(",")),
    ].join("\n") + "\n";
    const filename = `order-${brandName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}-${s.next_due_date}.csv`;

    const tableRows = rows.slice(0, 40).map((r) => `<tr>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;font-family:monospace;">${h(r.sku)}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;">${h(r.product_name)}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;"><span style="color:${STATUS_META[r._st].color};font-weight:600;">${STATUS_META[r._st].label}</span></td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;">${h(num(r.current_stock))}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;color:${num(r.back_orders) > 0 ? "#dc2626" : "#64748b"};">${h(num(r.back_orders))}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;">${h(num(r.low_stock_alert))}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${h(r._qty)}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;">${r._cost == null ? '<span style="color:#dc2626;">—</span>' : h(gbp(r._cost))}</td>
      <td style="padding:5px 9px;border-bottom:1px solid #eee;text-align:right;">${r._line == null ? "—" : h(gbp(r._line))}</td>
    </tr>`).join("");

    const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;line-height:1.5;max-width:820px;margin:0 auto;">
      <div style="background:#1e293b;color:#fff;padding:20px;text-align:center;"><h1 style="margin:0;font-size:20px;">${h(brandName)} — ${h(CADENCE_LABEL[cadence] ?? cadence)} order due</h1></div>
      <div style="padding:20px;">
        <p>Hi Steven &amp; Clive,</p>
        <p>The <strong>${h(CADENCE_LABEL[cadence] ?? cadence)}</strong> order for <strong>${h(brandName)}</strong> is due (${h(niceDate(s.next_due_date))}). ${rows.length === 0
          ? `Nothing is currently recommended to reorder — but this is your reminder to check.`
          : `<strong>${rows.length}</strong> SKU${rows.length === 1 ? "" : "s"} are recommended for reorder — about <strong>${h(totalUnits)}</strong> units, <strong>${h(gbp(totalSpend))}</strong> at cost. Full list is attached as a CSV; the top ${Math.min(rows.length, 40)} are below.`}</p>
        ${rows.length === 0 ? "" : `
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;">
          <tr style="background:#f1f5f9;text-align:left;">
            <th style="padding:6px 9px;">SKU</th><th style="padding:6px 9px;">Product</th><th style="padding:6px 9px;">Status</th>
            <th style="padding:6px 9px;text-align:right;">Stock</th><th style="padding:6px 9px;text-align:right;">BO</th><th style="padding:6px 9px;text-align:right;">LSA</th>
            <th style="padding:6px 9px;text-align:right;">Qty</th><th style="padding:6px 9px;text-align:right;">Unit</th><th style="padding:6px 9px;text-align:right;">Line</th>
          </tr>${tableRows}
        </table>${rows.length > 40 ? `<p style="font-size:12px;color:#64748b;">…and ${rows.length - 40} more in the attached CSV.</p>` : ""}`}
        <p style="font-size:13px;margin-top:16px;">Full interactive view (adjust quantities, mark POs sent): <a href="${PAGE}">Buy Recommendations</a>.</p>
      </div>
      <div style="background:#f1f5f9;padding:14px;text-align:center;font-size:12px;color:#64748b;">Automated ${h(CADENCE_LABEL[cadence] ?? cadence)} reorder reminder from the PartsDoc Hub.${isTest ? " <strong>[TEST]</strong>" : ""}</div>
    </body></html>`;

    const sent = await resend.emails.send({
      from: "PartsDoc Hub <hub@partsdochub.com>", to: toList, cc: cc.length ? cc : undefined,
      subject: `Order due: ${brandName} — ${rows.length} SKU${rows.length === 1 ? "" : "s"} to reorder${isTest ? " [TEST]" : ""}`,
      html: emailHtml,
      attachments: rows.length ? [{ filename, content: encodeBase64(csv) }] : undefined,
    });

    const outcome = { brand: brandName, brand_id: s.brand_id, cadence, rows: rows.length,
      total_units: totalUnits, total_spend: Math.round(totalSpend * 100) / 100,
      resend_id: sent.data?.id ?? null, resend_error: sent.error?.message ?? null, ok: !sent.error };

    if (mayRoll && !sent.error) {
      const { data: nextDue } = await supabase.rpc("advance_order_due", {
        p_cadence: cadence, p_dom: s.day_of_month, p_from: s.next_due_date,
      });
      await supabase.from("brand_order_schedule").update({
        next_due_date: nextDue, last_sent_at: new Date().toISOString(),
        last_send_result: outcome, updated_at: new Date().toISOString(),
      }).eq("id", s.id);
      (outcome as any).rolled_to = nextDue;
    }
    results.push(outcome);
  }

  return json({ ok: results.every((r) => r.ok !== false), mode: forceBrand ? "forced" : isTest ? "test" : "cron",
    emailed: toList, brands: results.length, results });
});
