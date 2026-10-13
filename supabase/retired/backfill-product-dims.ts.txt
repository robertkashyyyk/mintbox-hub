// One-off maintenance: page Mintsoft's full product catalogue and correct the historical
// dimension/weight mis-mapping in products_cache (length<-Width, weight kg->g), via the
// bulk_set_product_dims RPC. COALESCE in the RPC means it only fixes where Mintsoft has a
// value — it never wipes a local-only (e.g. web-searched) dim.
//
// Resumable: processes a window of pages per call and returns nextPage. Call repeatedly with
// { page: nextPage, confirm: "BACKFILL" } until done:true. Deployed --no-verify-jwt; guarded
// by the confirm token (it only mirrors Mintsoft -> Hub, so it's idempotent/low-risk).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PAGES_PER_RUN = 25;
const LIMIT = 100;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await req.json().catch(() => ({} as any));
  if (body?.confirm !== "BACKFILL") return json({ error: "pass { confirm: 'BACKFILL' }" }, 400);

  const key = Deno.env.get("MINTSOFT_API_KEY");
  if (!key) return json({ error: "MINTSOFT_API_KEY not set" }, 500);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let page = Math.max(1, Number(body?.page ?? 1));
  let scanned = 0, done = false;
  const rows: any[] = [];

  for (let i = 0; i < PAGES_PER_RUN; i++) {
    const res = await fetch(`${MINTSOFT_BASE}/api/Product/List?PageNo=${page}&Limit=${LIMIT}`, { headers: { "ms-apikey": key } });
    if (!res.ok) return json({ error: `Mintsoft List ${res.status} at page ${page}`, nextPage: page }, 502);
    const products = await res.json();
    const arr = Array.isArray(products) ? products : [];
    scanned += arr.length;
    for (const p of arr) {
      if (!p?.SKU) continue;
      const row: any = { sku: p.SKU };
      const widthOrLen = p.Width ?? p.Length;
      if (widthOrLen != null) row.length = String(widthOrLen);
      if (p.Depth != null) row.depth = String(p.Depth);
      if (p.Height != null) row.height = String(p.Height);
      if (p.Weight != null && Number(p.Weight) > 0) row.weight = String(Number(p.Weight) * 1000);
      if (Object.keys(row).length > 1) rows.push(row);
    }
    if (arr.length < LIMIT) { done = true; page++; break; }
    page++;
  }

  let updated = 0;
  if (rows.length) {
    const { data, error } = await admin.rpc("bulk_set_product_dims", { p: rows });
    if (error) return json({ error: `bulk_set_product_dims: ${error.message}`, nextPage: page }, 500);
    updated = data ?? 0;
  }

  return json({ done, nextPage: done ? null : page, scanned, candidates: rows.length, updated });
});
