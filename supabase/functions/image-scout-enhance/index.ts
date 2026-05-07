// Image Scout — deterministic enhancement pipeline.
// Reference-preserving only. NO generative AI.
// Providers:
//   - basic_normalize: pass-through (fallback, no external deps)
//   - removebg_esrgan: Photoroom or remove.bg → 2000x2000 white canvas, centered, padded
//
// Allowed ops only: bg removal, white normalisation, centering, padding, light sharpen, format normalisation.
// Forbidden: any generative fill / shape change / hallucinated detail.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PHOTOROOM_KEY = Deno.env.get("PHOTOROOM_API_KEY") ?? "";
const REMOVE_BG_KEY = Deno.env.get("REMOVE_BG_API_KEY") ?? "";
const DEFAULT_PROVIDER = Deno.env.get("IMAGE_SCOUT_PROVIDER") ?? "removebg_esrgan";

const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const CANVAS = 2000;
const PAD_RATIO = 0.08;            // 8% safe padding
const MIN_OUT = 1500;
const MIN_OBJECT_PCT = 0.20;       // object should fill ≥20% of canvas
const MAX_OBJECT_PCT = 0.96;       // ≤96% (else cropped/too tight)

type Row = {
  id: string;
  candidate_id: string;
  sku: string;
  source_image_url: string | null;
  processing_status: string;
  processing_provider: string;
  width: number | null;
  height: number | null;
};

async function pickRow(rowId?: string): Promise<Row | null> {
  if (rowId) {
    const { data } = await supa.from("approved_product_images").select("*").eq("id", rowId).maybeSingle();
    return data as Row | null;
  }
  const { data } = await supa.from("approved_product_images").select("*")
    .eq("processing_status", "pending").order("created_at", { ascending: true }).limit(1).maybeSingle();
  return data as Row | null;
}

function ctToExt(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "bin";
}

