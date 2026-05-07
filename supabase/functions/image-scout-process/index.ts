// Image Scout — robust multi-candidate agent.
// Strategy: build a ranked list of candidate image URLs from (1) brand pattern,
// (2) Firecrawl search on brand domain, (3) Google CSE image search (brand site),
// (4) Google CSE image search (open web). Walk candidates until one passes the
// resolution gate. Then bg-remove via Lovable AI and upload.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";
const GOOGLE_CSE_API_KEY = Deno.env.get("GOOGLE_CSE_API_KEY") ?? "";
const GOOGLE_CSE_CX = Deno.env.get("GOOGLE_CSE_CX") ?? "";

const MIN_DIM = 380; // relaxed from 500

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Job = {
  id: string;
  sku: string;
  brand_id: string | null;
  mode: "targeted" | "open_search";
  source_url: string | null;
  override_search_term: string | null;
};

type Brand = { name: string; prefix: string | null; image_url_pattern: string | null; image_search_domain: string | null } | null;

type Candidate = { imageUrl: string; pageUrl: string | null; source: string };

// ---------------- helpers ----------------

async function pickJob(jobId?: string): Promise<Job | null> {
  if (jobId) {
    const { data } = await supa.from("image_scout_jobs")
      .select("id, sku, brand_id, mode, source_url, override_search_term")
      .eq("id", jobId).maybeSingle();
    return data as Job | null;
  }
  const { data } = await supa.from("image_scout_jobs")
    .select("id, sku, brand_id, mode, source_url, override_search_term")
    .eq("status", "queued").order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data as Job | null;
}

async function recordResult(job: Job, outcome: string, fields: Record<string, unknown>) {
  await supa.from("image_scout_results").insert({ job_id: job.id, sku: job.sku, outcome, ...fields });
}
async function setJobStatus(id: string, status: string, patch: Record<string, unknown> = {}) {
  await supa.from("image_scout_jobs").update({ status, ...patch }).eq("id", id);
}

async function getBrand(brandId: string | null): Promise<Brand> {
  if (!brandId) return null;
  const { data } = await supa.from("brands")
    .select("name, prefix, image_url_pattern, image_search_domain")
    .eq("id", brandId).maybeSingle();
  return data as Brand;
}

// Strip brand prefix from SKU. e.g. "FA1-076.682.005" → "076.682.005"
function stripPrefix(sku: string, prefix: string | null): string {
  if (!prefix) return sku;
  const upPrefix = prefix.toUpperCase();
  const upSku = sku.toUpperCase();
  for (const sep of ["-", "/", "_", ""]) {
    const candidate = upPrefix + sep;
    if (upSku.startsWith(candidate)) return sku.slice(candidate.length);
  }
  return sku;
}

async function fetchBytes(url: string): Promise<{ bytes: Uint8Array; ct: string } | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; ImageScout/1.0)" } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/") && !url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 2000) return null; // tiny — likely placeholder/icon
    return { bytes: buf, ct: ct || "image/jpeg" };
  } catch {
    return null;
  }
}

function imageDims(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
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
  if (bytes.length > 30 && bytes[0] === 0x52 && bytes[8] === 0x57) {
    if (bytes[12] === 0x56 && bytes[13] === 0x50 && bytes[14] === 0x38 && bytes[15] === 0x58) {
      const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { w, h };
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out;
}

async function bgRemoveAndNormalise(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      modalities: ["image", "text"],
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Remove the background completely and replace with pure white (#FFFFFF). Keep the product centred, do not crop, no shadows, no text, no watermark, no border. Return only a clean square 1000x1000 image." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      }],
    }),
  });
  if (!r.ok) { console.error("AI gateway", r.status, await r.text()); return null; }
  const j = await r.json();
  const imgs = j?.choices?.[0]?.message?.images;
  if (Array.isArray(imgs) && imgs[0]?.image_url?.url) {
    const m = (imgs[0].image_url.url as string).match(/^data:[^;]+;base64,(.+)$/);
    if (m) return base64ToBytes(m[1]);
  }
  return null;
}

async function uploadFinal(sku: string, bytes: Uint8Array): Promise<string> {
  const path = `${sku}.png`;
  const { error } = await supa.storage.from("product-images").upload(path, bytes, {
    contentType: "image/png", upsert: true,
  });
  if (error) throw error;
  return path;
}

// ---------------- candidate discovery ----------------

