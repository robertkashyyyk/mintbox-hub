Deno.serve(async (req) => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const url = new URL(req.url);
  const sku = url.searchParams.get("sku") ?? "FA1-VW365-200";
  const enc = encodeURIComponent(sku);
  const paths = [
    `/api/Product/SearchProducts?SKU=${enc}`,
    `/api/Product/SearchProducts?SearchTerm=${enc}`,
    `/api/Product/SearchProducts?Search=${enc}`,
    `/api/Product/SearchProducts/${enc}`,
    `/api/Product/SearchBySKU?SKU=${enc}`,
    `/api/Product/SearchBySKU/${enc}`,
    `/api/Product/BySKU/${enc}`,
    `/api/Product/BySKU?SKU=${enc}`,
    `/api/Products/Search?SKU=${enc}`,
    `/api/Products?SKU=${enc}`,
    `/api/Product/List?SKUs=${enc}`,
    `/api/Product/List?Filter=${enc}`,
    `/api/Product/Lookup?SKU=${enc}`,
    `/api/Product/GetProductBySKU?SKU=${enc}`,
    `/api/Product/GetProductBySKU/${enc}`,
  ];
  const out: any = {};
  for (const p of paths) {
    try {
      const r = await fetch(`https://api.mintsoft.co.uk${p}`, { headers: { "ms-apikey": key } });
      const t = await r.text();
      out[p] = { status: r.status, len: t.length, body: t.slice(0, 250) };
    } catch (e) {
      out[p] = { error: String(e) };
    }
  }
  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
