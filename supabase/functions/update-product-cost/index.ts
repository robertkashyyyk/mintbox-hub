// Update Mintsoft product CostPrice and mirror back into products_cache.
// Auth: must be a senior_user or super_user.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InputItem {
  mintsoft_product_id: number;
  sku: string;
  cost_price: number;
}

interface ResultItem {
  sku: string;
  ok: boolean;
  error?: string;
}

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date().toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mintsoftKey = Deno.env.get("MINTSOFT_API_KEY");

  if (!mintsoftKey) {
    return new Response(JSON.stringify({ error: "MINTSOFT_API_KEY not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ---- Auth ----
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // Service-role callers (server-side bulk cost imports via pg_net) are already fully
  // trusted, so they bypass the per-user senior/super gate. UI callers carry a user
  // token and still go through getUser + has_any_role.
  const token = authHeader.slice("Bearer ".length).trim();
  let isServiceRole = false;
  try {
    isServiceRole = JSON.parse(atob(token.split(".")[1] ?? "")).role === "service_role";
  } catch { /* not a decodable JWT — treat as a user token */ }

  let userId = "service_role";
  if (!isServiceRole) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    userId = userData.user.id;

    const { data: hasRole, error: roleErr } = await admin.rpc("has_any_role", {
      _user_id: userId,
      _roles: ["super_user", "senior_user"],
    });
    if (roleErr || !hasRole) {
      return new Response(JSON.stringify({ error: "Forbidden — senior or super role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // ---- Input ----
  let body: { items?: InputItem[] };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) {
    return new Response(JSON.stringify({ error: "items must be 1-50 entries" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Validate each item
  for (const it of items) {
    if (
      !Number.isFinite(it.mintsoft_product_id) ||
      !it.sku || typeof it.sku !== "string" ||
      !Number.isFinite(it.cost_price) || it.cost_price <= 0 || it.cost_price > 100000
    ) {
      return new Response(JSON.stringify({ error: `Invalid item: ${JSON.stringify(it)}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const results: ResultItem[] = [];

  for (const item of items) {
    try {
      // 1) POST minimal payload to /api/Product. This is Mintsoft's update endpoint
      //    when ID is present. We deliberately send ONLY {ID, SKU, CostPrice} —
      //    echoing the full product object back triggers validation errors
      //    (e.g. "One or more pallet sizes are not valid!") and silently fails.
      // Send ONLY {ID, CostPrice}. Including SKU triggers Mintsoft's
      // uniqueness check and fails when the live SKU has been renamed
      // (e.g. "<sku>-DEL"). ID alone is the unambiguous handle.
      const payload = {
        ID: item.mintsoft_product_id,
        CostPrice: item.cost_price,
      };
      const postResp = await fetch(`${MINTSOFT_BASE}/api/Product`, {
        method: "POST",
        headers: {
          "ms-apikey": mintsoftKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const postText = await postResp.text();
      if (!postResp.ok) {
        results.push({ sku: item.sku, ok: false, error: `HTTP ${postResp.status}: ${postText.slice(0, 200)}` });
        continue;
      }

      // Mintsoft returns HTTP 200 even on logical failure — must check Success flag.
      let parsed: any = null;
      try { parsed = JSON.parse(postText); } catch { /* ignore */ }
      if (parsed && parsed.Success === false) {
        results.push({
          sku: item.sku,
          ok: false,
          error: `Mintsoft rejected: ${parsed.Message ?? postText.slice(0, 200)}`,
        });
        continue;
      }

      // 2) Verify by re-fetching the product
      const verifyResp = await fetch(`${MINTSOFT_BASE}/api/Product/${item.mintsoft_product_id}`, {
        headers: { "ms-apikey": mintsoftKey },
      });
      if (verifyResp.ok) {
        const verified = await verifyResp.json();
        const verifiedCost = Number(verified?.CostPrice ?? 0);
        if (Math.abs(verifiedCost - item.cost_price) > 0.005) {
          results.push({
            sku: item.sku,
            ok: false,
            error: `Mintsoft accepted but CostPrice still ${verifiedCost} (expected ${item.cost_price})`,
          });
          continue;
        }
      }

      // 3) Mirror to products_cache. Filter by sku (indexed) — mintsoft_product_id
      //    is NOT indexed, so a 225k-row seq scan hits the statement timeout.
      const { error: upErr } = await admin
        .from("products_cache")
        .update({
          cost_price: item.cost_price,
          cost_price_updated_at: new Date().toISOString(),
          cost_price_source: "manual_ui",
        })
        .eq("sku", item.sku);

      if (upErr) {
        results.push({ sku: item.sku, ok: false, error: `DB mirror failed: ${upErr.message}` });
        continue;
      }

      results.push({ sku: item.sku, ok: true });
    } catch (e: any) {
      results.push({ sku: item.sku, ok: false, error: e?.message ?? String(e) });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.length - successCount;

  // Log run
  await admin.from("edge_function_runs").insert({
    function_name: "update-product-cost",
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    status: failCount === 0 ? "success" : (successCount === 0 ? "failed" : "partial"),
    message: `${successCount} ok / ${failCount} failed`,
    details: { user_id: userId, results },
  } as any);

  return new Response(JSON.stringify({ results, successCount, failCount }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
