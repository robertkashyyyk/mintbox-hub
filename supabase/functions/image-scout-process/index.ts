// Image Scout: process a single queued job (or by id).
// - Mode 1 (targeted): use brand image_url_pattern with {sku}, else Firecrawl /search on brand domain to find a product page, then /scrape to extract main image.
// - Mode 2 (open_search): Google Custom Search Image API with {brand} {sku} as query.
// Pipeline: fetch raw → reject < 500x500 → bg-remove via Lovable AI Gemini image → upload to product-images/{sku}.png → update products_cache (no image_url col; just storage path is canonical).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
const GOOGLE_CSE_API_KEY = Deno.env.get("GOOGLE_CSE_API_KEY") ?? "";
const GOOGLE_CSE_CX = Deno.env.get("GOOGLE_CSE_CX") ?? "";

const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

type Job = {
  id: string;
  sku: string;
  brand_id: string | null;
  mode: "targeted" | "open_search";
  source_url: string | null;
  override_search_term: string | null;
};

async function pickJob(jobId?: string): Promise<Job | null> {
  if (jobId) {
    const { data } = await supa
      .from("image_scout_jobs")
      .select("id, sku, brand_id, mode, source_url, override_search_term")
      .eq("id", jobId)
      .maybeSingle();
    return data as Job | null;
  }
  const { data } = await supa
    .from("image_scout_jobs")
    .select("id, sku, brand_id, mode, source_url, override_search_term")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data as Job | null;
}

async function recordResult(
  job: Job,
  outcome: string,
  fields: Record<string, unknown>,
) {
  await supa.from("image_scout_results").insert({
    job_id: job.id,
    sku: job.sku,
    outcome,
    ...fields,
  });
}

async function setJobStatus(
  id: string,
  status: string,
  patch: Record<string, unknown> = {},
) {
  await supa.from("image_scout_jobs").update({ status, ...patch }).eq("id", id);
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; ct: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 ImageScout/1.0" } });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    return { bytes: buf, ct: r.headers.get("content-type") ?? "image/jpeg" };
  } catch {
    return null;
  }
}

// Lightweight image dimensions parser for PNG/JPEG/WebP.
function imageDims(bytes: Uint8Array): { w: number; h: number } | null {
  // PNG: 8-byte sig, then IHDR length(4)+'IHDR'(4)+w(4)+h(4)
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // JPEG: scan SOF markers
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = (bytes[i + 5] << 8) | bytes[i + 6];
        const w = (bytes[i + 7] << 8) | bytes[i + 8];
        return { w, h };
      }
      i += 2 + len;
    }
  }
  // WebP VP8/VP8L/VP8X
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[8] === 0x57) {
    // crude VP8X
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
      const w = 1 + ((bytes[24]) | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + ((bytes[27]) | (bytes[28] << 8) | (bytes[29] << 16));
      return { w, h };
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Use Lovable AI gemini image to remove background and standardise to clean white background 1000x1000.
async function bgRemoveAndNormalise(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      modalities: ["image", "text"],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Remove the background from this product photograph completely and replace it with a clean pure white background (#FFFFFF). Keep the product centred, do not crop, do not add shadows, do not add any text, watermark, or border. Return only the processed image as a clean square 1000x1000 JPEG-quality image.",
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
  });
  if (!r.ok) {
    console.error("AI gateway error", r.status, await r.text());
    return null;
  }
  const j = await r.json();
  const imgs = j?.choices?.[0]?.message?.images;
  if (Array.isArray(imgs) && imgs[0]?.image_url?.url) {
    const url = imgs[0].image_url.url as string;
    const m = url.match(/^data:[^;]+;base64,(.+)$/);
    if (m) return base64ToBytes(m[1]);
  }
  return null;
}

async function uploadFinal(sku: string, bytes: Uint8Array): Promise<string> {
  const path = `${sku}.png`;
  const { error } = await supa.storage
    .from("product-images")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) throw error;
  return path;
}

async function getBrand(brandId: string | null) {
  if (!brandId) return null;
  const { data } = await supa
    .from("brands")
    .select("name, image_url_pattern, image_search_domain")
    .eq("id", brandId)
    .maybeSingle();
  return data as { name: string; image_url_pattern: string | null; image_search_domain: string | null } | null;
}

async function findImageMode1(job: Job, brand: Awaited<ReturnType<typeof getBrand>>): Promise<{ pageUrl: string | null; imageUrl: string | null; note?: string }> {
  // Direct page URL provided
  if (job.source_url) {
    const imageUrl = await scrapePageForMainImage(job.source_url);
    return { pageUrl: job.source_url, imageUrl };
  }
  // Pattern with {sku}
  if (brand?.image_url_pattern && brand.image_url_pattern.includes("{sku}")) {
    const pageUrl = brand.image_url_pattern.replaceAll("{sku}", encodeURIComponent(job.sku));
    const imageUrl = await scrapePageForMainImage(pageUrl);
    return { pageUrl, imageUrl };
  }
  // Firecrawl search fallback
  if (FIRECRAWL_API_KEY && brand?.image_search_domain) {
    const q = `site:${brand.image_search_domain} ${job.sku}`;
    const sr = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, limit: 3 }),
    });
    if (sr.ok) {
      const sd = await sr.json();
      const first = sd?.data?.[0]?.url || sd?.web?.[0]?.url;
      if (first) {
        const imageUrl = await scrapePageForMainImage(first);
        return { pageUrl: first, imageUrl };
      }
    }
    return { pageUrl: null, imageUrl: null, note: "no firecrawl results" };
  }
  return { pageUrl: null, imageUrl: null, note: "no pattern or domain configured" };
}

