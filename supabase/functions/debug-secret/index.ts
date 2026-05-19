Deno.serve(async () => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const paths = [
    "/api/Product/Search/ASC-TUB-29-PV",
    "/api/Product/SearchBySKU/ASC-TUB-29-PV",
    "/api/Product/BySKU/ASC-TUB-29-PV",
    "/api/Product/FindBySKU?SKU=ASC-TUB-29-PV",
    "/api/Product?SKU=ASC-TUB-29-PV",
  ];
  const out: any = {};
  for (const p of paths) {
    const r = await fetch(`https://api.mintsoft.co.uk${p}`, { headers: { "ms-apikey": key } });
    const t = await r.text();
    out[p] = { status: r.status, body: t.slice(0, 300) };
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
