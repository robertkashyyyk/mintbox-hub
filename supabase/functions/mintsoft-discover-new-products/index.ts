// Weekly discovery of newly added Mintsoft products.
// Uses max(mintsoft_product_id) from products_cache to skip ahead in the
// paginated list (Mintsoft returns ascending by ID), then walks forward only.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftProduct {
  ID: number;
  SKU: string;
  Name: string;
  EAN?: string;
  UPC?: string;
  CostPrice?: number;
  Weight?: number;
  Height?: number;
  Length?: number;
  Depth?: number;
  Discontinued?: boolean;
  LowStockAlertLevel?: number;
  HandlingTime?: number;
}

const PAGE_LIMIT = 100;
const SAFETY_BACKTRACK_PAGES = 5;   // start a few pages before estimated, in case of gaps
const MAX_PAGES_FORWARD = 200;       // hard cap (~20k products)
const MAX_CONSEC_EMPTY = 10;         // stop after N empty pages

async function fetchPage(baseUrl: string, apiKey: string, page: number): Promise<MintsoftProduct[]> {
  const res = await fetch(`${baseUrl}/api/Product/List?PageNo=${page}&Limit=${PAGE_LIMIT}`, {
    headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Mintsoft ${res.status}: ${(await res.text()).substring(0, 200)}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: settings } = await supabase
      .from("mintsoft_settings").select("base_url").single();
    if (!settings) throw new Error("Mintsoft settings not configured");
    const baseUrl = settings.base_url;
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("MINTSOFT_API_KEY missing");

    // 1. Highest known mintsoft_product_id
    const { data: maxRow } = await supabase
      .from("products_cache")
      .select("mintsoft_product_id")
      .not("mintsoft_product_id", "is", null)
      .order("mintsoft_product_id", { ascending: false })
      .limit(1)
      .maybeSingle();
    const knownMaxId: number = maxRow?.mintsoft_product_id ?? 0;

    // 2. Load brand prefixes (only import SKUs we recognise)
    const { data: brands } = await supabase
      .from("brands").select("prefix, prefix_style");
    const brandMatchers = (brands ?? []).map((b: any) => {
      const sep = b.prefix_style === "slash" ? "/" : "-";
      return (b.prefix as string).toUpperCase() + sep;
    });
    const matchesBrand = (sku: string) => {
      const u = sku.toUpperCase();
      return brandMatchers.some((p) => u.startsWith(p));
    };

    // 3. Existing SKUs (so we only insert genuinely new ones)
    const { data: existingRows } = await supabase
      .from("products_cache").select("sku");
    const existingSkus = new Set((existingRows ?? []).map((r: any) => r.sku.toUpperCase()));

    // 4. Estimate starting page (Mintsoft IDs are ascending in list response)
    const estimatedPage = Math.max(1, Math.floor(knownMaxId / PAGE_LIMIT) - SAFETY_BACKTRACK_PAGES);
    console.log(`Discovery start: knownMaxId=${knownMaxId}, startPage=${estimatedPage}, brands=${brandMatchers.length}, existing=${existingSkus.size}`);

    const newProducts: MintsoftProduct[] = [];
    let page = estimatedPage;
    let consecEmpty = 0;
    let pagesScanned = 0;
    let highestSeenId = knownMaxId;

    while (pagesScanned < MAX_PAGES_FORWARD) {
      const products = await fetchPage(baseUrl, apiKey, page);
      pagesScanned++;
      if (products.length === 0) break;

      const candidates = products.filter((p) =>
        p.SKU &&
        p.ID > knownMaxId &&
        !existingSkus.has(p.SKU.toUpperCase()) &&
        matchesBrand(p.SKU)
      );
      newProducts.push(...candidates);
      for (const p of products) if (p.ID > highestSeenId) highestSeenId = p.ID;

      if (candidates.length === 0) consecEmpty++; else consecEmpty = 0;
      if (page % 5 === 0) console.log(`page ${page}: +${candidates.length} new (running ${newProducts.length})`);

      if (products.length < PAGE_LIMIT) break;        // last page
      if (consecEmpty >= MAX_CONSEC_EMPTY && newProducts.length > 0) break;
      page++;
    }

    // 5. Upsert
    let imported = 0;
    if (newProducts.length > 0) {
      // Mintsoft exposes EAN (13-digit) and UPC (12-digit) as separate fields.
      const { data: barcodeTypes } = await supabase.from("barcode_types").select("id, type_name, digit_count");
      const classifyBarcode = (raw?: string | null): { barcode: string | null; barcode_type_id: string | null } => {
        const digits = (raw ?? "").replace(/\D/g, "");
        if (!digits) return { barcode: null, barcode_type_id: null };
        const exact = barcodeTypes?.find((t: any) => t.digit_count === digits.length);
        const other = barcodeTypes?.find((t: any) => t.type_name === "Other");
        return { barcode: digits, barcode_type_id: (exact?.id ?? other?.id) ?? null };
      };
      const rows = newProducts.map((p) => ({
        sku: p.SKU,
        name: p.Name || p.SKU,
        ...classifyBarcode(p.EAN || p.UPC),
        mintsoft_product_id: p.ID,
        cost_price: p.CostPrice || null,
        weight: p.Weight || null,
        height: p.Height || null,
        length: p.Length || null,
        depth: p.Depth || null,
        discontinued: p.Discontinued || false,
        low_stock_alert_level: p.LowStockAlertLevel || null,
        handling_time: p.HandlingTime || null,
        discovery_source: "mintsoft_weekly_discovery",
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100);
        const { error } = await supabase
          .from("products_cache")
          .upsert(batch, { onConflict: "sku" });
        if (error) throw new Error(`Upsert: ${error.message}`);
        imported += batch.length;
      }
    }

    const endedAt = new Date();
    const summary = {
      ok: true,
      knownMaxId,
      highestSeenId,
      startPage: estimatedPage,
      pagesScanned,
      newProducts: imported,
      durationMs: endedAt.getTime() - startedAt.getTime(),
    };
    console.log("Discovery done:", summary);

    await supabase.from("edge_function_runs").insert({
      function_name: "mintsoft-discover-new-products",
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      duration_ms: summary.durationMs,
      status: "success",
      message: `Discovered ${imported} new products (scanned ${pagesScanned} pages)`,
      details: summary,
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Discovery error:", msg);
    await supabase.from("edge_function_runs").insert({
      function_name: "mintsoft-discover-new-products",
      started_at: startedAt.toISOString(),
      ended_at: new Date().toISOString(),
      status: "error",
      message: msg,
    });
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
