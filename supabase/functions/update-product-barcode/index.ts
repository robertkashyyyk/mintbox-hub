// Update a Mintsoft product Barcode and mirror it back into products_cache.
// Modeled on update-product-cost. Senior/super role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MINTSOFT_BASE = "https://api.mintsoft.co.uk";

interface InputItem { mintsoft_product_id: number; sku: string; barcode: string; }
interface ResultItem { sku: string; ok: boolean; error?: string; }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mintsoftKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!mintsoftKey) return json({ error: "MINTSOFT_API_KEY not set" }, 500);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: hasRole } = await admin.rpc("has_any_role", { _user_id: userData.user.id, _roles: ["super_user", "senior_user"] });
  if (!hasRole) return json({ error: "Forbidden — senior or super role required" }, 403);

  let body: { items?: InputItem[] };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0 || items.length > 50) return json({ error: "items must be 1-50 entries" }, 400);

  for (const it of items) {
    if (!Number.isFinite(it.mintsoft_product_id) || !it.sku || typeof it.sku !== "string" ||
        !it.barcode || typeof it.barcode !== "string" || it.barcode.trim().length < 4 || it.barcode.trim().length > 40) {
      return json({ error: `Invalid item: ${JSON.stringify(it)}` }, 400);
    }
  }

  const results: ResultItem[] = [];
  for (const item of items) {
    const barcode = item.barcode.trim();
    try {
      // POST minimal {ID, Barcode} to Mintsoft's product update endpoint.
      const resp = await fetch(`${MINTSOFT_BASE}/api/Product`, {
        method: "POST",
        headers: { "ms-apikey": mintsoftKey, "Content-Type": "application/json" },
        body: JSON.stringify({ ID: item.mintsoft_product_id, Barcode: barcode }),
      });
      const text = await resp.text();
      if (!resp.ok) { results.push({ sku: item.sku, ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` }); continue; }
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* ignore */ }
      if (parsed && parsed.Success === false) { results.push({ sku: item.sku, ok: false, error: `Mintsoft rejected: ${parsed.Message ?? text.slice(0, 200)}` }); continue; }

      // Mirror to products_cache by sku (indexed).
      const { error: upErr } = await admin.from("products_cache").update({ barcode }).eq("sku", item.sku);
      if (upErr) { results.push({ sku: item.sku, ok: false, error: `DB mirror failed: ${upErr.message}` }); continue; }
      results.push({ sku: item.sku, ok: true });
    } catch (e: any) {
      results.push({ sku: item.sku, ok: false, error: e?.message ?? String(e) });
    }
  }
  return json({ results, successCount: results.filter((r) => r.ok).length, failCount: results.filter((r) => !r.ok).length });
});
