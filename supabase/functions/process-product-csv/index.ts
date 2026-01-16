import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface BarcodeType {
  id: string;
  type_name: string;
  digit_count: number | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { csvContent, uploadName, userId } = await req.json();

    if (!csvContent) {
      throw new Error("CSV content is required");
    }

    if (!uploadName || !userId) {
      throw new Error("Upload name and user ID are required");
    }

    console.log("Processing CSV upload...");

    // Parse CSV
    const lines = csvContent.trim().split("\n");
    const headers = lines[0].split(",").map((h: string) => h.trim());

    console.log("CSV headers:", headers);

    // Get barcode types
    const { data: barcodeTypes, error: barcodeError } = await supabase
      .from("barcode_types")
      .select("*");

    if (barcodeError) throw barcodeError;

    const barcodeTypeMap = new Map(
      barcodeTypes.map((bt: BarcodeType) => [bt.type_name, bt])
    );

    let imported = 0;
    let updated = 0;
    const categorySet = new Set<string>();

    // Process each product row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const values = parseCSVLine(line);
      const row: Record<string, string> = {};
      headers.forEach((header: string, index: number) => {
        row[header] = values[index] || "";
      });

      // Extract and merge barcode
      const eanBarcode = row["EANBarcode"] || "";
      const upcBarcode = row["UPCBarcode"] || "";
      let barcode = eanBarcode || upcBarcode;
      let barcodeTypeId: string | null = null;

      // Determine barcode type based on length
      if (barcode) {
        barcode = barcode.replace(/\D/g, ""); // Remove non-digits
        const barcodeType =
          barcode.length === 12
            ? barcodeTypeMap.get("UPC")
            : barcode.length === 13
            ? barcodeTypeMap.get("EAN")
            : barcodeTypeMap.get("Other");
        barcodeTypeId = barcodeType?.id || null;
      }

      // Parse categories
      const categoriesStr = row["Categories"] || "";
      const categories = categoriesStr
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c);
      categories.forEach((cat) => categorySet.add(cat));

      // Prepare product data
      const productData = {
        sku: row["SKU"],
        name: row["Name"],
        barcode: barcode || null,
        barcode_type_id: barcodeTypeId,
        discontinued: row["Discontinued"]?.toLowerCase() === "true",
        suppliers: row["Suppliers"] || null,
        low_stock_alert_level: parseFloat(row["LowStockAlertLevel"]) || 0,
        weight: parseFloat(row["Weight"]) || null,
        height: parseFloat(row["Height"]) || null,
        length: parseFloat(row["Length"]) || null,
        depth: parseFloat(row["Depth"]) || null,
        cost_price: parseFloat(row["CostPrice"]) || null,
        handling_time: parseInt(row["HandlingTime"]) || null,
        mintsoft_product_id: parseInt(row["MintsoftProductID"]) || null,
        current_stock: parseFloat(row["CurrentStock"]) || 0,
        back_order_qty: parseFloat(row["BackOrderQty"]) || 0,
        on_order: parseFloat(row["OnOrder"]) || 0,
      };

      // Upsert product
      const { data: product, error: productError } = await supabase
        .from("products_cache")
        .upsert(productData, { onConflict: "sku" })
        .select()
        .single();

      if (productError) {
        console.error(`Error upserting product ${productData.sku}:`, productError);
        continue;
      }

      if (product) {
        // Handle categories
        if (categories.length > 0) {
          // First, ensure all categories exist
          for (const catName of categories) {
            await supabase
              .from("product_categories")
              .upsert({ name: catName }, { onConflict: "name" });
          }

          // Get category IDs
          const { data: categoryData } = await supabase
            .from("product_categories")
            .select("id, name")
            .in("name", categories);

          if (categoryData) {
            // Delete existing links
            await supabase
              .from("product_category_links")
              .delete()
              .eq("product_id", product.id);

            // Create new links
            const links = categoryData.map((cat) => ({
              product_id: product.id,
              category_id: cat.id,
            }));

            await supabase.from("product_category_links").insert(links);
          }
        }

        imported++;
      }
    }

    console.log(`Import complete: ${imported} products processed`);

    // Save upload history
    const { error: historyError } = await supabase
      .from("upload_history")
      .insert({
        user_id: userId,
        upload_name: uploadName,
        items_imported: imported,
        status: "success",
        source: "push",
      });

    if (historyError) {
      console.error("Error saving upload history:", historyError);
    }

    return new Response(
      JSON.stringify({ imported, updated, categories: categorySet.size }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error processing CSV:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values.map((v) => v.replace(/^"|"$/g, "").trim());
}
