import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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
