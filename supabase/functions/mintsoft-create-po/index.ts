// mintsoft-create-po
//
// Pushes a draft PO to Mintsoft as a Purchase Order (PreAdvice) using
// `POST /api/PurchaseOrder/Create`. On success, stamps `mintsoft_po_id`
// and the returned ASN reference, and moves status to `sent`.
//
// Pre-flight gates:
//   - Supplier must exist and have a `mintsoft_supplier_id` (the brand prefix
//     mapping must resolve to a supplier configured in Mintsoft).
//   - Every line must have `mintsoft_product_id` and `unit_cost > 0`.
//
// Lines that lack a unit cost are SKIPPED with a warning rather than blocking
// the whole PO. The caller can decide whether to chase those manually.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = new Date().toISOString();

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return json({ error: "Missing auth" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mintsoftKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftKey) return json({ error: "MINTSOFT_API_KEY not set" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const poId: string | undefined = body?.po_id;
    if (!poId) return json({ error: "po_id required" }, 400);

    const svc = createClient(url, svcKey);

    // Load PO + supplier + lines
    const { data: po, error: poErr } = await svc
      .from("purchase_orders")
      .select("id, status, po_number, mintsoft_po_id, supplier_id, suppliers(name, mintsoft_supplier_id)")
      .eq("id", poId).single();
    if (poErr || !po) return json({ error: "PO not found" }, 404);

    if (po.mintsoft_po_id) {
      return json({ error: `PO already pushed to Mintsoft (#${po.mintsoft_po_id})` }, 400);
    }
    if (po.status !== "draft" && po.status !== "approved") {
      return json({ error: `Cannot send PO with status '${po.status}'` }, 400);
    }

    const supplier: any = po.suppliers;
    if (!po.supplier_id || !supplier?.mintsoft_supplier_id) {
      return json({
        error: `Supplier "${supplier?.name ?? "unknown"}" is not mapped to a Mintsoft supplier. Open Suppliers admin and set the Mintsoft Supplier ID first.`,
      }, 422);
    }

    const { data: lines, error: linesErr } = await svc
      .from("purchase_order_lines")
      .select("id, sku, qty_ordered, unit_cost")
      .eq("po_id", poId);
    if (linesErr) throw linesErr;
    if (!lines || lines.length === 0) return json({ error: "PO has no lines" }, 400);

    // Resolve mintsoft_product_id for each SKU
    const skus = lines.map((l) => l.sku);
    const { data: pcRows, error: pcErr } = await svc
      .from("products_cache")
      .select("sku, mintsoft_product_id")
      .in("sku", skus);
    if (pcErr) throw pcErr;
    const pidMap = new Map<string, number>();
    for (const r of pcRows || []) {
      if (r.mintsoft_product_id) pidMap.set(r.sku, r.mintsoft_product_id);
    }

    const skipped: { sku: string; reason: string }[] = [];
    const orderItems: any[] = [];
    for (const l of lines) {
      const pid = pidMap.get(l.sku);
      if (!pid) {
        skipped.push({ sku: l.sku, reason: "no Mintsoft product id" });
        continue;
      }
      const cost = Number(l.unit_cost ?? 0);
      if (!cost || cost <= 0) {
        skipped.push({ sku: l.sku, reason: "missing unit cost" });
        continue;
      }
      const qty = Number(l.qty_ordered ?? 0);
      if (qty <= 0) {
        skipped.push({ sku: l.sku, reason: "qty <= 0" });
        continue;
      }
      // NewASNItem schema: { ProductId, SKU, Quantity, SourceLineId? }
      orderItems.push({ ProductId: pid, SKU: l.sku, Quantity: qty, SourceLineId: l.id });
    }

    if (orderItems.length === 0) {
      return json({
        error: "No valid lines to push to Mintsoft (all lines missing cost / product id).",
        skipped,
      }, 422);
    }

    // Mintsoft API: PUT /api/ASN with NewASN schema
    // (There is NO /api/PurchaseOrder/Create endpoint — ASN is the correct entity.)
    const payload = {
      Supplier: supplier.name ?? "",
      POReference: po.po_number || `PO-${po.id.slice(0, 8)}`,
      Items: orderItems,
    };

    // Mark attempt
    await svc.from("purchase_orders").update({
      mintsoft_send_attempted_at: new Date().toISOString(),
      mintsoft_send_error: null,
    }).eq("id", poId);

    const resp = await fetch(`${MINTSOFT_BASE}/api/ASN`, {
      method: "PUT",
      headers: { "ms-apikey": mintsoftKey, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }

    if (!resp.ok || (parsed && parsed.Success === false)) {
      const errMsg = parsed?.Message || text.slice(0, 300) || `HTTP ${resp.status}`;
      await svc.from("purchase_orders").update({ mintsoft_send_error: errMsg }).eq("id", poId);
      await svc.from("edge_function_runs").insert({
        function_name: "mintsoft-create-po", started_at: startedAt, ended_at: new Date().toISOString(),
        status: "failed", message: errMsg, details: { po_id: poId, payload, response: text.slice(0, 500) },
      } as any);
      return json({ error: `Mintsoft rejected: ${errMsg}`, payload }, 422);
    }

    // Mintsoft PO create returns the new PO ID (number) and often an ASN reference
    // ToolkitResult typically returns { Success, Message, ID } — ID is the new ASN id.
    const mintsoftPoId =
      parsed?.ID ?? parsed?.Id ?? parsed?.ASNId ?? parsed?.AsnId ?? null;
    const asnRef = parsed?.POReference ?? parsed?.ASNReference ?? parsed?.AsnReference ?? payload.POReference ?? null;

    const { error: updErr } = await svc.from("purchase_orders").update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_by: userData.user.id,
      mintsoft_po_id: typeof mintsoftPoId === "number" ? mintsoftPoId : null,
      mintsoft_asn_reference: asnRef ? String(asnRef) : null,
      mintsoft_send_error: null,
    }).eq("id", poId);
    if (updErr) throw updErr;

    await svc.from("edge_function_runs").insert({
      function_name: "mintsoft-create-po", started_at: startedAt, ended_at: new Date().toISOString(),
      status: "success",
      message: `PO ${poId} → Mintsoft #${mintsoftPoId ?? "?"}; ${orderItems.length} lines${skipped.length ? `, ${skipped.length} skipped` : ""}`,
      details: { po_id: poId, mintsoft_po_id: mintsoftPoId, asn_reference: asnRef, skipped },
    } as any);

    return json({
      ok: true, po_id: poId, status: "sent",
      mintsoft_po_id: mintsoftPoId,
      mintsoft_asn_reference: asnRef,
      lines_sent: orderItems.length,
      skipped,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mintsoft-create-po failed:", msg);
    return json({ error: msg }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