async function scrapePageForMainImage(pageUrl: string): Promise<string | null> {
  if (!FIRECRAWL_API_KEY) {
    // Fallback: plain fetch and regex og:image
    try {
      const r = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 ImageScout/1.0" } });
      const html = await r.text();
      const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
        || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);
      return m?.[1] ?? null;
    } catch {
      return null;
    }
  }
  const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: pageUrl, formats: ["html", "links"], onlyMainContent: true }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const html: string | undefined = j?.data?.html || j?.html;
  if (html) {
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
    if (og) return og[1];
    const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i);
    if (tw) return tw[1];
    // first <img> with reasonable size attributes
    const img = html.match(/<img[^>]+src=["']([^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i);
    if (img) return new URL(img[1], pageUrl).toString();
  }
  return null;
}

async function findImageMode2(job: Job, brand: Awaited<ReturnType<typeof getBrand>>): Promise<{ imageUrl: string | null; pageUrl: string | null }> {
  if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_CX) {
    return { imageUrl: null, pageUrl: null };
  }
  const term = job.override_search_term || `${brand?.name ?? ""} ${job.sku}`.trim();
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", GOOGLE_CSE_API_KEY);
  u.searchParams.set("cx", GOOGLE_CSE_CX);
  u.searchParams.set("q", `${term} product image`);
  u.searchParams.set("searchType", "image");
  u.searchParams.set("imgSize", "large");
  u.searchParams.set("num", "5");
  const r = await fetch(u.toString());
  if (!r.ok) {
    console.error("CSE error", r.status, await r.text());
    return { imageUrl: null, pageUrl: null };
  }
  const j = await r.json();
  // Pick first item that meets resolution heuristic (width+height in image meta)
  const items = j?.items as any[] | undefined;
  if (!items?.length) return { imageUrl: null, pageUrl: null };
  // Sort by area desc
  items.sort((a, b) => (b.image?.width * b.image?.height || 0) - (a.image?.width * a.image?.height || 0));
  const top = items[0];
  return { imageUrl: top.link as string, pageUrl: (top.image?.contextLink as string) ?? null };
}

async function processJob(job: Job): Promise<{ outcome: string; detail?: string }> {
  await setJobStatus(job.id, "running", { started_at: new Date().toISOString(), attempts: undefined });
  await supa.rpc; // no-op type guard

  const brand = await getBrand(job.brand_id);

  // 1. Locate candidate image
  let imageUrl: string | null = null;
  let pageUrl: string | null = null;
  let locateNote: string | undefined;
  if (job.mode === "targeted") {
    const r = await findImageMode1(job, brand);
    imageUrl = r.imageUrl;
    pageUrl = r.pageUrl;
    locateNote = r.note;
  } else {
    const r = await findImageMode2(job, brand);
    imageUrl = r.imageUrl;
    pageUrl = r.pageUrl;
  }

  if (!imageUrl) {
    await recordResult(job, "no_match", { source_page_url: pageUrl, notes: locateNote ?? "no image found" });
    await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: "no image found" });
    return { outcome: "no_match" };
  }

  // 2. Fetch raw bytes
  const fetched = await fetchBytes(imageUrl);
  if (!fetched) {
    await recordResult(job, "error", { source_page_url: pageUrl, source_image_url: imageUrl, notes: "fetch failed" });
    await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: "fetch failed" });
    return { outcome: "error" };
  }

  // 3. Resolution gate
  const dims = imageDims(fetched.bytes);
  if (!dims || dims.w < 500 || dims.h < 500) {
    await recordResult(job, "low_res", {
      source_page_url: pageUrl,
      source_image_url: imageUrl,
      raw_width: dims?.w ?? null,
      raw_height: dims?.h ?? null,
      notes: `dims ${dims?.w}x${dims?.h}`,
    });
    await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: "low resolution" });
    return { outcome: "low_res" };
  }

  // 4. Background removal via Lovable AI Gemini
  const cleaned = await bgRemoveAndNormalise(fetched.bytes, fetched.ct);
  if (!cleaned) {
    // Still upload raw as a fallback to needs_review
    await recordResult(job, "watermark_review", {
      source_page_url: pageUrl,
      source_image_url: imageUrl,
      raw_width: dims.w,
      raw_height: dims.h,
      notes: "bg-removal failed; flagged for human review",
    });
    await setJobStatus(job.id, "needs_review", { finished_at: new Date().toISOString() });
    return { outcome: "watermark_review" };
  }

  // 5. Upload final
  try {
    const path = await uploadFinal(job.sku, cleaned);
    await recordResult(job, "stored", {
      source_page_url: pageUrl,
      source_image_url: imageUrl,
      raw_width: dims.w,
      raw_height: dims.h,
      storage_path: path,
    });
    await setJobStatus(job.id, "success", { finished_at: new Date().toISOString() });
    return { outcome: "stored", detail: path };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await recordResult(job, "error", { source_page_url: pageUrl, source_image_url: imageUrl, notes: `upload: ${msg}` });
    await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: msg });
    return { outcome: "error", detail: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body: { job_id?: string; pick?: boolean } = {};
    try { body = await req.json(); } catch { /* allow empty */ }

    const job = await pickJob(body.job_id);
    if (!job) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "no jobs queued" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = await processJob(job);
    return new Response(JSON.stringify({ ok: true, processed: 1, job_id: job.id, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("image-scout-process error", e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
