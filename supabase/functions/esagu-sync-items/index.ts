// ============================================================================
// esagu-sync-items — Phase 1 mirror sync. Paginates eSagu GET /item, parses the
// current strategy (min/max/fixed/mode) and buy-box (from offers[]), converts
// pennies → £, and upserts into amazon.esagu_item via amazon_ingest_esagu_items.
//
// eSagu auth: Bearer <ESAGU_KEY> (the JWT; ESAGU_JWT is an API key, not a JWT).
// Rate limit ~3600/hr; we page 100 at a time via by-id-greater-than.
//
// Body: { maxPages?: number (default 200), pageDelayMs?: number (default 120) }
// Auth: service-role JWT (ops/cron) — gateway verify_jwt.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";
const p = (pennies: unknown): number | null =>
  pennies == null || pennies === "" ? null : Math.round(Number(pennies)) / 100;

// eSagu mixes formats: inserted/updated are ISO strings, offersUpdated is an
// epoch in ms. Normalise any of them to an ISO string (or null).
const toIso = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number" || /^\d{10,}$/.test(String(v))) {
    const d = new Date(Number(v));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return String(v);
};

const landed = (o: any) => (Number(o.listingPrice) || 0) + (Number(o.shipping) || 0);
// eSagu marks offers it won't compete with (e.g. ships-from-abroad) via
// exclusionReasons. The "competable" competitor = cheapest NON-excluded offer.
const isExcluded = (o: any) => Array.isArray(o.exclusionReasons) && o.exclusionReasons.length > 0;

function mapItem(it: any) {
  const offers: any[] = Array.isArray(it.offers) ? it.offers : [];
  const bb = offers.find((o) => Array.isArray(o.flags) && o.flags.includes("IS_BUY_BOX_WINNER"));
  const ps = it.strategy?.priceSettings ?? {};

  let compSeller: string | null = null, compPennies: number | null = null;
  for (const o of offers) {
    if (isExcluded(o)) continue;
    const lp = landed(o);
    if (compPennies == null || lp < compPennies) { compPennies = lp; compSeller = o.sellerId ?? null; }
  }

  return {
    id: it.id,
    sku: it.sku ?? null,
    asin: it.asin ?? null,
    title: it.title ?? null,
    fba: !!it.fba,
    prime: !!it.prime,
    quantity: it.quantity ?? null,
    merchantShippingGroup: it.merchantShippingGroup ?? null,
    amazonPrice: p(it.amazonPrice),
    minPrice: p(ps.minPrice),
    maxPrice: p(ps.maxPrice),
    fixedPrice: p(ps.fixedPrice),
    mode: ps.mode ?? null,
    buyBoxSeller: bb?.sellerId ?? null,
    buyBoxPrice: bb ? p(landed(bb)) : null,
    buyBoxExcluded: bb ? isExcluded(bb) : null,          // box held by a seller we ignore
    competablePrice: compPennies == null ? null : compPennies / 100,
    competableSeller: compSeller,
    offerCount: offers.length,
    strategy: it.strategy ?? null,
    offers: offers.map((o) => ({ seller: o.sellerId, price: p(landed(o)), flags: o.flags, excl: o.exclusionReasons ?? [] })),
    esaguInserted: toIso(it.inserted),
    esaguUpdated: toIso(it.updated),
    offersUpdated: toIso(it.offersUpdated),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const esaguToken = Deno.env.get("ESAGU_KEY") ?? Deno.env.get("ESAGU_JWT");
  if (!esaguToken) return json({ ok: false, error: "ESAGU_KEY not set in vault." }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  let maxPages = 200, pageDelayMs = 120, startAfterId: number | undefined;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.maxPages) maxPages = Math.min(1000, Math.max(1, Number(body.maxPages)));
    if (body.pageDelayMs != null) pageDelayMs = Math.max(0, Number(body.pageDelayMs));
    if (body.startAfterId != null) startAfterId = Number(body.startAfterId);
  } catch { /* defaults */ }

  let lastId: number | undefined = startAfterId;
  let pages = 0, totalFetched = 0, totalUpserted = 0;
  let rate: Record<string, string | null> = {};

  try {
    while (pages < maxPages) {
      const url = new URL(`${ESAGU_BASE}/item`);
      url.searchParams.set("limit", "100");
      if (lastId != null) url.searchParams.set("by-id-greater-than", String(lastId));

      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${esaguToken}`, Accept: "application/json" } });
      rate = { limit: res.headers.get("X-RateLimit-Limit"), remaining: res.headers.get("X-RateLimit-Remaining") };
      if (!res.ok) {
        const t = await res.text();
        return json({ ok: false, stage: "esagu", status: res.status, pages, totalFetched, totalUpserted, rate, body: t.slice(0, 400) }, 200);
      }
      const payload = await res.json();
      const items: any[] = Array.isArray(payload) ? payload : (payload?.items ?? payload?.content ?? []);
      if (items.length === 0) break;

      const mapped = items.map(mapItem);
      const { data, error } = await supabase.rpc("amazon_ingest_esagu_items", { p_items: mapped });
      if (error) return json({ ok: false, stage: "ingest", pages, totalFetched, totalUpserted, error: error.message }, 200);

      pages++;
      totalFetched += items.length;
      totalUpserted += Number((data as any)?.rows_upserted ?? 0);
      lastId = Number(items[items.length - 1].id);
      if (items.length < 100) break;
      if (pageDelayMs) await new Promise((r) => setTimeout(r, pageDelayMs));
    }

    return json({ ok: true, pages, totalFetched, totalUpserted, lastId, rate, cappedAtMaxPages: pages >= maxPages });
  } catch (e) {
    return json({ ok: false, stage: "loop", pages, totalFetched, totalUpserted, error: String(e) }, 200);
  }
});
