import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MintsoftProduct {
  ID: number;
  SKU: string;
  Name: string;
  EANBarcode?: string;
  UPCBarcode?: string;
  CostPrice?: number;
  Weight?: number;
  Height?: number;
  Length?: number;
  Depth?: number;
  Discontinued?: boolean;
  LowStockAlertLevel?: number;
  HandlingTime?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sku, userId } = await req.json();
    if (!sku || typeof sku !== "string") {
      return new Response(JSON.stringify({ error: "SKU is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetSku = sku.trim();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("base_url")
      .single();

    if (!settings?.base_url) {
      return new Response(JSON.stringify({ error: "Mintsoft settings not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const baseUrl = settings.base_url;
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Mintsoft API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try Mintsoft's Search endpoint with multiple parameter variants
    const candidates = [
      `${baseUrl}/api/Product/Search?SKU=${encodeURIComponent(targetSku)}`,
      `${baseUrl}/api/Product/Search?SearchTerm=${encodeURIComponent(targetSku)}`,
      `${baseUrl}/api/Product?SKU=${encodeURIComponent(targetSku)}`,
    ];

    let found: MintsoftProduct | null = null;
    const attempts: Array<{ url: string; status: number; resultCount: number }> = [];

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          headers: {
            "ms-apikey": apiKey,
            "Content-Type": "application/json",
          },
        });
        if (!res.ok) {
          attempts.push({ url, status: res.status, resultCount: 0 });
          continue;
        }
        const json = await res.json();
        const arr: MintsoftProduct[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.Items)
            ? json.Items
            : json?.SKU
              ? [json]
              : [];
        attempts.push({ url, status: res.status, resultCount: arr.length });
        const exact = arr.find((p) => (p.SKU || "").toUpperCase() === targetSku.toUpperCase());
        if (exact) {
          found = exact;
          break;
        }
        // accept first if only one returned
        if (!found && arr.length === 1) found = arr[0];
      } catch (e) {
        attempts.push({ url, status: 0, resultCount: 0 });
      }
    }

    if (!found) {
      return new Response(
        JSON.stringify({
          imported: 0,
          found: false,
          message: `SKU "${targetSku}" not found in Mintsoft via Search endpoint.`,
          attempts,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const row = {
      sku: found.SKU,
      name: found.Name || found.SKU,
      barcode: found.EANBarcode || found.UPCBarcode || null,
      mintsoft_product_id: found.ID,
      cost_price: found.CostPrice || null,
      weight: found.Weight || null,
      height: found.Height || null,
      length: found.Length || null,
      depth: found.Depth || null,
      discontinued: found.Discontinued || false,
      low_stock_alert_level: found.LowStockAlertLevel || null,
      handling_time: found.HandlingTime || null,
    };

    const { error: upsertError } = await supabase
      .from("products_cache")
      .upsert(row, { onConflict: "sku" });

    if (upsertError) {
      return new Response(JSON.stringify({ error: `Upsert failed: ${upsertError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (userId) {
      await supabase.from("upload_history").insert({
        user_id: userId,
        upload_name: `Mintsoft Single SKU: ${targetSku}`,
        items_imported: 1,
        status: "success",
        source: "pull",
        prefix: targetSku,
      });
    }

    return new Response(
      JSON.stringify({
        imported: 1,
        found: true,
        product: { sku: found.SKU, name: found.Name, mintsoft_id: found.ID },
        message: `Imported ${found.SKU} (Mintsoft ID ${found.ID})`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
