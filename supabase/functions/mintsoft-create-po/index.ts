// mintsoft-create-po
//
// Marks a draft PO as "sent". Mintsoft has no public PO-create endpoint, so we
// move the PO to the `sent` status — buyers send the PO out-of-band (email /
// portal), then ASN matching closes the loop later when stock arrives.
//
// Cost-validation gate: refuse to send if any line has unit_cost <= 0.
// Lag-window suppression: while status='sent' and mintsoft_po_id is null,
//   `get_buy_recommendations` excludes / flags those SKUs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "Missing auth" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const poId: string | undefined = body?.po_id;
    if (!poId) {
      return new Response(JSON.stringify({ error: "po_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use service role for the actual updates (bypass RLS, we've already checked auth)
    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: po, error: poErr } = await svc
      .from("purchase_orders")
      .select("id, status")
      .eq("id", poId)
      .single();
    if (poErr || !po) {
      return new Response(JSON.stringify({ error: "PO not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (po.status !== "draft" && po.status !== "approved") {
      return new Response(JSON.stringify({ error: `Cannot send PO with status '${po.status}'` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cost-validation gate
    const { data: lines, error: linesErr } = await svc
      .from("purchase_order_lines")
      .select("sku, unit_cost, qty_ordered")
      .eq("po_id", poId);
    if (linesErr) throw linesErr;
    if (!lines || lines.length === 0) {
      return new Response(JSON.stringify({ error: "PO has no lines" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const badLines = lines.filter((l) => !l.unit_cost || Number(l.unit_cost) <= 0);
    if (badLines.length > 0) {
      return new Response(JSON.stringify({
        error: "Cannot send: some lines have no unit cost",
        bad_skus: badLines.map((l) => l.sku),
      }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updErr } = await svc
      .from("purchase_orders")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_by: userData.user.id,
      })
      .eq("id", poId);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({ ok: true, po_id: poId, status: "sent" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mintsoft-create-po failed:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
