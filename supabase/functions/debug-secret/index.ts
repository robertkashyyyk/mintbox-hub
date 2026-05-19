Deno.serve(async () => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const sku = "ASC-NPP-050";
  const paths = [
    `/api/Product/Search?SKU=${sku}&PageNo=1&Limit=50`,
    `/api/Product/Search?SearchTerm=${sku}&PageNo=1&Limit=50`,
    `/api/Product/Search?SearchString=${sku}&PageNo=1&Limit=50`,
    `/api/Product/List?SKU=${sku}&PageNo=1&Limit=50`,
    `/api/Product/List?SearchTerm=${sku}&PageNo=1&Limit=50`,
    `/api/Product/Search?SKU=${sku}`,
  ];
  const out: any = {};
  for (const p of paths) {
    const r = await fetch(`https://api.mintsoft.co.uk${p}`, { headers: { "ms-apikey": key } });
    const t = await r.text();
    out[p] = { status: r.status, body: t.slice(0, 400) };
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
