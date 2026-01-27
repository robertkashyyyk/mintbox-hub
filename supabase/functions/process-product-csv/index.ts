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
  mintsoft_product_id: ["MintsoftProductID", "ProductID", "ID", "ProductId", "Product ID", "PRODUCTID"],
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

// Build a fast lookup map from header names to their indices
function buildHeaderIndexMap(headers: string[]): Map<string, number> {
  const indexMap = new Map<string, number>();
  headers.forEach((h, idx) => {
    const trimmed = h.trim();
    indexMap.set(trimmed, idx);
    indexMap.set(trimmed.toLowerCase(), idx);
    indexMap.set(trimmed.toUpperCase(), idx);
  });
  return indexMap;
}

// Get column index using pre-computed map (O(1) instead of O(n))
function getColumnIndex(headerMap: Map<string, number>, columnKey: string): number {
  const possibleNames = COLUMN_MAPPINGS[columnKey] || [columnKey];
  for (const name of possibleNames) {
    const idx = headerMap.get(name);
    if (idx !== undefined) return idx;
    const lowerIdx = headerMap.get(name.toLowerCase());
    if (lowerIdx !== undefined) return lowerIdx;
  }
  return -1;
}

// Detect if this is a minimal catalog import (only SKU, Name, ID)
function isMinimalCatalogImport(headers: string[]): boolean {
  const normalizedHeaders = new Set(headers.map(h => h.trim().toLowerCase()));
  
  // Check for detailed fields that indicate a full import
  const detailedFields = ["costprice", "cost price", "currentstock", "current stock", "weight", "categories", "eanbarcode", "barcode"];
  const hasDetailedFields = detailedFields.some(f => normalizedHeaders.has(f));
  
  return !hasDetailedFields;
}

