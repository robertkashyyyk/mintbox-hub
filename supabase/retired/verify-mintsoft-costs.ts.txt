// Temporary: verify CostPrice on Mintsoft for given product IDs
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const mintsoftKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!mintsoftKey) {
    return new Response(JSON.stringify({ error: "No API key" }), { status: 500, headers: corsHeaders });
  }

  const { product_ids } = await req.json() as { product_ids: number[] };
  const results: Record<string, any> = {};

  for (const id of product_ids) {
    try {
      const resp = await fetch(`https://api.mintsoft.co.uk/api/Product/${id}`, {
        headers: { "ms-apikey": mintsoftKey },
      });
      if (!resp.ok) {
        results[String(id)] = { error: `HTTP ${resp.status}` };
        continue;
      }
      const data = await resp.json();
      results[String(id)] = {
        SKU: data.SKU,
        CostPrice: data.CostPrice,
        Name: data.Name?.slice(0, 60),
      };
    } catch (e: any) {
      results[String(id)] = { error: e.message };
    }
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
