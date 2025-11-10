import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const TOKEN = Deno.env.get("PARTSDOC_INGEST_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-partsdoc-signature',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    console.log("Method not allowed:", req.method);
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { 
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const sig = req.headers.get("x-partsdoc-signature");
  console.log("Received signature:", sig ? "present" : "missing");
  
  if (!sig || sig !== TOKEN) {
    console.log("Unauthorized: signature mismatch");
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const payload = await req.json();
    console.log("Processing email:", payload.subject);
    
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Upsert into emails
    const { data: email, error: e1 } = await sb.from("emails").upsert({
      thread_id: payload.threadId,
      message_id: payload.messageId,
      sender: payload.from,
      subject: payload.subject,
      received_at: payload.date,
      labels: payload.labels ?? [],
      body: payload.snippet ?? null
    }, { onConflict: "message_id" }).select().single();
    
    if (e1) {
      console.error("Error upserting email:", e1);
      return new Response(JSON.stringify({ error: e1.message }), { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log("Email upserted successfully:", email.id);

    // Create alert based on subject keywords
    const subj = (payload.subject || "").toLowerCase();
    let type: string | null = null;
    let severity: string = "info";
    
    if (subj.includes("low stock")) {
      type = "LowStock";
      severity = "warning";
    } else if (subj.includes("simple stock level")) {
      type = "RemoteStock";
      severity = "info";
    } else if (subj.includes("back order") || subj.includes("backorder")) {
      type = "BackOrders";
      severity = "info";
    }
    
    if (type) {
      const { error: e2 } = await sb.from("alerts").insert([{
        email_id: email.id,
        alert_type: type,
        severity: severity,
        occurred_at: payload.date
      }]);
      
      if (e2) {
        console.error("Error creating alert:", e2);
      } else {
        console.log("Alert created:", type);
      }
    }

    // Log the ingestion
    const { error: e3 } = await sb.from("ingest_logs").insert([{ 
      source: "gmail-apps-script", 
      status: "ok", 
      detail: payload.subject 
    }]);
    
    if (e3) {
      console.error("Error logging ingestion:", e3);
    }

    // Process CSV attachments if present
    if (payload.attachments && Array.isArray(payload.attachments) && payload.attachments.length > 0) {
      console.log(`Processing ${payload.attachments.length} attachments`);
      
      // Fetch brand prefixes for mapping
      const { data: brandPrefixes, error: prefixError } = await sb
        .from("brand_prefixes")
        .select("brand_name, prefix");
      
      if (prefixError) {
        console.error("Error fetching brand prefixes:", prefixError);
      }

      const prefixMap = new Map<string, string>();
      if (brandPrefixes) {
        for (const bp of brandPrefixes) {
          prefixMap.set(bp.prefix, bp.brand_name);
        }
      }

      for (const att of payload.attachments) {
        if (!att.mimeType?.includes("csv") && !att.filename?.endsWith(".csv")) {
          console.log("Skipping non-CSV attachment:", att.filename);
          continue;
        }

        try {
          // Decode base64 CSV
          const csvBytes = decodeBase64(att.contentBase64);
          const csvText = new TextDecoder().decode(csvBytes);
          const lines = csvText.split(/\r?\n/).filter(l => l.trim());
          
          if (lines.length < 2) {
            console.log("CSV has no data rows:", att.filename);
            continue;
          }

          // Determine report type based on subject
          let reportType: string | null = null;
          if (subj.includes("low stock")) {
            reportType = "LowStock";
          } else if (subj.includes("inventory") || subj.includes("simple stock level") || subj.includes("warehouse")) {
            reportType = "Inventory";
          }

          if (!reportType) {
            console.log("Unknown report type for attachment:", att.filename);
            continue;
          }

          console.log(`Parsing ${reportType} report:`, att.filename);

          // Parse header
          const headerLine = lines[0];
          const headers = headerLine.split(/\t|,/).map(h => h.trim());
          
          // Build column index map
          const colMap = new Map<string, number>();
          headers.forEach((h, i) => colMap.set(h, i));

          const parsedItems: any[] = [];

          // Parse data rows
          for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            const cells = line.split(/\t|,/).map(c => c.trim());
            
            let sku: string | null = null;
            let qty: number | null = null;
            let warehouse: string | null = null;

            if (reportType === "LowStock") {
              // LowStock CSV columns: Product SKU, Name, Warehouse, LowStockLevel, Stock level, On Order
              const skuIdx = colMap.get("Product SKU") ?? colMap.get("SKU");
              const warehouseIdx = colMap.get("Warehouse");
              const qtyIdx = colMap.get("Stock level") ?? colMap.get("CurrentQty");

              if (skuIdx !== undefined) sku = cells[skuIdx] || null;
              if (warehouseIdx !== undefined) warehouse = cells[warehouseIdx] || null;
              if (qtyIdx !== undefined) {
                const qtyStr = cells[qtyIdx];
                qty = qtyStr ? parseFloat(qtyStr) : null;
              }
            } else if (reportType === "Inventory") {
              // Inventory CSV columns: Client, SKU, AltCodes, Name, Price, Weight, Warehouse, ..., On Hand, ...
              const skuIdx = colMap.get("SKU");
              const warehouseIdx = colMap.get("Warehouse");
              const availableIdx = colMap.get("Available") ?? colMap.get("AvailableQty");
              const onHandIdx = colMap.get("On Hand") ?? colMap.get("OnHandQty");

              if (skuIdx !== undefined) sku = cells[skuIdx] || null;
              if (warehouseIdx !== undefined) warehouse = cells[warehouseIdx] || null;
              
              // Try AvailableQty first, fallback to OnHandQty
              if (availableIdx !== undefined) {
                const qtyStr = cells[availableIdx];
                qty = qtyStr ? parseFloat(qtyStr) : null;
              }
              if (qty === null && onHandIdx !== undefined) {
                const qtyStr = cells[onHandIdx];
                qty = qtyStr ? parseFloat(qtyStr) : null;
              }
            }

            if (!sku) {
              continue; // Skip rows without SKU
            }

            // Map brand_name from prefix
            let brandName: string | null = null;
            for (const [prefix, brand] of prefixMap.entries()) {
              if (sku.startsWith(prefix)) {
                brandName = brand;
                break;
              }
            }

            // Build raw JSON from all cells
            const rawObj: Record<string, string> = {};
            headers.forEach((h, idx) => {
              if (cells[idx] !== undefined) {
                rawObj[h] = cells[idx];
              }
            });

            parsedItems.push({
              email_id: email.id,
              report_type: reportType,
              occurred_at: payload.date,
              sku: sku,
              qty: qty,
              warehouse: warehouse,
              brand_name: brandName,
              raw: rawObj
            });
          }

          // Bulk insert parsed items
          if (parsedItems.length > 0) {
            const { error: insertError } = await sb
              .from("parsed_items")
              .insert(parsedItems);
            
            if (insertError) {
              console.error("Error inserting parsed items:", insertError);
            } else {
              console.log(`Inserted ${parsedItems.length} parsed items from ${att.filename}`);
            }
          }
        } catch (parseErr) {
          console.error("Error parsing attachment:", att.filename, parseErr);
        }
      }
    }

    console.log("Email intake completed successfully");
    return new Response(JSON.stringify({ ok: true }), { 
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("Server error:", err);
    
    // Log the error
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await sb.from("ingest_logs").insert([{ 
      source: "gmail-apps-script", 
      status: "error", 
      detail: err instanceof Error ? err.message : "Unknown error"
    }]);
    
    return new Response(JSON.stringify({ error: "Server error" }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