async function extractImagesFromPage(pageUrl: string, originUrl: string): Promise<string[]> {
  const out: string[] = [];
  let html = "";
  if (FIRECRAWL_API_KEY) {
    try {
      const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: pageUrl, formats: ["html"], onlyMainContent: false }),
      });
      if (r.ok) {
        const j = await r.json();
        html = j?.data?.html || j?.html || "";
      }
    } catch { /* ignore */ }
  }
  if (!html) {
    try {
      const r = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0 ImageScout/1.0" } });
      if (r.ok) html = await r.text();
    } catch { /* ignore */ }
  }
  if (!html) return out;

  const push = (u: string | undefined) => {
    if (!u) return;
    try {
      const abs = new URL(u, originUrl).toString();
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(abs) && !out.includes(abs)) out.push(abs);
    } catch { /* skip */ }
  };

  // Priority: og:image, twitter:image, then all <img src> and srcset
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i); push(og?.[1]);
  const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i); push(tw?.[1]);

  const imgs = html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi);
  for (const m of imgs) push(m[1]);

  const srcsets = html.matchAll(/srcset=["']([^"']+)["']/gi);
  for (const m of srcsets) {
    for (const part of m[1].split(",")) {
      const u = part.trim().split(/\s+/)[0]; push(u);
    }
  }

  // De-prioritise obvious logos/icons/sprites
  return out.filter((u) => !/logo|sprite|icon|placeholder|favicon|loader|spinner/i.test(u));
}

async function firecrawlSearch(query: string, limit = 5): Promise<Array<{ url: string; title?: string }>> {
  if (!FIRECRAWL_API_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    if (!r.ok) return [];
    const j = await r.json();
    const results: any[] = j?.data || j?.web?.results || j?.web || [];
    return results.map((r: any) => ({ url: r.url, title: r.title })).filter((x) => x.url);
  } catch {
    return [];
  }
}

async function googleImageSearch(query: string, restrictDomain?: string | null): Promise<Candidate[]> {
  if (!GOOGLE_CSE_API_KEY || !GOOGLE_CSE_CX) return [];
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  u.searchParams.set("key", GOOGLE_CSE_API_KEY);
  u.searchParams.set("cx", GOOGLE_CSE_CX);
  u.searchParams.set("q", query);
  u.searchParams.set("searchType", "image");
  u.searchParams.set("num", "10");
  if (restrictDomain) u.searchParams.set("siteSearch", restrictDomain);
  try {
    const r = await fetch(u.toString());
    if (!r.ok) { console.error("CSE", r.status, await r.text()); return []; }
    const j = await r.json();
    const items: any[] = j?.items ?? [];
    items.sort((a, b) => ((b.image?.width || 0) * (b.image?.height || 0)) - ((a.image?.width || 0) * (a.image?.height || 0)));
    return items
      .filter((it) => !/logo|sprite|icon|favicon|placeholder/i.test(it.link || ""))
      .map((it) => ({ imageUrl: it.link, pageUrl: it.image?.contextLink ?? null, source: restrictDomain ? `cse:${restrictDomain}` : "cse:open" }));
  } catch (e) {
    console.error("CSE failed", e);
    return [];
  }
}

async function buildCandidates(job: Job, brand: Brand): Promise<{ candidates: Candidate[]; notes: string[] }> {
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  const cleanSku = stripPrefix(job.sku, brand?.prefix ?? null);
  const brandName = brand?.name ?? "";
  const searchTerm = (job.override_search_term && job.override_search_term.trim()) || cleanSku;

  // 1. Direct source URL (user-provided product page)
  if (job.source_url) {
    const imgs = await extractImagesFromPage(job.source_url, job.source_url);
    for (const i of imgs.slice(0, 10)) candidates.push({ imageUrl: i, pageUrl: job.source_url, source: "source_url" });
    notes.push(`source_url page → ${imgs.length} candidate images`);
  }

  // 2. Brand image_url_pattern
  if (brand?.image_url_pattern) {
    if (brand.image_url_pattern.includes("{sku}") || brand.image_url_pattern.includes("{cleansku}")) {
      const url = brand.image_url_pattern
        .replaceAll("{sku}", encodeURIComponent(job.sku))
        .replaceAll("{cleansku}", encodeURIComponent(cleanSku));
      // If pattern is direct image URL, push as candidate; otherwise treat as page
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) {
        candidates.push({ imageUrl: url, pageUrl: null, source: "brand_pattern" });
        notes.push(`brand pattern direct image → ${url}`);
      } else {
        const imgs = await extractImagesFromPage(url, url);
        for (const i of imgs.slice(0, 10)) candidates.push({ imageUrl: i, pageUrl: url, source: "brand_pattern_page" });
        notes.push(`brand pattern page → ${imgs.length} candidate images`);
      }
    }
  }

  // 3. Firecrawl search on brand domain (find product page, then extract images)
  if (FIRECRAWL_API_KEY && brand?.image_search_domain) {
    const q = `site:${brand.image_search_domain} ${searchTerm}`;
    const results = await firecrawlSearch(q, 3);
    notes.push(`firecrawl site search "${q}" → ${results.length} pages`);
    for (const r of results.slice(0, 3)) {
      const imgs = await extractImagesFromPage(r.url, r.url);
      for (const i of imgs.slice(0, 6)) candidates.push({ imageUrl: i, pageUrl: r.url, source: "firecrawl_brand" });
    }
  }

  // 4. Google CSE — restricted to brand domain
  if (GOOGLE_CSE_API_KEY && brand?.image_search_domain) {
    const cse = await googleImageSearch(`${brandName} ${searchTerm}`, brand.image_search_domain);
    notes.push(`CSE on ${brand.image_search_domain} → ${cse.length} images`);
    candidates.push(...cse);
  }

  // 5. Google CSE — open web (always run as fallback)
  if (GOOGLE_CSE_API_KEY) {
    const cse = await googleImageSearch(`${brandName} ${searchTerm} part`.trim());
    notes.push(`CSE open web → ${cse.length} images`);
    candidates.push(...cse);
    if (cleanSku !== job.sku) {
      const cse2 = await googleImageSearch(searchTerm);
      notes.push(`CSE open web (clean sku) → ${cse2.length} images`);
      candidates.push(...cse2);
    }
  }

  // De-dup
  const seen = new Set<string>();
  const dedup = candidates.filter((c) => {
    if (seen.has(c.imageUrl)) return false;
    seen.add(c.imageUrl); return true;
  });
  return { candidates: dedup, notes };
}

