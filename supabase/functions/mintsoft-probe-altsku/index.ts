// Read-only probe: does Mintsoft's FULL Product detail (/api/Product/{id}) carry
// alternative / additional SKUs (the Amazon channel SKU -> internal product link)?
// Pulls a sample of products by id, dumps the field names, and flags any field
// that looks SKU/alias/barcode-related with sample values. No writes.
//
// Body: { skus?: string[], productIds?: number[], sample?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BASE = "https://api.mintsoft.co.uk";
const SKULIKE = /sku|alias|alternat|additional|barcode|ean|upc|gtin|asin/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!apiKey) return json({ error: "MINTSOFT_API_KEY not set" }, 500);

  // light auth: service key or any valid bearer (read-only diagnostic)
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return json({ error: "Unauthorized" }, 401);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  let input: any = {};
  try { input = req.method === "POST" ? await req.json() : {}; } catch { input = {}; }

  // Resolve a set of product ids to inspect.
  let productIds: number[] = Array.isArray(input?.productIds) ? input.productIds : [];
  if (!productIds.length) {
    let q = supa.from("products_cache").select("sku, mintsoft_product_id").not("mintsoft_product_id", "is", null).limit(input?.sample ?? 8);
    if (Array.isArray(input?.skus) && input.skus.length) q = supa.from("products_cache").select("sku, mintsoft_product_id").in("sku", input.skus);
    else q = q.ilike("sku", "ASC%"); // own-brand: most likely to carry Amazon alt SKUs
    const { data } = await q;
    productIds = (data ?? []).map((r: any) => r.mintsoft_product_id).filter(Boolean);
  }
  if (!productIds.length) return json({ error: "no product ids resolved" }, 400);

  const allFields = new Set<string>();
  const findings: any[] = [];
  for (const id of productIds.slice(0, 10)) {
    const res = await fetch(`${BASE}/api/Product/${id}`, { headers: { "ms-apikey": apiKey, accept: "application/json" } });
    if (!res.ok) { findings.push({ id, error: `HTTP ${res.status}` }); continue; }
    const p = await res.json();
    const obj = Array.isArray(p) ? p[0] : p;
    if (!obj || typeof obj !== "object") { findings.push({ id, error: "no object" }); continue; }
    const skuLike: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      allFields.add(k);
      if (SKULIKE.test(k)) skuLike[k] = obj[k];
    }
    findings.push({ id, primarySKU: obj.SKU, skuLikeFields: skuLike });
  }

  return json({
    probed: findings.length,
    all_product_fields: Array.from(allFields).sort(),
    sku_like_fields_seen: Array.from(allFields).filter((f) => SKULIKE.test(f)).sort(),
    findings,
  }, 200);
});
