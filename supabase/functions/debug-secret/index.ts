Deno.serve(async () => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const r = await fetch("https://api.mintsoft.co.uk/api/Product/List?SKU=ASC-TUB-29-PV", {
    headers: { "ms-apikey": key },
  });
  const text = await r.text();
  return new Response(JSON.stringify({ status: r.status, body: text.slice(0, 4000) }), {
    headers: { "Content-Type": "application/json" },
  });
});
