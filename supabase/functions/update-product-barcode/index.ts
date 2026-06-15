// Update a Mintsoft product's barcode and mirror it into products_cache.
// Mintsoft has NO generic "Barcode" field — it has separate EAN and UPC fields.
// A product should have exactly one: UPC = 12 digits, EAN = 13 digits.
// We auto-detect by length and write the correct field + barcode_type_id.
// Modeled on update-product-cost. Senior/super role only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MINTSOFT_BASE = "https://api.mintsoft.co.uk";

interface InputItem { mintsoft_product_id: number; sku: string; barcode: string; }
interface ResultItem { sku: string; ok: boolean; type?: "UPC" | "EAN"; barcode?: string; error?: string; }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Returns the normalized digits + Mintsoft field + type name, or null if not a valid 12/13-digit barcode.
function classify(raw: string): { digits: string; field: "UPC" | "EAN"; type: "UPC" | "EAN" } | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12) return { digits, field: "UPC", type: "UPC" };
  if (digits.length === 13) return { digits, field: "EAN", type: "EAN" };
  return null;
}

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
    if (!Number.isFinite(it.mintsoft_product_id) || !it.sku || typeof it.sku !== "string" || typeof it.barcode !== "string") {
      return json({ error: `Invalid item: ${JSON.stringify(it)}` }, 400);
    }
  }

  // Resolve barcode_types ids once (UPC=12, EAN=13).
  const { data: types } = await admin.from("barcode_types").select("id, type_name");
  const typeId = (name: string) => types?.find((t: any) => t.type_name === name)?.id ?? null;

  const results: ResultItem[] = [];
  for (const item of items) {
    const c = classify(item.barcode);
    if (!c) {
      results.push({ sku: item.sku, ok: false, error: `Invalid barcode — expected 12 digits (UPC) or 13 digits (EAN), got "${item.barcode}"` });
      continue;
    }
    try {
      // POST minimal {ID, <UPC|EAN>} to Mintsoft's product update endpoint.
      const resp = await fetch(`${MINTSOFT_BASE}/api/Product`, {
        method: "POST",
        headers: { "ms-apikey": mintsoftKey, "Content-Type": "application/json" },
        body: JSON.stringify({ ID: item.mintsoft_product_id, [c.field]: c.digits }),
      });
      const text = await resp.text();
      if (!resp.ok) { results.push({ sku: item.sku, ok: false, type: c.type, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` }); continue; }
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* ignore */ }
      if (parsed && parsed.Success === false) { results.push({ sku: item.sku, ok: false, type: c.type, error: `Mintsoft rejected: ${parsed.Message ?? text.slice(0, 200)}` }); continue; }

      // Mirror to products_cache by sku (indexed): value + matching type id.
      const { error: upErr } = await admin.from("products_cache")
        .update({ barcode: c.digits, barcode_type_id: typeId(c.type) }).eq("sku", item.sku);
      if (upErr) { results.push({ sku: item.sku, ok: false, type: c.type, error: `DB mirror failed: ${upErr.message}` }); continue; }
      results.push({ sku: item.sku, ok: true, type: c.type, barcode: c.digits });
    } catch (e: any) {
      results.push({ sku: item.sku, ok: false, type: c.type, error: e?.message ?? String(e) });
    }
  }
  return json({ results, successCount: results.filter((r) => r.ok).length, failCount: results.filter((r) => !r.ok).length });
});
