// One-off probe: GET /v1/products?sku=... from 3Dsellers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const sku = url.searchParams.get("sku") ?? "";
    const token = Deno.env.get("THREEDS_API_KEY");
    if (!token) throw new Error("THREEDS_API_KEY missing");
    if (!sku) throw new Error("sku query param required");

    const r = await fetch(
      `https://api.3dsellers.com/v1/products?sku=${encodeURIComponent(sku)}&limit=10&withVariants=true`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    const text = await r.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    return new Response(
      JSON.stringify({ status: r.status, body }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