// ---------- BG removal calls ----------
async function callPhotoroom(bytes: Uint8Array): Promise<Uint8Array> {
  const fd = new FormData();
  fd.append("image_file", new Blob([bytes]), "in.jpg");
  fd.append("format", "png");
  fd.append("bg_color", "transparent");
  const res = await fetch("https://sdk.photoroom.com/v1/segment", {
    method: "POST",
    headers: { "x-api-key": PHOTOROOM_KEY, Accept: "image/png" },
    body: fd,
  });
  if (!res.ok) throw new Error(`photoroom ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function callRemoveBg(bytes: Uint8Array): Promise<Uint8Array> {
  const fd = new FormData();
  fd.append("image_file", new Blob([bytes]), "in.jpg");
  fd.append("size", "auto");
  fd.append("format", "png");
  const res = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": REMOVE_BG_KEY },
    body: fd,
  });
  if (!res.ok) throw new Error(`remove.bg ${res.status}: ${await res.text()}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function removeBackground(bytes: Uint8Array): Promise<{ png: Uint8Array; provider: string }> {
  if (PHOTOROOM_KEY) {
    try {
      return { png: await callPhotoroom(bytes), provider: "photoroom" };
    } catch (e) {
      if (!REMOVE_BG_KEY) throw e;
      // fall through to remove.bg
    }
  }
  if (REMOVE_BG_KEY) {
    return { png: await callRemoveBg(bytes), provider: "remove.bg" };
  }
  throw new Error("provider_key_missing");
}

// ---------- Canvas composition ----------
// Find tight bounding box of non-transparent pixels.
function bbox(img: Image): { x: number; y: number; w: number; h: number } {
  const w = img.width, h = img.height;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  // Walk pixels; ImageScript stores RGBA in img.bitmap
  const data = img.bitmap;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w, h };
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Detect translucent (semi-transparent) edges – warning only, not a failure.
function hasTransparentEdges(img: Image, bb: { x: number; y: number; w: number; h: number }): boolean {
  const data = img.bitmap;
  const W = img.width;
  let translucent = 0, edgePix = 0;
  const sample = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
    const a = data[(y * W + x) * 4 + 3];
    edgePix++;
    if (a > 16 && a < 230) translucent++;
  };
  // Top + bottom rows of bbox
  for (let x = bb.x; x < bb.x + bb.w; x++) {
    sample(x, bb.y); sample(x, bb.y + bb.h - 1);
  }
  for (let y = bb.y; y < bb.y + bb.h; y++) {
    sample(bb.x, y); sample(bb.x + bb.w - 1, y);
  }
  return edgePix > 0 && translucent / edgePix > 0.15;
}

async function composeOnWhite(transparentPng: Uint8Array): Promise<{ bytes: Uint8Array; flags: string[]; width: number; height: number }> {
  const flags: string[] = [];
  const cut = await Image.decode(transparentPng);
  const bb = bbox(cut);

  if (hasTransparentEdges(cut, bb)) flags.push("transparent_edges_detected");

  // Crop to bbox
  const cropped = cut.clone().crop(bb.x, bb.y, bb.w, bb.h);

  // Object cropped (touches edge of original) – warning
  if (bb.x === 0 || bb.y === 0 || bb.x + bb.w >= cut.width || bb.y + bb.h >= cut.height) {
    flags.push("object_touches_edge");
  }

  // Fit inside CANVAS with PAD_RATIO padding on each side
  const maxBox = Math.floor(CANVAS * (1 - PAD_RATIO * 2));
  const scale = Math.min(maxBox / cropped.width, maxBox / cropped.height);
  const targetW = Math.max(1, Math.round(cropped.width * scale));
  const targetH = Math.max(1, Math.round(cropped.height * scale));
  const resized = cropped.resize(targetW, targetH);

  // Light sharpen (single mild pass; deterministic kernel)
  // ImageScript supports .convolute() which applies a 3x3 kernel.
  try {
    // mild unsharp-like kernel (sums to 1)
    resized.convolute([
      [ 0, -0.15,  0],
      [-0.15, 1.6, -0.15],
      [ 0, -0.15,  0],
    ]);
  } catch { /* ignore if unsupported */ }

  // White canvas
  const canvas = new Image(CANVAS, CANVAS);
  // RGBA white
  canvas.fill(0xFFFFFFFF);

  // Composite over white (alpha-blend)
  const ox = Math.round((CANVAS - targetW) / 2);
  const oy = Math.round((CANVAS - targetH) / 2);
  canvas.composite(resized, ox, oy);

  // Object percentage check (largest dim relative to canvas)
  const objPct = Math.max(targetW, targetH) / CANVAS;
  if (objPct < MIN_OBJECT_PCT) flags.push("object_too_small_on_canvas");
  if (objPct > MAX_OBJECT_PCT) flags.push("object_too_large_on_canvas");

  if (CANVAS < MIN_OUT) flags.push("output_below_min_dim");

  // Encode as JPG (90) — flatter colour, smaller, white bg
  const bytes = await canvas.encodeJPEG(90);
  return { bytes, flags, width: CANVAS, height: CANVAS };
}

// ---------- Pipeline ----------
async function processRow(row: Row) {
  await supa.from("approved_product_images").update({
    processing_status: "processing", processing_error: null,
  }).eq("id", row.id);

  const flags: string[] = [];
  let originalSaved = false;
  let origPath: string | null = null;
  let origCT = "image/jpeg";

  try {
    if (!row.source_image_url) throw new Error("no source_image_url");

    // 1. Download + always store original first
    const dl = await fetch(row.source_image_url);
    if (!dl.ok) throw new Error(`download ${dl.status}`);
    origCT = dl.headers.get("content-type") ?? "image/jpeg";
    const srcBytes = new Uint8Array(await dl.arrayBuffer());

    origPath = `${row.sku}/${row.id}.${ctToExt(origCT)}`;
    const upOrig = await supa.storage.from("image-scout-originals")
      .upload(origPath, srcBytes, { contentType: origCT, upsert: true });
    if (upOrig.error) throw new Error(`orig upload: ${upOrig.error.message}`);
    originalSaved = true;
    await supa.from("approved_product_images").update({ original_storage_path: origPath }).eq("id", row.id);

    // 2. Provider selection
    const provider = row.processing_provider || DEFAULT_PROVIDER;

    if (provider === "removebg_esrgan") {
      if (!PHOTOROOM_KEY && !REMOVE_BG_KEY) {
        await supa.from("approved_product_images").update({
          processing_status: "manual_required",
          safety_flags: ["provider_key_missing"],
          processing_error: "No background-removal API key configured",
        }).eq("id", row.id);
        return { ok: false, status: "manual_required", flags: ["provider_key_missing"] };
      }
      const { png: cutout, provider: bgProv } = await removeBackground(srcBytes);
      const composed = await composeOnWhite(cutout);
      flags.push(...composed.flags);

      const procPath = `${row.sku}/${row.id}.jpg`;
      const upProc = await supa.storage.from("image-scout-processed")
        .upload(procPath, composed.bytes, { contentType: "image/jpeg", upsert: true });
      if (upProc.error) throw new Error(`proc upload: ${upProc.error.message}`);

      const status = flags.length ? "manual_required" : "completed";
      await supa.from("approved_product_images").update({
        processing_status: status,
        processed_storage_path: procPath,
        processing_provider: provider,
        width: composed.width,
        height: composed.height,
        safety_flags: flags,
        processing_error: null,
      }).eq("id", row.id);
      return { ok: true, status, flags, bg_provider: bgProv };
    }

    // basic_normalize fallback (pass-through)
    const procPath = `${row.sku}/${row.id}.${ctToExt(origCT)}`;
    const upProc = await supa.storage.from("image-scout-processed")
      .upload(procPath, srcBytes, { contentType: origCT, upsert: true });
    if (upProc.error) throw new Error(`proc upload: ${upProc.error.message}`);

    if (row.width && row.height && (row.width < MIN_OUT || row.height < MIN_OUT)) {
      flags.push("output_below_min_dim");
    }
    const status = flags.length ? "manual_required" : "completed";
    await supa.from("approved_product_images").update({
      processing_status: status,
      processed_storage_path: procPath,
      processing_provider: "basic_normalize",
      safety_flags: flags,
    }).eq("id", row.id);
    return { ok: true, status, flags };
  } catch (e) {
    const msg = (e as Error).message;
    await supa.from("approved_product_images").update({
      processing_status: "failed",
      processing_error: msg,
      safety_flags: [...flags, "processing_failed"],
      ...(originalSaved && origPath ? { original_storage_path: origPath } : {}),
    }).eq("id", row.id);
    return { ok: false, error: msg, original_saved: originalSaved };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  let body: { row_id?: string; reprocess?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const row = await pickRow(body.row_id);
  if (!row) {
    return new Response(JSON.stringify({ ok: true, message: "nothing to process" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (body.reprocess) {
    await supa.from("approved_product_images").update({
      processing_status: "pending",
      processing_error: null,
      safety_flags: [],
      processing_provider: DEFAULT_PROVIDER,
    }).eq("id", row.id);
    row.processing_status = "pending";
    row.processing_provider = DEFAULT_PROVIDER;
  }

  const result = await processRow(row);
  return new Response(JSON.stringify({ ok: true, row_id: row.id, ...result }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
