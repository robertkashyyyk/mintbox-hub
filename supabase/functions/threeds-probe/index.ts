const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Try multiple auth strategies so we can identify which one the key works with.
const STRATEGIES = (token: string) => [
  { name: "Bearer", headers: { Authorization: `Bearer ${token}` } },
  { name: "x-api-key", headers: { "x-api-key": token } },
  { name: "api-key", headers: { "api-key": token } },
  { name: "Token", headers: { Authorization: `Token ${token}` } },
  { name: "ApiKey", headers: { Authorization: `ApiKey ${token}` } },
  { name: "raw-Authorization", headers: { Authorization: token } },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path") ?? "/v1/sellers";
    const single = url.searchParams.get("auth"); // optional: only try one strategy
    const token = Deno.env.get("THREEDS_API_KEY");
    if (!token) throw new Error("THREEDS_API_KEY missing");

    const tries = single
      ? STRATEGIES(token).filter((s) => s.name === single)
      : STRATEGIES(token);

    const results: Array<Record<string, unknown>> = [];
    for (const s of tries) {
      const r = await fetch(`https://api.3dsellers.com${path}`, {
        headers: { ...s.headers, Accept: "application/json" },
      });
      const text = await r.text();
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = text.slice(0, 400); }
      results.push({ strategy: s.name, status: r.status, body });
      if (r.status === 200) break; // stop on first success
    }

    return new Response(
      JSON.stringify({ path, token_preview: `${token.slice(0, 6)}…${token.slice(-4)}`, results }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
