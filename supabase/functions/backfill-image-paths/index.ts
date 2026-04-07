import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Get all product_images joined with products_cache to get SKU
    const { data: images, error: fetchErr } = await supabase
      .from("product_images")
      .select("id, product_id, file_path, products_cache(sku)");

    if (fetchErr) throw fetchErr;

    // Find dirty images (not matching flat {sku}.ext or {sku}-N.ext pattern)
    const dirty = (images || []).filter((img: any) => {
      const sku = img.products_cache?.sku;
      if (!sku) return false;
      // Clean pattern: {sku}.ext or {sku}-N.ext (flat, no subfolder)
      const cleanRegex = new RegExp(
        `^${sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-\\d+)?\\.[a-zA-Z]+$`
      );
      return !cleanRegex.test(img.file_path);
    });

    console.log(`Found ${dirty.length} dirty images out of ${images?.length}`);

    if (dirty.length === 0) {
      return new Response(
        JSON.stringify({ moved: 0, errors: 0, message: "All images already clean" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Group by product_id to handle multi-image indexing
    const byProduct = new Map<string, any[]>();
    for (const img of dirty) {
      const list = byProduct.get(img.product_id) || [];
      list.push(img);
      byProduct.set(img.product_id, list);
    }

    // Also check how many clean images each product already has
    const cleanByProduct = new Map<string, number>();
    for (const img of (images || [])) {
      if (!dirty.find((d: any) => d.id === img.id)) {
        const count = cleanByProduct.get(img.product_id) || 0;
        cleanByProduct.set(img.product_id, count + 1);
      }
    }

    let moved = 0;
    let errors = 0;
    const details: string[] = [];

    for (const [productId, dirtyImgs] of byProduct) {
      const sku = dirtyImgs[0].products_cache?.sku;
      if (!sku) continue;

      const existingCleanCount = cleanByProduct.get(productId) || 0;

      for (let i = 0; i < dirtyImgs.length; i++) {
        const img = dirtyImgs[i];
        const ext = img.file_path.split(".").pop() || "png";
        const index = existingCleanCount + i;
        // Flat path: {sku}.ext or {sku}-N.ext
        const newPath =
          index === 0
            ? `${sku}.${ext}`
            : `${sku}-${index + 1}.${ext}`;

        try {
          // Copy to new path
          const { error: copyErr } = await supabase.storage
            .from("product-images")
            .copy(img.file_path, newPath);

          if (copyErr) {
            console.error(`Copy failed for ${img.file_path} -> ${newPath}:`, copyErr.message);
            details.push(`ERR ${img.file_path}: ${copyErr.message}`);
            errors++;
            continue;
          }

          // Get new public URL
          const { data: urlData } = supabase.storage
            .from("product-images")
            .getPublicUrl(newPath);

          // Update DB record
          const { error: updateErr } = await supabase
            .from("product_images")
            .update({
              file_path: newPath,
              public_url: urlData.publicUrl,
            })
            .eq("id", img.id);

          if (updateErr) {
            details.push(`ERR update ${img.id}: ${updateErr.message}`);
            errors++;
            continue;
          }

          // Delete old file
          await supabase.storage
            .from("product-images")
            .remove([img.file_path]);

          moved++;
          details.push(`OK ${img.file_path} -> ${newPath}`);
        } catch (e) {
          details.push(`ERR ${img.file_path}: ${e.message}`);
          errors++;
        }
      }
    }

    return new Response(
      JSON.stringify({ moved, errors, total: dirty.length, details }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
