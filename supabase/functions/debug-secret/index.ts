Deno.serve(async () => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const sku = "ASC-AH-3T";
  const id = "194385";
  const paths = [
    `/api/Product/${id}`,
    `/api/Product/List?SKU=${sku}&PageNo=1&Limit=50`,
    `/api/Product/List?SearchTerm=${sku}&PageNo=1&Limit=50`,
    `/api/Product/List?Sku=${sku}&PageNo=1&Limit=50`,
    `/api/Product/Find/${encodeURIComponent(sku)}`,
    `/api/Product/GetBySKU?SKU=${sku}`,
    `/api/Product/GetBySKU/${encodeURIComponent(sku)}`,
    `/api/Product/Search?SKU=${sku}&PageNo=1&Limit=50`,
  ];
  const out: any = {};
  for (const p of paths) {
    try {
      const r = await fetch(`https://api.mintsoft.co.uk${p}`, { headers: { "ms-apikey": key } });
      const t = await r.text();
      out[p] = { status: r.status, body: t.slice(0, 300) };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