// Simple CSV line parser - handles basic quoted fields
function parseCSVLineSimple(line: string): string[] {
  // For minimal imports, most Mintsoft exports don't have complex quoting
  // Use simple split for speed, fall back to full parser if needed
  if (!line.includes('"')) {
    return line.split(',').map(v => v.trim());
  }
  
  // Full parser for quoted fields
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.replace(/^"|"$/g, "").trim());
  return values;
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

    // Parse CSV - split lines efficiently
    const lines = csvContent.split("\n");
    if (lines.length < 2) {
      return new Response(
        JSON.stringify({ imported: 0, categories: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headers = lines[0].split(",").map((h: string) => h.trim());
    const isMinimalImport = isMinimalCatalogImport(headers);
    
    // Pre-compute header indices once (O(1) lookups instead of O(n))
    const headerMap = buildHeaderIndexMap(headers);
    const skuIdx = getColumnIndex(headerMap, "sku");
    const nameIdx = getColumnIndex(headerMap, "name");
    const mintsoftIdIdx = getColumnIndex(headerMap, "mintsoft_product_id");

    if (skuIdx === -1) {
      throw new Error("SKU column not found in CSV");
    }

    // Get barcode types only for full imports
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

    // Pre-compute additional indices for full imports
    let eanIdx = -1, upcIdx = -1, discontinuedIdx = -1, lowStockIdx = -1;
    let weightIdx = -1, heightIdx = -1, lengthIdx = -1, depthIdx = -1;
    let costPriceIdx = -1, handlingTimeIdx = -1, currentStockIdx = -1;
    let backOrderIdx = -1, onOrderIdx = -1, suppliersIdx = -1, categoriesIdx = -1;

    if (!isMinimalImport) {
      eanIdx = getColumnIndex(headerMap, "ean_barcode");
      upcIdx = getColumnIndex(headerMap, "upc_barcode");
      discontinuedIdx = getColumnIndex(headerMap, "discontinued");
      lowStockIdx = getColumnIndex(headerMap, "low_stock_alert_level");
      weightIdx = getColumnIndex(headerMap, "weight");
      heightIdx = getColumnIndex(headerMap, "height");
      lengthIdx = getColumnIndex(headerMap, "length");
      depthIdx = getColumnIndex(headerMap, "depth");
      costPriceIdx = getColumnIndex(headerMap, "cost_price");
      handlingTimeIdx = getColumnIndex(headerMap, "handling_time");
      currentStockIdx = getColumnIndex(headerMap, "current_stock");
      backOrderIdx = getColumnIndex(headerMap, "back_order_qty");
      onOrderIdx = getColumnIndex(headerMap, "on_order");
      suppliersIdx = getColumnIndex(headerMap, "suppliers");
      categoriesIdx = getColumnIndex(headerMap, "categories");
    }

    const productsToUpsert: Record<string, unknown>[] = [];
    const categorySet = new Set<string>();
    const categoriesForProduct = new Map<string, string[]>();

    // Process rows - skip header
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const values = parseCSVLineSimple(line);
      const sku = values[skuIdx]?.trim();
      
      if (!sku) continue;

      if (isMinimalImport) {
        // Fast path for minimal imports
        const name = nameIdx >= 0 ? values[nameIdx]?.trim() : "";
        const mintsoftIdStr = mintsoftIdIdx >= 0 ? values[mintsoftIdIdx]?.trim() : "";
        const mintsoftId = mintsoftIdStr ? parseInt(mintsoftIdStr) : null;

        productsToUpsert.push({
          sku,
          name: name || sku,
          mintsoft_product_id: isNaN(mintsoftId as number) ? null : mintsoftId,
          discovery_source: "catalog_import",
          discovered_at: new Date().toISOString(),
        });
      } else {
        // Full import path
        const name = nameIdx >= 0 ? values[nameIdx]?.trim() : "";
        const mintsoftIdStr = mintsoftIdIdx >= 0 ? values[mintsoftIdIdx]?.trim() : "";
        
        const eanBarcode = eanIdx >= 0 ? values[eanIdx]?.trim() : "";
        const upcBarcode = upcIdx >= 0 ? values[upcIdx]?.trim() : "";
        let barcode = eanBarcode || upcBarcode;
        let barcodeTypeId: string | null = null;

        if (barcode) {
          barcode = barcode.replace(/\D/g, "");
          const barcodeType =
            barcode.length === 12
              ? barcodeTypeMap.get("UPC")
              : barcode.length === 13
              ? barcodeTypeMap.get("EAN")
              : barcodeTypeMap.get("Other");
          barcodeTypeId = barcodeType?.id || null;
        }

        const categoriesStr = categoriesIdx >= 0 ? values[categoriesIdx]?.trim() : "";
        if (categoriesStr) {
          const categories = categoriesStr.split(",").map(c => c.trim()).filter(c => c);
          categories.forEach(cat => categorySet.add(cat));
          if (categories.length > 0) {
            categoriesForProduct.set(sku, categories);
          }
        }

        const discontinued = discontinuedIdx >= 0 ? values[discontinuedIdx]?.trim() : "";
        const lowStock = lowStockIdx >= 0 ? values[lowStockIdx]?.trim() : "";
        const weight = weightIdx >= 0 ? values[weightIdx]?.trim() : "";
        const height = heightIdx >= 0 ? values[heightIdx]?.trim() : "";
        const length = lengthIdx >= 0 ? values[lengthIdx]?.trim() : "";
        const depth = depthIdx >= 0 ? values[depthIdx]?.trim() : "";
        const costPrice = costPriceIdx >= 0 ? values[costPriceIdx]?.trim() : "";
        const handlingTime = handlingTimeIdx >= 0 ? values[handlingTimeIdx]?.trim() : "";
        const currentStock = currentStockIdx >= 0 ? values[currentStockIdx]?.trim() : "";
        const backOrder = backOrderIdx >= 0 ? values[backOrderIdx]?.trim() : "";
        const onOrder = onOrderIdx >= 0 ? values[onOrderIdx]?.trim() : "";
        const suppliers = suppliersIdx >= 0 ? values[suppliersIdx]?.trim() : "";

        productsToUpsert.push({
          sku,
          name: name || sku,
          barcode: barcode || null,
          barcode_type_id: barcodeTypeId,
          discontinued: discontinued?.toLowerCase() === "true",
          suppliers: suppliers || null,
          low_stock_alert_level: parseFloat(lowStock) || 0,
          weight: parseFloat(weight) || null,
          height: parseFloat(height) || null,
          length: parseFloat(length) || null,
          depth: parseFloat(depth) || null,
          cost_price: parseFloat(costPrice) || null,
          handling_time: parseInt(handlingTime) || null,
          mintsoft_product_id: mintsoftIdStr ? parseInt(mintsoftIdStr) : null,
          current_stock: parseFloat(currentStock) || 0,
          back_order_qty: parseFloat(backOrder) || 0,
          on_order: parseFloat(onOrder) || 0,
        });
      }
    }

    // Early bail-out for empty chunks
    if (productsToUpsert.length === 0) {
      return new Response(
        JSON.stringify({ imported: 0, categories: categorySet.size }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Batch upsert - use smaller batches to match chunk size
    const BATCH_SIZE = 100;
    let imported = 0;

    for (let i = 0; i < productsToUpsert.length; i += BATCH_SIZE) {
      const batch = productsToUpsert.slice(i, i + BATCH_SIZE);
      const { error: batchError } = await supabase
        .from("products_cache")
        .upsert(batch, { onConflict: "sku" });

      if (batchError) {
        console.error(`Error upserting batch at ${i}:`, batchError);
      } else {
        imported += batch.length;
      }
    }

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
      JSON.stringify({ imported, categories: categorySet.size }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
