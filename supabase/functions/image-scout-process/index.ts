// Image Scout — Firecrawl + Lovable AI flow.
// 1) Resolve brand → strip prefix to native part number.
// 2) Firecrawl /search with brand+native variants (prefer site:brand.tld).
// 3) Firecrawl /scrape each top result → extract og:image + <img> URLs.
// 4) Lovable AI vision pass picks the real product image from candidates.
// 5) Aspect-ratio + resolution gates → bg-remove → upload.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY") ?? "";

const MIN_DIM = 380;
const MIN_AR = 0.5;   // reject very wide/tall (banners)
const MAX_AR = 2.0;
const MAX_SCRAPE_PAGES = 6;
const MAX_CANDIDATES_TO_TRY = 10;

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Job = {
  id: string;
  sku: string;
  brand_id: string | null;
  mode: "targeted" | "open_search";
  source_url: string | null;
  override_search_term: string | null;
};

type Brand = { id: string; name: string; prefix: string | null; image_url_pattern: string | null; image_search_domain: string | null } | null;

type BrandProfile = {
  preferred_domains: string[];
  blocked_domains: string[];
  search_templates: string[];
  image_rules: Record<string, unknown>;
} | null;

type Candidate = {
  imageUrl: string;
  pageUrl: string | null;
  source: string;
  fromTemplate?: string | null;
  pageText?: string;
  score?: number;
  reasoning?: string[];
};

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
    .select("id, name, prefix, image_url_pattern, image_search_domain")
    .eq("id", brandId).maybeSingle();
  return data as Brand;
}

async function getBrandProfile(brandId: string | null): Promise<BrandProfile> {
  if (!brandId) return null;
  const { data } = await supa.from("brand_image_profiles")
    .select("preferred_domains, blocked_domains, search_templates, image_rules")
    .eq("brand_id", brandId).maybeSingle();
  return data as BrandProfile;
}

function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return null; }
}

function expandTemplate(tpl: string, vars: { brand: string; part_number: string; sku: string }): string {
  return tpl
    .replaceAll("{brand}", vars.brand)
    .replaceAll("{part_number}", vars.part_number)
    .replaceAll("{cleansku}", vars.part_number)
    .replaceAll("{sku}", vars.sku)
    .trim();
}

function scoreCandidate(
  c: Candidate,
  ctx: { partNumber: string; brand: string; preferred: Set<string>; blocked: Set<string>; manufacturerHost?: string | null },
): { score: number; reasoning: string[]; rejected: boolean } {
  const reasoning: string[] = [];
  let score = 0;
  const host = hostOf(c.pageUrl) || hostOf(c.imageUrl);
  if (host && ctx.blocked.has(host)) {
    return { score: -999, reasoning: [`blocked: ${host}`], rejected: true };
  }
  const url = c.imageUrl.toLowerCase();
  const page = (c.pageText || "").toLowerCase();
  const pn = ctx.partNumber.toLowerCase();
  const brand = ctx.brand.toLowerCase();

  if (pn && page.includes(pn)) { score += 25; reasoning.push("+25 part# on page"); }
  if (brand && page.includes(brand)) { score += 15; reasoning.push("+15 brand on page"); }
  if (pn && url.includes(pn)) { score += 10; reasoning.push("+10 part# in image url"); }

  if (host && ctx.preferred.has(host)) { score += 20; reasoning.push(`+20 preferred domain ${host}`); }
  if (host && ctx.manufacturerHost && host.endsWith(ctx.manufacturerHost)) { score += 10; reasoning.push("+10 manufacturer domain"); }

  const w = c.imageUrl.match(/(\d{3,4})x(\d{3,4})/);
  if (w) {
    const dim = parseInt(w[1]);
    if (dim >= 800) { score += 15; reasoning.push("+15 likely ≥800px"); }
    if (dim >= 1500) { score += 5; reasoning.push("+5 likely ≥1500px"); }
  }

  if (/diagram|schematic|exploded|fitment-chart/i.test(url + " " + page)) { score -= 20; reasoning.push("-20 diagram hint"); }
  if (/lifestyle|vehicle-fitted|installed-on/i.test(url + " " + page)) { score -= 15; reasoning.push("-15 lifestyle hint"); }
  if (/watermark/i.test(url)) { score -= 10; reasoning.push("-10 watermark hint"); }
  if (/thumb|_sm|small|icon|logo|sprite|placeholder/i.test(url)) { score -= 15; reasoning.push("-15 thumbnail/icon hint"); }

  return { score, reasoning, rejected: false };
}

