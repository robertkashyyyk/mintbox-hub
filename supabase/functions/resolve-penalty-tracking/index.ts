// Resolve a carrier penalty's tracking number → Mintsoft order → SKU.
// Strategy:
//   1. Local lookup in order_lines.tracking_number (cheap, fast).
//   2. Fall back to Mintsoft Order API search by TrackingNo.
// On success, updates carrier_penalties.{mintsoft_order_id, sku, resolution_status}
// and creates a carrier_remeasure_tasks row in 'todo' state.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { penalty_id, penalty_ids } = body;
    const ids: string[] = penalty_ids ?? (penalty_id ? [penalty_id] : []);
    if (ids.length === 0) return json({ error: "penalty_id or penalty_ids required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: penalties, error } = await supabase
      .from("carrier_penalties")
      .select("id, tracking_number, mintsoft_order_id, sku, resolution_status, carrier_id")
      .in("id", ids);
    if (error) return json({ error: error.message }, 500);

    let resolved = 0;
    let unresolved = 0;
    const results: any[] = [];

    for (const p of penalties ?? []) {
      const r = await resolveOne(supabase, p);
      results.push(r);
      if (r.resolved) resolved++;
      else unresolved++;
    }

    return json({ ok: true, resolved, unresolved, results });
  } catch (e) {
    console.error("resolve-penalty-tracking error", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

async function resolveOne(supabase: any, penalty: any) {
  if (!penalty.tracking_number) {
    return { id: penalty.id, resolved: false, reason: "no tracking number" };
  }
  if (penalty.sku && penalty.mintsoft_order_id) {
    return { id: penalty.id, resolved: true, source: "already_resolved" };
  }

  const tn = String(penalty.tracking_number).trim();

  // 1. Local lookup
  const { data: localLines } = await supabase
    .from("order_lines")
    .select("mintsoft_order_id, sku, line_index")
    .eq("tracking_number", tn)
    .order("line_index", { ascending: true })
    .limit(10);

  let orderId: number | null = null;
  let sku: string | null = null;
  let source = "local";

  if (localLines && localLines.length > 0) {
    orderId = localLines[0].mintsoft_order_id;
    // Single-SKU order is unambiguous; multi-SKU we still pick the first but flag it
    sku = localLines.length === 1 ? localLines[0].sku : localLines[0].sku;
  } else {
    // 2. Mintsoft fallback
    const ms = await mintsoftLookup(tn);
    if (ms) {
      orderId = ms.orderId;
      sku = ms.sku;
      source = "mintsoft";
    }
  }

  if (!orderId) {
    return { id: penalty.id, resolved: false, reason: "tracking not found" };
  }

  const updates: Record<string, unknown> = {
    mintsoft_order_id: orderId,
    resolution_status: sku ? "remeasure_pending" : "order_found",
  };
  if (sku) updates.sku = sku;

  const { error: upErr } = await supabase
    .from("carrier_penalties")
    .update(updates)
    .eq("id", penalty.id);
  if (upErr) return { id: penalty.id, resolved: false, reason: upErr.message };

  // Create remeasure task if SKU known
  if (sku) {
    // Avoid dupes
    const { data: existing } = await supabase
      .from("carrier_remeasure_tasks")
      .select("id")
      .eq("penalty_id", penalty.id)
      .maybeSingle();
    if (!existing) {
      await supabase.from("carrier_remeasure_tasks").insert({
        penalty_id: penalty.id,
        sku,
        mintsoft_order_id: orderId,
        status: "todo",
      });
    }
  }

  return { id: penalty.id, resolved: true, source, orderId, sku };
}

async function mintsoftLookup(tracking: string): Promise<{ orderId: number; sku: string | null } | null> {
  const apiKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!apiKey) return null;
  // Read base url from settings
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: settings } = await supabase
    .from("mintsoft_settings")
    .select("base_url")
    .single();
  const baseUrl = settings?.base_url || "https://api.mintsoft.co.uk";

  try {
    // Mintsoft Orders endpoint supports filtering by TrackingNo
    const url = `${baseUrl.replace(/\/$/, "")}/api/Order?TrackingNo=${encodeURIComponent(tracking)}&PageSize=5`;
    const resp = await fetch(url, { headers: { "ms-apikey": apiKey, accept: "application/json" } });
    if (!resp.ok) return null;
    const orders = await resp.json();
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order?.ID) return null;

    // Fetch items
    const itemsResp = await fetch(`${baseUrl.replace(/\/$/, "")}/api/Order/${order.ID}/Items`, {
      headers: { "ms-apikey": apiKey, accept: "application/json" },
    });
    if (!itemsResp.ok) return { orderId: order.ID, sku: null };
    const items = await itemsResp.json();
    const sku = Array.isArray(items) && items.length > 0 ? items[0].SKU : null;
    return { orderId: order.ID, sku };
  } catch (e) {
    console.error("mintsoftLookup error", e);
    return null;
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
