Deno.serve(async (req) => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const url = new URL(req.url);
  const sku = url.searchParams.get("sku") ?? "FA1-VW365-200";
  const paths = [
    `/api/Product/List?SKU=${encodeURIComponent(sku)}&PageNo=1&Limit=50`,
    `/api/Product/List?SearchTerm=${encodeURIComponent(sku)}&PageNo=1&Limit=50`,
    `/api/Product/List?Sku=${encodeURIComponent(sku)}&PageNo=1&Limit=50`,
    `/api/Product/List?Search=${encodeURIComponent(sku)}&PageNo=1&Limit=50`,
    `/api/Product/Search?SearchTerm=${encodeURIComponent(sku)}&PageNo=1&Limit=50`,
    `/api/Product/Search?Query=${encodeURIComponent(sku)}&PageNo=1&Limit=50`,
    `/api/Product?SKU=${encodeURIComponent(sku)}`,
    `/api/Product/GetBySKU?SKU=${encodeURIComponent(sku)}`,
    `/api/Product/GetBySKU/${encodeURIComponent(sku)}`,
    `/api/Product/Find/${encodeURIComponent(sku)}`,
    // try a partial fragment to see if List is doing prefix/substring match
    `/api/Product/List?SKU=${encodeURIComponent(sku.split("-")[0])}&PageNo=1&Limit=5`,
  ];
  const out: any = {};
  for (const p of paths) {
    try {
      const r = await fetch(`https://api.mintsoft.co.uk${p}`, { headers: { "ms-apikey": key } });
      const t = await r.text();
      out[p] = { status: r.status, len: t.length, body: t.slice(0, 400) };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