async function recordCandidates(jobId: string, sku: string, brandId: string | null, ranked: Candidate[], pickedUrl?: string | null) {
  if (ranked.length === 0) return;
  const rows = ranked.map((c) => ({
    job_id: jobId,
    sku,
    brand_id: brandId,
    source_url: c.pageUrl,
    image_url: c.imageUrl,
    source_domain: hostOf(c.pageUrl) || hostOf(c.imageUrl),
    from_template: c.fromTemplate ?? null,
    confidence_score: c.score ?? 0,
    confidence_reasoning: c.reasoning ?? [],
    picked: pickedUrl ? c.imageUrl === pickedUrl : false,
  }));
  await supa.from("image_scout_candidates").insert(rows);
}

async function recordSuggestion(brandId: string, kind: "domain" | "template", value: string) {
  if (!value) return;
  // upsert with increment
  const { data: existing } = await supa.from("brand_image_profile_suggestions")
    .select("id, success_count").eq("brand_id", brandId).eq("kind", kind).eq("value", value).maybeSingle();
  if (existing) {
    await supa.from("brand_image_profile_suggestions")
      .update({ success_count: (existing.success_count ?? 0) + 1, last_used: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supa.from("brand_image_profile_suggestions").insert({
      brand_id: brandId, kind, value, success_count: 1,
    });
  }
}

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
    if (buf.length < 2000) return null;
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
  if (!r.ok) { console.error("AI gateway bgRemove", r.status, await r.text()); return null; }
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

// ---------------- Firecrawl ----------------

async function firecrawlSearch(query: string, limit = 5): Promise<Array<{ url: string; title?: string }>> {
  if (!FIRECRAWL_API_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    if (!r.ok) { console.error("firecrawl search", r.status, await r.text()); return []; }
    const j = await r.json();
    const results: any[] = j?.data?.web || j?.data || j?.web?.results || j?.web || [];
    return results.map((x: any) => ({ url: x.url, title: x.title })).filter((x) => x.url);
  } catch (e) {
    console.error("firecrawl search exception", e);
    return [];
  }
}

async function firecrawlScrapeImages(pageUrl: string): Promise<{ images: string[]; text: string }> {
  if (!FIRECRAWL_API_KEY) return { images: [], text: "" };
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl, formats: ["html", "links", "markdown"], onlyMainContent: false }),
    });
    if (!r.ok) return { images: [], text: "" };
    const j = await r.json();
    const html: string = j?.data?.html || j?.html || "";
    const md: string = j?.data?.markdown || j?.markdown || "";
    const links: string[] = j?.data?.links || j?.links || [];
    const out: string[] = [];
    const push = (u: string | undefined) => {
      if (!u) return;
      try {
        const abs = new URL(u, pageUrl).toString();
        if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(abs) && !out.includes(abs)) out.push(abs);
      } catch { /* skip */ }
    };
    if (html) {
      const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i); push(og?.[1]);
      const tw = html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i); push(tw?.[1]);
      for (const m of html.matchAll(/<img[^>]+(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi)) push(m[1]);
      for (const m of html.matchAll(/srcset=["']([^"']+)["']/gi)) {
        for (const part of m[1].split(",")) push(part.trim().split(/\s+/)[0]);
      }
    }
    for (const l of links) push(l);
    return {
      images: out.filter((u) => !/logo|sprite|icon|placeholder|favicon|loader|spinner|banner|hero[-_/]/i.test(u)),
      text: md.slice(0, 8000),
    };
  } catch (e) {
    console.error("firecrawl scrape exception", e);
    return { images: [], text: "" };
  }
}

// ---------------- AI candidate ranking ----------------

async function aiPickBestImage(
  sku: string,
  cleanSku: string,
  brandName: string,
  candidates: Candidate[],
): Promise<number[]> {
  // returns ordered indices, best first
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return [0];
  try {
    const list = candidates.map((c, i) => `${i}: ${c.imageUrl} (page: ${c.pageUrl ?? "-"}, src: ${c.source})`).join("\n");
    const prompt = `You help find the best product photograph for an automotive part.
Brand: ${brandName || "(unknown)"}
SKU: ${sku}
Native part number: ${cleanSku}

Here is a list of candidate image URLs scraped from search results:
${list}

Rank these from MOST LIKELY to be the actual product photo to LEAST LIKELY.
Reject obvious banners, logos, category headers, related-product thumbnails, and unrelated images.
Prefer URLs whose filename or path contains the part number (${cleanSku}).
Respond ONLY with a JSON array of indices, best first, e.g. [3,0,7].`;
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) { console.error("AI rank", r.status, await r.text()); return candidates.map((_, i) => i); }
    const j = await r.json();
    const txt: string = j?.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\[[\s\S]*?\]/);
    if (!m) return candidates.map((_, i) => i);
    const arr = JSON.parse(m[0]);
    if (!Array.isArray(arr)) return candidates.map((_, i) => i);
    const filtered = arr.filter((n: any) => Number.isInteger(n) && n >= 0 && n < candidates.length);
    // append any not mentioned
    for (let i = 0; i < candidates.length; i++) if (!filtered.includes(i)) filtered.push(i);
    return filtered;
  } catch (e) {
    console.error("aiPickBestImage exception", e);
    return candidates.map((_, i) => i);
  }
}

