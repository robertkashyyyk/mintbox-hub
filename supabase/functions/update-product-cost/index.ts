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
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);
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
      // 1) Fetch current product so we don't blank other fields on the update
      const getResp = await fetch(`${MINTSOFT_BASE}/api/Product/${item.mintsoft_product_id}`, {
        headers: { "ms-apikey": mintsoftKey },
      });
      if (!getResp.ok) {
        const text = await getResp.text();
        results.push({ sku: item.sku, ok: false, error: `GET ${getResp.status}: ${text.slice(0, 200)}` });
        continue;
      }
      const product = await getResp.json();

      // 2) Merge new CostPrice and POST back
      const updated = { ...product, CostPrice: item.cost_price };
      const postResp = await fetch(`${MINTSOFT_BASE}/api/Product`, {
        method: "POST",
        headers: {
          "ms-apikey": mintsoftKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });

      if (!postResp.ok) {
        const text = await postResp.text();
        results.push({ sku: item.sku, ok: false, error: `POST ${postResp.status}: ${text.slice(0, 200)}` });
        continue;
      }

      // 3) Mirror to products_cache
      const { error: upErr } = await admin
        .from("products_cache")
        .update({
          cost_price: item.cost_price,
          cost_price_updated_at: new Date().toISOString(),
          cost_price_source: "manual_ui",
        })
        .eq("mintsoft_product_id", item.mintsoft_product_id);

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
