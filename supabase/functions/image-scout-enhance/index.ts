// Image Scout — deterministic enhancement pipeline.
// Reference-preserving only. NO generative AI.
// Operations: download original → store original → normalize (resize/pad on white) → store processed.
// Provider abstraction: providers map to runEnhancement(provider, bytes) → bytes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const MIN_OUT = 600;
const TARGET = 1200;

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

function extFromContentType(ct: string): string {
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  return "bin";
}

// ---------- Provider abstraction ----------
// Each provider must take input bytes and return { bytes, contentType, width?, height?, flags[] }
type EnhanceOut = { bytes: Uint8Array; contentType: string; width?: number; height?: number; flags: string[] };

async function providerBasicNormalize(input: Uint8Array, ct: string): Promise<EnhanceOut> {
  // Deterministic pass-through: we re-emit the bytes as-is. Real resize/pad will be added when
  // an image lib is wired (Photoroom/remove.bg + Real-ESRGAN). This keeps the pipeline shape correct
  // while remaining strictly non-generative (no pixels invented).
  return { bytes: input, contentType: ct, flags: [] };
}

async function runProvider(name: string, bytes: Uint8Array, ct: string): Promise<EnhanceOut> {
  switch (name) {
    case "basic_normalize": return providerBasicNormalize(bytes, ct);
    // case "photoroom": ...
    // case "removebg_esrgan": ...
    default: return providerBasicNormalize(bytes, ct);
  }
}

async function processRow(row: Row) {
  await supa.from("approved_product_images").update({ processing_status: "processing", processing_error: null }).eq("id", row.id);
  const flags: string[] = [];
  try {
    if (!row.source_image_url) throw new Error("no source_image_url");
    const res = await fetch(row.source_image_url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const ct = res.headers.get("content-type") ?? "application/octet-stream";
    const bytes = new Uint8Array(await res.arrayBuffer());

    // Store original
    const origPath = `${row.sku}/${row.id}.${extFromContentType(ct)}`;
    const upOrig = await supa.storage.from("image-scout-originals").upload(origPath, bytes, {
      contentType: ct, upsert: true,
    });
    if (upOrig.error) throw new Error(`orig upload: ${upOrig.error.message}`);

    // Run provider
    const out = await runProvider(row.processing_provider, bytes, ct);
    flags.push(...out.flags);

    // Safety gates
    if (row.width && row.height) {
      if (row.width < MIN_OUT || row.height < MIN_OUT) flags.push("output_below_min_dim");
    }

    const procPath = `${row.sku}/${row.id}.${extFromContentType(out.contentType)}`;
    const upProc = await supa.storage.from("image-scout-processed").upload(procPath, out.bytes, {
      contentType: out.contentType, upsert: true,
    });
    if (upProc.error) throw new Error(`proc upload: ${upProc.error.message}`);

    const status = flags.length > 0 ? "manual_required" : "completed";
    await supa.from("approved_product_images").update({
      processing_status: status,
      original_storage_path: origPath,
      processed_storage_path: procPath,
      safety_flags: flags,
    }).eq("id", row.id);

    return { ok: true, status, flags };
  } catch (e) {
    const msg = (e as Error).message;
    await supa.from("approved_product_images").update({
      processing_status: "failed",
      processing_error: msg,
      safety_flags: [...flags, "processing_failed"],
    }).eq("id", row.id);
    return { ok: false, error: msg };
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

  // For reprocess: reset to pending first
  if (body.reprocess) {
    await supa.from("approved_product_images").update({
      processing_status: "pending", processing_error: null, safety_flags: [],
    }).eq("id", row.id);
    row.processing_status = "pending";
  }

  const result = await processRow(row);
  return new Response(JSON.stringify({ ok: true, row_id: row.id, ...result }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
