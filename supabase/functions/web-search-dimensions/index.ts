// web-search-dimensions
// ---------------------------------------------------------------------------
// Web Searcher › Dims & Weights worker.
// For each candidate SKU (active, missing dims, barcode preferred), search the
// web (Brave primary, SERP fallback) keyed on EAN → product name, hand the
// result snippets to Claude to extract PACKAGED dimensions + weight with a
// confidence rating, and write a proposal row to web_search_proposals for
// human review. Never writes to Mintsoft (that's a separate local script;
// Mintsoft blocks Supabase IPs). On approval, the UI writes products_cache.
//
// Body (all optional):
//   { dryRun?: boolean=true, limit?: number, skus?: string[], brandIds?: string[] }
// dryRun=true (default) returns findings WITHOUT inserting proposals — use it
// for the first test runs.
//
// Secrets used: BRAVE_API_KEY, SERP_API_KEY, ANTHROPIC_API_KEY,
//               SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-injected).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const TOOL = "dims_weights";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Snippet = { title: string; text: string; url: string };

// ── Search providers ───────────────────────────────────────────────────────
async function braveSearch(q: string): Promise<Snippet[]> {
  const key = Deno.env.get("BRAVE_API_KEY");
  if (!key) return [];
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=10`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" } },
  );
  if (!res.ok) {
    console.warn(`Brave ${res.status} for "${q}"`);
    return [];
  }
  const data = await res.json();
  return (data?.web?.results ?? []).map((r: any) => ({
    title: r.title ?? "",
    text: r.description ?? "",
    url: r.url ?? "",
  }));
}

// NOTE: assumes SerpAPI (serpapi.com). If the key is for serper.dev, swap to
// POST https://google.serper.dev/search { q } with header X-API-KEY.
async function serpSearch(q: string): Promise<Snippet[]> {
  const key = Deno.env.get("SERP_API_KEY");
  if (!key) return [];
  const res = await fetch(
    `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(q)}&api_key=${key}`,
  );
  if (!res.ok) {
    console.warn(`SERP ${res.status} for "${q}"`);
    return [];
  }
  const data = await res.json();
  return (data?.organic_results ?? []).map((r: any) => ({
    title: r.title ?? "",
    text: r.snippet ?? "",
    url: r.link ?? "",
  }));
}

async function search(q: string): Promise<Snippet[]> {
  let hits = await braveSearch(q);
  if (hits.length < 3) {
    const serp = await serpSearch(q);
    hits = [...hits, ...serp];
  }
  return hits.slice(0, 12);
}

// ── Claude reconciliation ──────────────────────────────────────────────────
type Extracted = {
  found: boolean;
  length_cm: number | null;
  depth_cm: number | null;
  height_cm: number | null;
  weight_g: number | null;
  is_packaged: boolean | null;
  confidence: "high" | "medium" | "low" | null;
  source_count: number;
  source_url: string | null;
  notes?: string;
};

async function extractDims(product: any, snippets: Snippet[]): Promise<Extracted | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY not configured");

  const snippetText = snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.text}\nURL: ${s.url}`)
    .join("\n\n");

  const prompt = `You extract automotive-part SHIPPING dimensions and weight from web search snippets.

PRODUCT
- SKU: ${product.sku}
- Name: ${product.name ?? ""}
- Barcode (EAN): ${product.barcode ?? "none"}

SEARCH SNIPPETS
${snippetText || "(no results)"}

RULES
- PREFER explicit "Packaging length/width/height" fields (the shipping box). Set is_packaged=true.
- If only the bare part / element dimensions are given, use them and set is_packaged=false.
- Dimensions in CENTIMETRES, weight in GRAMS. Convert mm→cm (÷10), kg→g (×1000).
- Map to length/depth/height (any consistent assignment of the three box dims is fine).
- confidence: "high" = EAN-matched packaging dims agreed by 2+ reputable catalogues; "medium" = single source, marketplace, or bare-part dims; "low" = sibling/estimate only.
- source_count = how many distinct sources gave consistent figures.
- source_url = the single best source.
- Do NOT invent numbers. If nothing usable, return found=false.

Return ONLY this JSON, no prose:
{"found":bool,"length_cm":num|null,"depth_cm":num|null,"height_cm":num|null,"weight_g":num|null,"is_packaged":bool|null,"confidence":"high"|"medium"|"low"|null,"source_count":int,"source_url":str|null,"notes":str}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("Anthropic error", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Extracted;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dryRun !== false; // default TRUE
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // settings
    const { data: settings } = await supabase
      .from("web_search_settings").select("*").eq("tool", TOOL).single();
    const batch = body.limit ?? settings?.batch_size ?? 50;
    const recheckDays = settings?.recheck_after_days ?? 90;
    const criteria = settings?.criteria ?? {};
    const padLen = settings?.padding_length_cm ?? 2;
    const padGirth = settings?.padding_girth_cm ?? 0.6;
    const autoApprove = !!settings?.auto_approve;

    // candidates
    let candidates: any[] = [];
    if (Array.isArray(body.skus) && body.skus.length) {
      const { data } = await supabase
        .from("products_cache")
        .select("sku,name,barcode,brand_id,height,length,depth,weight")
        .in("sku", body.skus);
      candidates = data ?? [];
    } else {
      const cutoff = new Date(Date.now() - recheckDays * 864e5).toISOString();
      let q = supabase
        .from("products_cache")
        .select("sku,name,barcode,brand_id,height,length,depth,weight,dim_search_checked_at")
        .eq("active", true)
        .or("height.is.null,length.is.null,depth.is.null")
        .or(`dim_search_checked_at.is.null,dim_search_checked_at.lt.${cutoff}`)
        .order("dim_search_checked_at", { ascending: true, nullsFirst: true })
        .limit(batch);
      if (criteria.require_barcode !== false) q = q.not("barcode", "is", null);
      const brandIds = body.brandIds ?? criteria.brands;
      if (Array.isArray(brandIds) && brandIds.length) q = q.in("brand_id", brandIds);
      const { data } = await q;
      candidates = data ?? [];
    }

    // run record
    let runId: string | null = null;
    if (!dryRun) {
      const { data: run } = await supabase
        .from("web_search_runs")
        .insert({ tool: TOOL, status: "running", criteria, queued: candidates.length })
        .select("id").single();
      runId = run?.id ?? null;
    }

    const results: any[] = [];
    let found = 0, noData = 0, errors = 0;

    for (const p of candidates) {
      try {
        // cascade: EAN first, then product name
        const attempts: { q: string; key: "ean" | "name" }[] = [];
        if (p.barcode) attempts.push({ q: `${p.barcode} packaged dimensions weight cm`, key: "ean" });
        if (p.name) attempts.push({ q: `${p.name} packaged dimensions weight cm`, key: "name" });

        let ext: Extracted | null = null;
        let matchKey: "ean" | "name" | null = null;
        for (const a of attempts) {
          const snippets = await search(a.q);
          ext = await extractDims(p, snippets);
          if (ext?.found) { matchKey = a.key; break; }
        }

        if (!ext?.found) {
          noData++;
          if (!dryRun) {
            await supabase.from("products_cache")
              .update({ dim_search_status: "no_data", dim_search_checked_at: new Date().toISOString() })
              .eq("sku", p.sku);
          }
          results.push({ sku: p.sku, found: false });
          continue;
        }

        // padding when only bare-part dims
        let padded = false;
        let { length_cm, depth_cm, height_cm } = ext;
        if (ext.is_packaged === false && (length_cm || depth_cm || height_cm)) {
          if (length_cm != null) length_cm = +(length_cm + padLen).toFixed(1);
          if (depth_cm != null) depth_cm = +(depth_cm + padGirth).toFixed(1);
          if (height_cm != null) height_cm = +(height_cm + padGirth).toFixed(1);
          padded = true;
        }

        found++;
        const proposal = {
          tool: TOOL,
          sku: p.sku,
          proposed_length_cm: length_cm,
          proposed_depth_cm: depth_cm,
          proposed_height_cm: height_cm,
          proposed_weight_g: ext.weight_g,
          is_packaged: ext.is_packaged,
          padded,
          match_key: matchKey,
          confidence: ext.confidence,
          source_count: ext.source_count ?? 0,
          source_url: ext.source_url,
          notes: ext.notes ?? null,
        };
        results.push(proposal);

        if (!dryRun) {
          const gate = autoApprove && ext.confidence === "high"
            && (ext.source_count ?? 0) >= (settings?.auto_approve_min_sources ?? 2)
            && (!settings?.auto_approve_require_packaged || ext.is_packaged === true);

          // clear any existing open proposal for this sku/tool, then insert
          await supabase.from("web_search_proposals").delete()
            .eq("sku", p.sku).eq("tool", TOOL).in("status", ["pending_review", "approved"]);
          await supabase.from("web_search_proposals").insert({
            ...proposal,
            run_id: runId,
            status: gate ? "applied" : "pending_review",
            applied_at: gate ? new Date().toISOString() : null,
          });

          const update: Record<string, unknown> = {
            dim_search_status: gate ? "applied" : "proposed",
            dim_search_checked_at: new Date().toISOString(),
          };
          if (gate) {
            if (length_cm != null) update.length = length_cm;
            if (depth_cm != null) update.depth = depth_cm;
            if (height_cm != null) update.height = height_cm;
            if (ext.weight_g != null) update.weight = ext.weight_g;
          }
          await supabase.from("products_cache").update(update).eq("sku", p.sku);
        }
      } catch (e) {
        errors++;
        console.error(`SKU ${p.sku} failed:`, e);
      }
      await sleep(250); // gentle on the search/LLM APIs
    }

    if (!dryRun && runId) {
      await supabase.from("web_search_runs").update({
        status: "complete", processed: candidates.length, found, no_data: noData, errors,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
    }

    return json({
      dryRun, queued: candidates.length, processed: candidates.length,
      found, no_data: noData, errors, results,
    });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
