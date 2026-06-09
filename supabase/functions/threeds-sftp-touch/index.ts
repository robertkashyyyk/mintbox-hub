// One-shot helper: write a header-only "SKU,Price" CSV to each named store's
// reprice file, so 3D Sellers' SFTP import can connect/test before any real push.
// Harmless (zero data rows); the first real push overwrites it. Service-role gated.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Client from "npm:ssh2-sftp-client@10.0.3";
import { Buffer } from "node:buffer";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let ok = bearer === serviceKey;
  if (!ok && bearer) { try { ok = JSON.parse(atob(bearer.split(".")[1] ?? ""))?.role === "service_role"; } catch { /* ignore */ } }
  if (!ok) return json({ error: "Unauthorized" }, 401);

  let body: { stores?: string[] } = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const names = Array.isArray(body.stores) ? body.stores : [];
  if (names.length === 0) return json({ error: "stores[] required (store_name values)" }, 400);

  const admin = createClient(url, serviceKey);
  const { data: stores } = await admin.from("threeds_stores").select("store_name, sftp_filename").in("store_name", names);
  if (!stores || stores.length === 0) return json({ error: "no matching stores" }, 404);

  const host = Deno.env.get("THREEDS_SFTP_HOST");
  const port = parseInt(Deno.env.get("THREEDS_SFTP_PORT") ?? "22", 10);
  const username = Deno.env.get("THREEDS_SFTP_USER");
  const password = Deno.env.get("THREEDS_SFTP_PASSWORD");
  if (!host || !username || !password) return json({ error: "SFTP creds not configured" }, 500);

  const results: { store: string; path: string; ok: boolean; error?: string }[] = [];
  const sftp = new Client();
  try {
    await sftp.connect({ host, port, username, password, readyTimeout: 20000 });
    for (const s of stores) {
      const path = s.sftp_filename as string;
      try {
        const dir = path.lastIndexOf("/") > 0 ? path.slice(0, path.lastIndexOf("/")) : "";
        if (dir && !(await sftp.exists(dir))) await sftp.mkdir(dir, true);
        // Don't clobber a file that already has real prices in it.
        const exists = await sftp.exists(path);
        if (exists) { results.push({ store: s.store_name, path, ok: true, error: "already exists — left as-is" }); continue; }
        await sftp.put(Buffer.from("SKU,Price\n", "utf-8"), path);
        results.push({ store: s.store_name, path, ok: true });
      } catch (e) {
        results.push({ store: s.store_name, path, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    await sftp.end();
  } catch (e) {
    try { await sftp.end(); } catch { /* ignore */ }
    return json({ error: `SFTP failed: ${e instanceof Error ? e.message : String(e)}`, results }, 502);
  }
  return json({ ok: true, results });
});
