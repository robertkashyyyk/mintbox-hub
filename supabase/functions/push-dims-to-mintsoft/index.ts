// Push approved product DIMENSIONS + WEIGHT from the Hub catalogue (products_cache) to Mintsoft.
// Mirrors update-product-cost (the proven edge->Mintsoft write path). Auth: senior/super.
//
// SAFETY: dryRun defaults TRUE — it only READS Mintsoft's current dims (so we can confirm the
// exact field names + units before writing live). Pass {dryRun:false} to actually push.
//
// Body: { skus?: string[], dryRun?: boolean }
//   - skus given  -> push those.
//   - no skus     -> all applied dims proposals not yet pushed (status=applied, pushed_to_mintsoft_at null).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MINTSOFT_BASE = "https://api.mintsoft.co.uk";
const TOOL = "dims_weights";

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date().toISOString();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const mintsoftKey = Deno.env.get("MINTSOFT_API_KEY");
  if (!mintsoftKey) return json({ error: "MINTSOFT_API_KEY not set" }, 500);

  // ---- Auth: must be senior_user or super_user ----
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user?.id) return json({ error: "Unauthorized" }, 401);
  const userId = userData.user.id;

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: hasRole, error: roleErr } = await admin.rpc("has_any_role", {
    _user_id: userId, _roles: ["super_user", "senior_user"],
  });
  if (roleErr || !hasRole) return json({ error: "Forbidden — senior or super role required" }, 403);

  // ---- Input ----
  let body: { skus?: string[]; dryRun?: boolean } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const dryRun = body.dryRun !== false; // DEFAULT TRUE

  // ---- Select SKUs to push ----
  let skus: string[];
  if (Array.isArray(body.skus) && body.skus.length) {
    skus = body.skus.slice(0, 100);
  } else {
    const { data: props } = await admin
      .from("web_search_proposals")
      .select("sku")
      .eq("tool", TOOL).eq("status", "applied").is("pushed_to_mintsoft_at", null)
      .limit(100);
    skus = (props ?? []).map((r: any) => r.sku);
  }
  if (skus.length === 0) return json({ results: [], successCount: 0, failCount: 0, message: "nothing to push" });

  const { data: rows } = await admin
    .from("products_cache")
    .select("sku, mintsoft_id, height, length, depth, weight")
    .in("sku", skus);

  const results: any[] = [];
  for (const it of (rows ?? []) as any[]) {
    try {
      if (!it.mintsoft_id) { results.push({ sku: it.sku, ok: false, error: "no mintsoft_id" }); continue; }

      // Current Mintsoft state (always read first — confirms units/fields).
      const curRes = await fetch(`${MINTSOFT_BASE}/api/Product/${it.mintsoft_id}`, { headers: { "ms-apikey": mintsoftKey } });
      const cur = curRes.ok ? await curRes.json() : null;

      if (dryRun) {
        results.push({
          sku: it.sku, mintsoft_id: it.mintsoft_id,
          cache: { height: it.height, length: it.length, depth: it.depth, weight: it.weight },
          mintsoft_current: cur ? { Height: cur.Height, Length: cur.Length, Width: cur.Width, Depth: cur.Depth, Weight: cur.Weight } : null,
        });
        continue;
      }

      // Send ONLY {ID + the dim fields we have}. Field mapping confirmed against live Mintsoft:
      //   - cache.length -> Mintsoft 'Width' (documented quirk; Mintsoft has no usable 'Length')
      //   - cache.height -> Height, cache.depth -> Depth (direct)
      //   - cache.weight is in GRAMS; Mintsoft weight is in KILOGRAMS -> divide by 1000.
      const payload: Record<string, unknown> = { ID: it.mintsoft_id };
      if (it.height != null) payload.Height = it.height;
      if (it.length != null) payload.Width = it.length;
      if (it.depth != null) payload.Depth = it.depth;
      if (it.weight != null) payload.Weight = +(Number(it.weight) / 1000).toFixed(3);
      if (Object.keys(payload).length === 1) { results.push({ sku: it.sku, ok: false, error: "no dims to push" }); continue; }

      const postRes = await fetch(`${MINTSOFT_BASE}/api/Product`, {
        method: "POST",
        headers: { "ms-apikey": mintsoftKey, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const postText = await postRes.text();
      if (!postRes.ok) { results.push({ sku: it.sku, ok: false, error: `HTTP ${postRes.status}: ${postText.slice(0, 160)}` }); continue; }
      let parsed: any = null; try { parsed = JSON.parse(postText); } catch { /* ignore */ }
      if (parsed && parsed.Success === false) { results.push({ sku: it.sku, ok: false, error: `Mintsoft rejected: ${parsed.Message ?? postText.slice(0, 160)}` }); continue; }

      // Verify by re-reading.
      let verified = true;
      const vRes = await fetch(`${MINTSOFT_BASE}/api/Product/${it.mintsoft_id}`, { headers: { "ms-apikey": mintsoftKey } });
      if (vRes.ok) {
        const v = await vRes.json();
        const close = (a: any, b: any) => a == null || (b != null && Math.abs(Number(a) - Number(b)) <= 0.5);
        const wkg = it.weight != null ? Number(it.weight) / 1000 : null;
        const closeW = (a: any, b: any) => a == null || (b != null && Math.abs(Number(a) - Number(b)) <= 0.05);
        verified = close(it.height, v.Height) && close(it.length, v.Width) && close(it.depth, v.Depth) && closeW(wkg, v.Weight);
      }

      const now = new Date().toISOString();
      await admin.from("web_search_proposals")
        .update({ pushed_to_mintsoft_at: now })
        .eq("sku", it.sku).eq("tool", TOOL).eq("status", "applied");
      await admin.from("products_cache").update({ dim_search_status: "pushed" }).eq("sku", it.sku);

      results.push({ sku: it.sku, ok: true, verified });
    } catch (e: any) {
      results.push({ sku: it.sku, ok: false, error: e?.message ?? String(e) });
    }
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => r.ok === false).length;
  if (!dryRun) {
    await admin.from("edge_function_runs").insert({
      function_name: "push-dims-to-mintsoft", started_at: startedAt, ended_at: new Date().toISOString(),
      status: failCount === 0 ? "success" : (successCount === 0 ? "failed" : "partial"),
      message: `${successCount} pushed / ${failCount} failed`, details: { user_id: userId, results },
    } as any);
  }
  return json({ dryRun, results, successCount, failCount });
});
