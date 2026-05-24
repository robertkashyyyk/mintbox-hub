// DEPRECATED: this function used to aggregate stock across all Mintsoft warehouses,
// which corrupted products_cache.current_stock by counting non-Coleraine (dropship)
// inventory as if we owned it. The single source of truth for current_stock is now
// `sftp-pull-stock`, which filters Warehouse = Coleraine LIVE and uses OnHand
// (net of allocations). This function is intentionally a no-op redirect.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Forward to the canonical Coleraine-LIVE-only puller.
  const { data, error } = await supabase.functions.invoke("sftp-pull-stock");

  return new Response(
    JSON.stringify({
      deprecated: true,
      message:
        "pull-mintsoft-stock-ftp is deprecated. Forwarded to sftp-pull-stock (Coleraine LIVE, OnHand-based).",
      forwarded_result: data ?? null,
      forwarded_error: error?.message ?? null,
    }),
    {
      status: error ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
