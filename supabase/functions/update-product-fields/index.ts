// Manual "fill the gaps" push: barcode + dimensions + weight -> Mintsoft, in ONE call per item.
// Mirrors update-product-barcode / update-product-cost / push-dims-to-mintsoft. Senior/super only.
//
// Mintsoft field mapping (confirmed live):
//   barcode -> UPC (12 digits) or EAN (13 digits)   (Mintsoft has no generic Barcode field)
//   length  -> Width    (documented quirk)
//   height  -> Height,  depth -> Depth
//   weight  -> Weight, GRAMS / 1000 (Mintsoft is in KG)
//
// Body: { items: [{ mintsoft_product_id, sku, barcode?, length?, depth?, height?, weight? }] }  (1-50)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

interface InputItem {
  mintsoft_product_id: number; sku: string;
  barcode?: string | null; length?: number | null; depth?: number | null; height?: number | null; weight?: number | null;
}

function classifyBarcode(raw: string): { digits: string; field: "UPC" | "EAN" } | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length === 12) return { digits, field: "UPC" };
  if (digits.length === 13) return { digits, field: "EAN" };
  return null;
}
const numOk = (n: any) => n != null && Number.isFinite(Number(n)) && Number(n) > 0 && Number(n) < 1_000_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date().toISOString();
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

  const { data: types } = await admin.from("barcode_types").select("id, type_name");
  const typeId = (name: string) => types?.find((t: any) => t.type_name === name)?.id ?? null;

  const results: any[] = [];
  for (const it of items) {
    try {
      if (!Number.isFinite(it.mintsoft_product_id) || !it.sku) { results.push({ sku: it.sku, ok: false, error: "missing mintsoft id / sku" }); continue; }

      const payload: Record<string, unknown> = { ID: it.mintsoft_product_id };
      const cacheUpdate: Record<string, unknown> = {};

      // barcode
      let bc: { digits: string; field: "UPC" | "EAN" } | null = null;
      if (it.barcode != null && String(it.barcode).trim() !== "") {
        bc = classifyBarcode(String(it.barcode));
        if (!bc) { results.push({ sku: it.sku, ok: false, error: `Invalid barcode "${it.barcode}" — need 12 (UPC) or 13 (EAN) digits` }); continue; }
        payload[bc.field] = bc.digits;
        cacheUpdate.barcode = bc.digits; cacheUpdate.barcode_type_id = typeId(bc.field);
      }
      // dims (cm) + weight (g -> kg)
      if (numOk(it.height)) { payload.Height = Number(it.height); cacheUpdate.height = Number(it.height); }
      if (numOk(it.length)) { payload.Width = Number(it.length); cacheUpdate.length = Number(it.length); }
      if (numOk(it.depth))  { payload.Depth = Number(it.depth);  cacheUpdate.depth  = Number(it.depth); }
      if (numOk(it.weight)) { payload.Weight = +(Number(it.weight) / 1000).toFixed(3); cacheUpdate.weight = Number(it.weight); }

      if (Object.keys(payload).length === 1) { results.push({ sku: it.sku, ok: false, error: "nothing to push" }); continue; }

      const resp = await fetch(`${MINTSOFT_BASE}/api/Product`, {
        method: "POST",
        headers: { "ms-apikey": mintsoftKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await resp.text();
      if (!resp.ok) { results.push({ sku: it.sku, ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 180)}` }); continue; }
      let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* ignore */ }
      if (parsed && parsed.Success === false) { results.push({ sku: it.sku, ok: false, error: `Mintsoft rejected: ${parsed.Message ?? text.slice(0, 180)}` }); continue; }

      const { error: upErr } = await admin.from("products_cache").update(cacheUpdate).eq("sku", it.sku);
      if (upErr) { results.push({ sku: it.sku, ok: false, error: `DB mirror failed: ${upErr.message}` }); continue; }

      results.push({ sku: it.sku, ok: true, pushed: Object.keys(payload).filter((k) => k !== "ID") });
    } catch (e: any) {
      results.push({ sku: it.sku, ok: false, error: e?.message ?? String(e) });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.length - successCount;
  // Logging must NEVER fail the push.
  try {
    await admin.from("edge_function_runs").insert({
      function_name: "update-product-fields", started_at: startedAt, ended_at: new Date().toISOString(),
      status: failCount === 0 ? "success" : (successCount === 0 ? "failed" : "partial"),
      message: `${successCount} ok / ${failCount} failed`, details: { user_id: userData.user.id, results },
    } as any);
  } catch (e) { console.error("edge_function_runs insert failed:", (e as Error)?.message); }

  return json({ results, successCount, failCount });
});
