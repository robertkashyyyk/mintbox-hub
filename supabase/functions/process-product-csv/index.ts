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

// Flexible column mapping - supports multiple possible column names
const COLUMN_MAPPINGS: Record<string, string[]> = {
  sku: ["SKU", "Sku", "ProductSKU", "Product SKU"],
  name: ["Name", "ProductName", "Product Name", "Title"],
  mintsoft_product_id: ["MintsoftProductID", "ProductID", "ID", "ProductId", "Product ID"],
  ean_barcode: ["EANBarcode", "EAN", "Barcode", "EAN Barcode"],
  upc_barcode: ["UPCBarcode", "UPC", "UPC Barcode"],
  discontinued: ["Discontinued"],
  suppliers: ["Suppliers", "Supplier"],
  low_stock_alert_level: ["LowStockAlertLevel", "Low Stock Alert Level", "AlertLevel"],
  weight: ["Weight"],
  height: ["Height"],
  length: ["Length"],
  depth: ["Depth"],
  cost_price: ["CostPrice", "Cost Price", "Cost"],
  handling_time: ["HandlingTime", "Handling Time"],
  current_stock: ["CurrentStock", "Current Stock", "Stock"],
  back_order_qty: ["BackOrderQty", "Back Order Qty", "BackOrder"],
  on_order: ["OnOrder", "On Order"],
  categories: ["Categories", "Category"],
};

// Find a column value from row using flexible mapping
function findColumn(row: Record<string, string>, columnKey: string): string {
  const possibleNames = COLUMN_MAPPINGS[columnKey] || [columnKey];
  for (const name of possibleNames) {
    if (row[name] !== undefined) {
      return row[name];
    }
  }
  return "";
}

// Detect if this is a minimal catalog import (only SKU, Name, ID)
function isMinimalCatalogImport(headers: string[]): boolean {
  const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
  
  // Check if we have SKU, Name, and optionally ID - but NOT detailed fields like CostPrice
  const hasSku = normalizedHeaders.some(h => ["sku", "productsku"].includes(h));
  const hasName = normalizedHeaders.some(h => ["name", "productname", "title"].includes(h));
  const hasDetailedFields = normalizedHeaders.some(h => 
    ["costprice", "cost price", "currentstock", "current stock", "weight", "categories", "eanbarcode", "barcode"].includes(h)
  );
  
  return hasSku && hasName && !hasDetailedFields;
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
    
    // Detect if this is a minimal catalog import
    const isMinimalImport = isMinimalCatalogImport(headers);
    console.log(`Import mode: ${isMinimalImport ? "minimal catalog" : "full"}`);

    // Get barcode types (only needed for full import)
    let barcodeTypeMap = new Map<string, BarcodeType>();
    if (!isMinimalImport) {
      const { data: barcodeTypes, error: barcodeError } = await supabase
        .from("barcode_types")
        .select("*");

      if (barcodeError) throw barcodeError;

      barcodeTypeMap = new Map(
        barcodeTypes.map((bt: BarcodeType) => [bt.type_name, bt])
      );
    }

    let imported = 0;
    let updated = 0;
    const categorySet = new Set<string>();
    const categoriesForProduct = new Map<string, string[]>();

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

      // Extract values using flexible column mapping
      const sku = findColumn(row, "sku");
      const name = findColumn(row, "name");
      
      if (!sku) {
        console.warn(`Skipping row ${i}: missing SKU`);
        continue;
      }

      // Prepare product data based on import mode
      let productData: Record<string, unknown>;
      
      if (isMinimalImport) {
        // Minimal catalog import - only SKU, Name, Mintsoft ID
        const mintsoftId = findColumn(row, "mintsoft_product_id");
        
        productData = {
          sku: sku,
          name: name || sku,
          mintsoft_product_id: mintsoftId ? parseInt(mintsoftId) : null,
          discovery_source: "catalog_import",
          discovered_at: new Date().toISOString(),
        };
      } else {
        // Full import with all fields
        const eanBarcode = findColumn(row, "ean_barcode");
        const upcBarcode = findColumn(row, "upc_barcode");
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
        const categoriesStr = findColumn(row, "categories");
        const categories = categoriesStr
          .split(",")
          .map((c) => c.trim())
          .filter((c) => c);
        categories.forEach((cat) => categorySet.add(cat));
        
        const mintsoftId = findColumn(row, "mintsoft_product_id");
        const discontinued = findColumn(row, "discontinued");
        const lowStockLevel = findColumn(row, "low_stock_alert_level");
        const weight = findColumn(row, "weight");
        const height = findColumn(row, "height");
        const length = findColumn(row, "length");
        const depth = findColumn(row, "depth");
        const costPrice = findColumn(row, "cost_price");
        const handlingTime = findColumn(row, "handling_time");
        const currentStock = findColumn(row, "current_stock");
        const backOrderQty = findColumn(row, "back_order_qty");
        const onOrder = findColumn(row, "on_order");
        const suppliers = findColumn(row, "suppliers");

        productData = {
          sku: sku,
          name: name || sku,
          barcode: barcode || null,
          barcode_type_id: barcodeTypeId,
          discontinued: discontinued?.toLowerCase() === "true",
          suppliers: suppliers || null,
          low_stock_alert_level: parseFloat(lowStockLevel) || 0,
          weight: parseFloat(weight) || null,
          height: parseFloat(height) || null,
          length: parseFloat(length) || null,
          depth: parseFloat(depth) || null,
          cost_price: parseFloat(costPrice) || null,
          handling_time: parseInt(handlingTime) || null,
          mintsoft_product_id: mintsoftId ? parseInt(mintsoftId) : null,
          current_stock: parseFloat(currentStock) || 0,
          back_order_qty: parseFloat(backOrderQty) || 0,
          on_order: parseFloat(onOrder) || 0,
        };

        // Handle categories for full import
        if (categories.length > 0) {
          categoriesForProduct.set(sku, categories);
        }
      }

      // Upsert product
      const { data: product, error: productError } = await supabase
        .from("products_cache")
        .upsert(productData, { onConflict: "sku" })
        .select()
        .single();

      if (productError) {
        console.error(`Error upserting product ${sku}:`, productError);
        continue;
      }

      if (product) {
        // Handle categories only for full imports
        if (!isMinimalImport && categoriesForProduct.has(sku)) {
          const categories = categoriesForProduct.get(sku)!;
          
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