// ---------------- candidate discovery ----------------

async function buildCandidates(job: Job, brand: Brand, profile: BrandProfile): Promise<{ candidates: Candidate[]; notes: string[] }> {
  const candidates: Candidate[] = [];
  const notes: string[] = [];
  const cleanSku = stripPrefix(job.sku, brand?.prefix ?? null);
  const brandName = brand?.name ?? "";
  const brandDomain = brand?.image_search_domain ?? null;
  const searchTerm = (job.override_search_term && job.override_search_term.trim()) || cleanSku;

  const preferred = new Set<string>([
    ...(profile?.preferred_domains ?? []),
    ...(brandDomain ? [brandDomain] : []),
  ].map((d) => d.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")));
  const blocked = new Set<string>((profile?.blocked_domains ?? []).map((d) => d.replace(/^www\./, "")));

  notes.push(`sku=${job.sku} clean=${cleanSku} brand=${brandName || "?"} preferred=[${[...preferred].join(",")}] blocked=[${[...blocked].join(",")}]`);

  // 1. Direct source URL
  if (job.source_url) {
    const { images, text } = await firecrawlScrapeImages(job.source_url);
    for (const i of images.slice(0, 12)) candidates.push({ imageUrl: i, pageUrl: job.source_url, source: "source_url", pageText: text });
    notes.push(`source_url → ${images.length} imgs`);
  }

  // 2. Brand pattern (only if fully templated)
  if (brand?.image_url_pattern && (brand.image_url_pattern.includes("{sku}") || brand.image_url_pattern.includes("{cleansku}"))) {
    const url = brand.image_url_pattern
      .replaceAll("{sku}", encodeURIComponent(job.sku))
      .replaceAll("{cleansku}", encodeURIComponent(cleanSku));
    if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) {
      candidates.push({ imageUrl: url, pageUrl: null, source: "brand_pattern" });
      notes.push(`brand_pattern direct → ${url}`);
    }
  }

  // 3. Build queries: profile templates first, then defaults
  const tplVars = { brand: brandName, part_number: searchTerm, sku: job.sku };
  const queries: Array<{ q: string; tpl: string }> = [];
  for (const tpl of profile?.search_templates ?? []) {
    const q = expandTemplate(tpl, tplVars);
    if (q) queries.push({ q, tpl });
  }
  if (queries.length === 0) {
    if (brandDomain) {
      queries.push({ q: `site:${brandDomain} ${searchTerm}`, tpl: `site:{brand_domain} {part_number}` });
      queries.push({ q: `${brandName} ${searchTerm} site:${brandDomain}`, tpl: `{brand} {part_number} site:{brand_domain}` });
    }
    queries.push({ q: `${brandName} ${searchTerm}`.trim(), tpl: "{brand} {part_number}" });
    queries.push({ q: `"${searchTerm}" ${brandName}`.trim(), tpl: `"{part_number}" {brand}` });
  }

  const seenPages = new Set<string>();
  let scraped = 0;
  for (const { q, tpl } of queries) {
    if (scraped >= MAX_SCRAPE_PAGES) break;
    const results = await firecrawlSearch(q, 4);
    notes.push(`search "${q}" → ${results.length} pages`);
    for (const r of results) {
      if (scraped >= MAX_SCRAPE_PAGES) break;
      if (seenPages.has(r.url)) continue;
      const host = hostOf(r.url);
      if (host && blocked.has(host)) continue;
      seenPages.add(r.url);
      scraped++;
      const { images, text } = await firecrawlScrapeImages(r.url);
      const onPreferred = host && preferred.has(host);
      for (const i of images.slice(0, 8)) candidates.push({
        imageUrl: i, pageUrl: r.url, source: onPreferred ? "preferred_domain" : "open_search",
        fromTemplate: tpl, pageText: text,
      });
    }
  }

  // De-dup
  const seen = new Set<string>();
  const dedup = candidates.filter((c) => {
    if (seen.has(c.imageUrl)) return false;
    seen.add(c.imageUrl); return true;
  });

  // Score everything
  const manufacturerHost = brandDomain ? brandDomain.replace(/^www\./, "") : null;
  for (const c of dedup) {
    const { score, reasoning } = scoreCandidate(c, {
      partNumber: cleanSku, brand: brandName, preferred, blocked, manufacturerHost,
    });
    c.score = score;
    c.reasoning = reasoning;
  }
  dedup.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  notes.push(`total candidates: ${dedup.length}`);
  return { candidates: dedup, notes };
}

// ---------------- main ----------------

async function processJob(job: Job): Promise<{ outcome: string; detail?: string }> {
  await setJobStatus(job.id, "running", { started_at: new Date().toISOString() });
  const brand = await getBrand(job.brand_id);
  const profile = await getBrandProfile(job.brand_id);
  const cleanSku = stripPrefix(job.sku, brand?.prefix ?? null);

  const { candidates, notes } = await buildCandidates(job, brand, profile);
  console.log(`Job ${job.sku}: ${candidates.length} candidates. ${notes.join(" | ")}`);

  if (candidates.length === 0) {
    await recordResult(job, "no_match", { notes: `no candidates. ${notes.join(" | ")}` });
    await setJobStatus(job.id, "failed", { finished_at: new Date().toISOString(), error: "no candidates found" });
    return { outcome: "no_match" };
  }

  // Candidates are already scored & sorted. Optionally augment with AI ranking on the top 12.
  const topForAi = candidates.slice(0, 12);
  const aiOrder = await aiPickBestImage(job.sku, cleanSku, brand?.name ?? "", topForAi);
  const ranked: Candidate[] = [
    ...aiOrder.map((i) => topForAi[i]),
    ...candidates.slice(12),
  ];

  let bestSmall: { c: Candidate; dims: { w: number; h: number } } | null = null;
  let attempted = 0;
  let pickedUrl: string | null = null;

  const finalize = async (outcome: string, status: string, fields: Record<string, unknown>, picked?: string | null) => {
    pickedUrl = picked ?? null;
    await recordCandidates(job.id, job.sku, job.brand_id, candidates, pickedUrl);
    if (pickedUrl && job.brand_id) {
      const winner = candidates.find((c) => c.imageUrl === pickedUrl);
      const host = hostOf(winner?.pageUrl) || hostOf(winner?.imageUrl);
      const preferred = new Set((profile?.preferred_domains ?? []).map((d) => d.replace(/^www\./, "")));
      if (host && !preferred.has(host)) await recordSuggestion(job.brand_id, "domain", host);
      if (winner?.fromTemplate && !(profile?.search_templates ?? []).includes(winner.fromTemplate)) {
        await recordSuggestion(job.brand_id, "template", winner.fromTemplate);
      }
    }
    await recordResult(job, outcome, fields);
    await setJobStatus(job.id, status, { finished_at: new Date().toISOString(), ...(fields.error ? { error: fields.error } : {}) });
  };

  for (const c of ranked) {
    if (attempted >= MAX_CANDIDATES_TO_TRY) break;
    attempted++;
    const fetched = await fetchBytes(c.imageUrl);
    if (!fetched) continue;
    const dims = imageDims(fetched.bytes);
    if (!dims) continue;
    const ar = dims.w / dims.h;
    if (ar < MIN_AR || ar > MAX_AR) continue;

    if (dims.w >= MIN_DIM && dims.h >= MIN_DIM) {
      const cleaned = await bgRemoveAndNormalise(fetched.bytes, fetched.ct);
      if (!cleaned) {
        await finalize("watermark_review", "needs_review", {
          source_page_url: c.pageUrl, source_image_url: c.imageUrl,
          raw_width: dims.w, raw_height: dims.h,
          notes: `bg-removal failed via ${c.source} (score ${c.score}); review. ${notes.join(" | ")}`,
        });
        return { outcome: "watermark_review" };
      }
      try {
        const path = await uploadFinal(job.sku, cleaned);
        await finalize("stored", "success", {
          source_page_url: c.pageUrl, source_image_url: c.imageUrl,
          raw_width: dims.w, raw_height: dims.h, storage_path: path,
          notes: `via ${c.source} score=${c.score} tpl="${c.fromTemplate ?? "-"}" (attempt ${attempted}/${ranked.length}). ${notes.join(" | ")}`,
        }, c.imageUrl);
        return { outcome: "stored", detail: path };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("upload failed", msg);
        continue;
      }
    } else {
      if (!bestSmall || (dims.w * dims.h > bestSmall.dims.w * bestSmall.dims.h)) {
        bestSmall = { c, dims };
      }
    }
  }

  if (bestSmall) {
    await finalize("low_res", "needs_review", {
      source_page_url: bestSmall.c.pageUrl, source_image_url: bestSmall.c.imageUrl,
      raw_width: bestSmall.dims.w, raw_height: bestSmall.dims.h,
      notes: `${attempted} candidates tried, all under ${MIN_DIM}px or wrong aspect. Best: ${bestSmall.dims.w}x${bestSmall.dims.h} via ${bestSmall.c.source}. ${notes.join(" | ")}`,
      error: "low resolution",
    });
    return { outcome: "low_res" };
  }

  await finalize("no_match", "failed", {
    notes: `tried ${attempted} candidates, none usable. ${notes.join(" | ")}`,
    error: `tried ${attempted} candidates`,
  });
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