// ---------------- main ----------------

async function processJob(job: Job): Promise<{ outcome: string; detail?: string }> {
  await setJobStatus(job.id, "running", { started_at: new Date().toISOString() });
  const brand = await getBrand(job.brand_id);

  const { candidates, notes } = await buildCandidates(job, brand);
  console.log(`Job ${job.sku}: ${candidates.length} candidates. Notes: ${notes.join(" | ")}`);

  if (candidates.length === 0) {
    await recordResult(job, "no_match", { notes: `no candidates. ${notes.join(" | ")}` });
    await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: "no candidates found" });
    return { outcome: "no_match" };
  }

  // Walk candidates until one passes the resolution gate
  let bestSmall: { c: Candidate; dims: { w: number; h: number } } | null = null;
  let attempted = 0;
  const MAX_ATTEMPTS = 12;

  for (const c of candidates) {
    if (attempted >= MAX_ATTEMPTS) break;
    attempted++;
    const fetched = await fetchBytes(c.imageUrl);
    if (!fetched) continue;
    const dims = imageDims(fetched.bytes);
    if (!dims) continue;

    if (dims.w >= MIN_DIM && dims.h >= MIN_DIM) {
      // Try bg-remove
      const cleaned = await bgRemoveAndNormalise(fetched.bytes, fetched.ct);
      if (!cleaned) {
        // Upload raw as needs-review fallback then keep walking
        await recordResult(job, "watermark_review", {
          source_page_url: c.pageUrl, source_image_url: c.imageUrl,
          raw_width: dims.w, raw_height: dims.h,
          notes: `bg-removal failed via ${c.source}; review`,
        });
        await setJobStatus(job.id, "needs_review", { finished_at: new Date().toISOString() });
        return { outcome: "watermark_review" };
      }
      try {
        const path = await uploadFinal(job.sku, cleaned);
        await recordResult(job, "stored", {
          source_page_url: c.pageUrl, source_image_url: c.imageUrl,
          raw_width: dims.w, raw_height: dims.h, storage_path: path,
          notes: `via ${c.source} (attempt ${attempted}/${candidates.length})`,
        });
        await setJobStatus(job.id, "success", { finished_at: new Date().toISOString() });
        return { outcome: "stored", detail: path };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("upload failed", msg);
        continue;
      }
    } else {
      // remember best small one in case nothing larger appears
      if (!bestSmall || (dims.w * dims.h > bestSmall.dims.w * bestSmall.dims.h)) {
        bestSmall = { c, dims };
      }
    }
  }

  // No large image found — flag for review with the best small candidate
  if (bestSmall) {
    await recordResult(job, "low_res", {
      source_page_url: bestSmall.c.pageUrl, source_image_url: bestSmall.c.imageUrl,
      raw_width: bestSmall.dims.w, raw_height: bestSmall.dims.h,
      notes: `${attempted} candidates tried, all under ${MIN_DIM}px. Best: ${bestSmall.dims.w}x${bestSmall.dims.h} via ${bestSmall.c.source}`,
    });
    await setJobStatus(job.id, "needs_review", { finished_at: new Date().toISOString(), error: "low resolution" });
    return { outcome: "low_res" };
  }

  await recordResult(job, "no_match", { notes: `tried ${attempted} candidates, none usable. ${notes.join(" | ")}` });
  await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: `tried ${attempted} candidates` });
  return { outcome: "no_match" };
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
