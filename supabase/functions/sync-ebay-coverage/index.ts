// sync-ebay-coverage — Phase B.1 listing-coverage sync (eBay UK), SERVER-SIDE +
// CHUNKED. Pages 3D Sellers GET /v1/products/listings for the 5 UK eBay accounts,
// maps each listing's raw SKU to the TRUE internal SKU via threeds_sku_aliases,
// and upserts into public.listing_coverage. Runs in ~110s time-budgeted chunks
// with a resumable cursor (listing_coverage_sync) so pg_cron can kick it off
// weekly and advance it through the small hours. Delisted rows (not seen this
// run) are removed per account as each account completes.
//
// Invoke (cron only):
//   { "kickoff": true }  -> start a fresh full pass (reset cursor + run_token)
//   { }                  -> continue an in-progress pass (no-op if idle/done)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BASE = "https://api.3dsellers.com";
const LIMIT = 100;
const BUDGET_MS = 110_000;

// The 5 UK eBay accounts (foreign marketplaces deliberately excluded).
const UK_ACCOUNTS = [
  { sellerId: 567489, store: "123autocare" },
  { sellerId: 567491, store: "carpartsintl" },
  { sellerId: 567497, store: "no1autoshop" },
  { sellerId: 566068, store: "theautostopshop" },
  { sellerId: 567490, store: "ascgroupltd" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("THREE_DS_API_KEY")!;

  // Cron-only: accept the service-role key by value OR by JWT role claim
  // (mirrors threeds-reprice-reconcile — robust to multiple valid service tokens).
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authed = bearer === serviceKey;
  if (!authed && bearer) { try { authed = JSON.parse(atob(bearer.split(".")[1] ?? ""))?.role === "service_role"; } catch { /* ignore */ } }
  if (!authed) return json({ error: "Unauthorized" }, 401);

  let body: { kickoff?: boolean } = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const db = createClient(url, serviceKey);
  const tds = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  const started = Date.now();

  // ── Load / initialise sync state ──────────────────────────────────────────
  const { data: state } = await db.from("listing_coverage_sync").select("*").eq("channel", "ebay").maybeSingle();
  let phase = state?.phase ?? "idle";
  let acct = state?.cursor_acct ?? 0;
  let page = state?.cursor_page ?? 1;
  let runToken = state?.run_token ?? null;
  let rowsThisRun = state?.rows_this_run ?? 0;

  if (body.kickoff || phase !== "running") {
    if (!body.kickoff) return json({ ok: true, skipped: phase }); // continue tick with nothing running
    phase = "running"; acct = 0; page = 1; rowsThisRun = 0;
    runToken = new Date().toISOString();
  }

  // ── Alias map (dirt SKU -> true SKU) ──────────────────────────────────────
  const aliases = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("threeds_sku_aliases").select("dirt_sku, true_sku").range(from, from + 999);
    for (const r of data ?? []) aliases.set(r.dirt_sku, r.true_sku);
    if (!data || data.length < 1000) break;
  }

  const save = () => db.from("listing_coverage_sync").upsert({
    channel: "ebay", phase, cursor_acct: acct, cursor_page: page,
    run_token: runToken, rows_this_run: rowsThisRun,
    last_run_at: phase === "done" ? runToken : state?.last_run_at ?? null,
    rows_upserted: phase === "done" ? rowsThisRun : state?.rows_upserted ?? null,
    note: `${UK_ACCOUNTS.length} UK accounts`,
  }, { onConflict: "channel" });

  await save(); // make phase='running' + reset cursor observable immediately (not just at the end)

  let pagesDone = 0;
  while (Date.now() - started < BUDGET_MS) {
    if (acct >= UK_ACCOUNTS.length) { phase = "done"; break; }
    const a = UK_ACCOUNTS[acct];

    const res = await fetch(`${BASE}/v1/products/listings?sellerId=${a.sellerId}&status=Active&page=${page}&limit=${LIMIT}`, { headers: tds });
    if (!res.ok) { await save(); return json({ ok: false, error: `listings ${a.sellerId} p${page} -> ${res.status}`, phase, acct, page }); }
    const j = await res.json();
    const rows = (j.data ?? []) as any[];

    const batch = rows
      .filter((r) => r.itemId && r.sku && String(r.sku).trim())
      .map((r) => ({
        sku: aliases.get(r.sku) ?? r.sku, listing_sku: r.sku, channel: "ebay",
        seller_id: a.sellerId, store_name: a.store, marketplace: "UK",
        item_id: String(r.itemId), status: r.status, price: r.price ?? null,
        quantity: r.quantity ?? null, url: r.url ?? null, source: "3ds", last_seen_at: runToken,
      }));
    for (let i = 0; i < batch.length; i += 500) {
      const { error } = await db.from("listing_coverage").upsert(batch.slice(i, i + 500), { onConflict: "channel,seller_id,item_id" });
      if (error) { await save(); return json({ ok: false, error: error.message, phase, acct, page }); }
    }
    rowsThisRun += batch.length;
    pagesDone++;

    if (rows.length < LIMIT) {
      // Account finished — remove rows it no longer carries, advance.
      await db.from("listing_coverage").delete()
        .eq("channel", "ebay").eq("seller_id", a.sellerId).lt("last_seen_at", runToken);
      acct++; page = 1;
    } else {
      page++;
    }
  }

  if (acct >= UK_ACCOUNTS.length) phase = "done";
  await save();
  return json({ ok: true, phase, acct, page, pagesDone, rowsThisRun });
});
