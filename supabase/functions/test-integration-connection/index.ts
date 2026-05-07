import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestResult {
  success: boolean;
  message: string;
}

async function testMintsoftConnection(baseUrl: string, apiKey: string): Promise<TestResult> {
  try {
    // Test with a lightweight endpoint - get order statuses
    const response = await fetch(`${baseUrl}/api/Order/Statuses`, {
      method: "GET",
      headers: {
        "ms-apikey": apiKey,
        "Accept": "application/json",
      },
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        message: `Connected successfully. Found ${Array.isArray(data) ? data.length : 0} order statuses.`,
      };
    } else if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: "Authentication failed. Please check your API key.",
      };
    } else {
      return {
        success: false,
        message: `API returned status ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

async function test3DSellersConnection(baseUrl: string, apiKey: string): Promise<TestResult> {
  // 3D Sellers uses OAuth2. /auth/me validates a Bearer access token.
  // Docs: https://api.3dsellers.com/docs
  const root = (baseUrl || "https://api.3dsellers.com").replace(/\/+$/, "");
  try {
    const response = await fetch(`${root}/auth/me`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/json",
      },
    });
    const body = await response.text();
    if (response.ok) {
      return { success: true, message: "Connected to 3D Sellers (token valid)." };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        message: "Token rejected. 3D Sellers uses OAuth2 — the stored value must be a valid access token (not a client secret). See https://api.3dsellers.com/docs#/Auth.",
      };
    }
    return { success: false, message: `API returned ${response.status}: ${body.slice(0, 200)}` };
  } catch (error) {
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request
    const { integration } = await req.json();
    
    if (!integration) {
      return new Response(
        JSON.stringify({ error: "Integration name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get integration config
    const { data: integrationData, error: fetchError } = await supabase
      .from("integrations")
      .select("*")
      .eq("name", integration)
      .single();

    if (fetchError || !integrationData) {
      return new Response(
        JSON.stringify({ success: false, message: "Integration not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!integrationData.base_url) {
      return new Response(
        JSON.stringify({ success: false, message: "Base URL not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to testing
    await supabase
      .from("integrations")
      .update({ connection_status: "testing" })
      .eq("id", integrationData.id);

    let result: TestResult;

    // Get API key from secrets based on integration
    switch (integration) {
      case "mintsoft": {
        const apiKey = Deno.env.get("MINTSOFT_API_KEY");
        if (!apiKey) {
          result = { success: false, message: "MINTSOFT_API_KEY secret not configured" };
        } else {
          result = await testMintsoftConnection(integrationData.base_url, apiKey);
        }
        break;
      }
      case "3dsellers": {
        const apiKey = Deno.env.get("THREEDS_API_KEY");
        if (!apiKey) {
          result = { success: false, message: "THREEDS_API_KEY secret not configured. Add it to backend secrets." };
        } else {
          result = await test3DSellersConnection(integrationData.base_url, apiKey);
        }
        break;
      }
      default:
        result = { success: false, message: `Unknown integration: ${integration}` };
    }

    // Update integration status
    await supabase
      .from("integrations")
      .update({
        connection_status: result.success ? "connected" : "error",
        error_message: result.success ? null : result.message,
        last_connected_at: result.success ? new Date().toISOString() : integrationData.last_connected_at,
      })
      .eq("id", integrationData.id);

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Test connection error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        message: error instanceof Error ? error.message : "Internal server error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
