Deno.serve(async () => {
  const key = Deno.env.get("MINTSOFT_API_KEY") ?? "";
  const paths = ["/api/Warehouse", "/api/Warehouse/Search", "/api/Client/3/Warehouses", "/api/Warehouses/List"];
  const out: any = {};
  for (const p of paths) {
    const r = await fetch(`https://api.mintsoft.co.uk${p}`, { headers: { "ms-apikey": key } });
    out[p] = { status: r.status, body: (await r.text()).slice(0, 500) };
  }
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
});
