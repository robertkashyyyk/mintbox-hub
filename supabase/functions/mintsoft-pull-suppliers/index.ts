// mintsoft-pull-suppliers
//
// One-shot sweep that fetches all suppliers from Mintsoft and upserts them
// into public.suppliers. Matches by mintsoft_supplier_id when present, else
// case-insensitive name. Existing local edits (contact, ordering_method,
// notes, lead_time_days) are preserved — we only fill gaps and stamp the
// mintsoft_supplier_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MINTSOFT_BASE = "https://api.mintsoft.co.uk";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = new Date().toISOString();

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing auth" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) return json({ error: "MINTSOFT_API_KEY not set" }, 500);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthenticated" }, 401);

    const svc = createClient(url, svcKey);

    // Try the standard endpoints. Mintsoft exposes supplier listing under a
    // few names depending on tenant; we try in order.
    const candidates = [
      "/api/Supplier/List",
      "/api/Suppliers/List",
      "/api/Supplier",
      "/api/Suppliers",
    ];
    let suppliers: any[] | null = null;
    let usedPath = "";
    let lastStatus = 0;
    let lastBody = "";
    for (const p of candidates) {
      const r = await fetch(`${MINTSOFT_BASE}${p}`, {
        headers: { "ms-apikey": apiKey, "Accept": "application/json" },
      });
      lastStatus = r.status;
      const t = await r.text();
      lastBody = t.slice(0, 400);
      if (!r.ok) continue;
      try {
        const j = JSON.parse(t);
        const arr = Array.isArray(j) ? j : (j?.Results ?? j?.Data ?? j?.Items ?? null);
        if (Array.isArray(arr)) { suppliers = arr; usedPath = p; break; }
      } catch { /* try next */ }
    }
    if (!suppliers) {
      return json({ error: `Could not fetch suppliers from Mintsoft (last ${lastStatus}): ${lastBody}` }, 502);
    }

    // Load existing for de-dupe
    const { data: existing } = await svc.from("suppliers").select("id, name, mintsoft_supplier_id, contact_email, contact_name, contact_phone");
    const byMsId = new Map<number, any>();
    const byName = new Map<string, any>();
    for (const e of existing || []) {
      if (e.mintsoft_supplier_id) byMsId.set(e.mintsoft_supplier_id, e);
      if (e.name) byName.set(String(e.name).trim().toLowerCase(), e);
    }

    let created = 0, updated = 0, skipped = 0;
    const samples: any[] = [];

    for (const s of suppliers) {
      const msId = Number(s.ID ?? s.Id ?? s.SupplierID ?? s.SupplierId);
      const name = String(s.Name ?? s.SupplierName ?? "").trim();
      if (!name || !Number.isFinite(msId)) { skipped++; continue; }

      const email = s.Email ?? s.ContactEmail ?? null;
      const contact = s.ContactName ?? s.Contact ?? null;
      const phone = s.Telephone ?? s.Phone ?? s.ContactPhone ?? null;

      const match = byMsId.get(msId) || byName.get(name.toLowerCase());
      if (match) {
        const patch: any = { mintsoft_supplier_id: msId };
        if (!match.contact_email && email) patch.contact_email = email;
        if (!match.contact_name && contact) patch.contact_name = contact;
        if (!match.contact_phone && phone) patch.contact_phone = phone;
        await svc.from("suppliers").update(patch).eq("id", match.id);
        updated++;
      } else {
        await svc.from("suppliers").insert({
          name, mintsoft_supplier_id: msId,
          contact_email: email, contact_name: contact, contact_phone: phone,
          ordering_method: "email", active: true,
        });
        created++;
      }
      if (samples.length < 5) samples.push({ msId, name });
    }

    await svc.from("edge_function_runs").insert({
      function_name: "mintsoft-pull-suppliers",
      started_at: startedAt, ended_at: new Date().toISOString(),
      status: "success",
      message: `Pulled ${suppliers.length} suppliers via ${usedPath}: created ${created}, updated ${updated}, skipped ${skipped}`,
      details: { used_path: usedPath, total: suppliers.length, created, updated, skipped, samples },
    } as any);

    return json({ ok: true, total: suppliers.length, created, updated, skipped, used_path: usedPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("mintsoft-pull-suppliers failed:", msg);
    return json({ error: msg }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
