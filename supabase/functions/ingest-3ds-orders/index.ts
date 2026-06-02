// ingest-3ds-orders — pull 3D Sellers order transactions into
// public.threeds_order_transactions (the eBay listing source-of-truth).
//
// 3DS does NOT IP-block like Mintsoft, so this runs as an edge function.
// Cron-driven incremental keeps the table fresh; a one-off backfill mode
// pages deep across invocations.
//
// Auth: verify_jwt=false (see config.toml). Gated in-handler — either the
// service-role key (cron / server) or a super_user session may invoke.
//
// Body (all optional):
//   { mode?: "incremental" | "backfill",   // default "incremental"
//     maxPagesPerSeller?: number,           // default 5 (incremental) / 8 (backfill)
//     pageLimit?: number,                   // default 100
//     sellerIds?: number[] }                // restrict to specific sellers

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BASE_URL = (Deno.env.get("THREE_DS_BASE_URL") ?? "https://api.3dsellers.com").replace(/\/$/, "");
const API_KEY = Deno.env.get("THREEDS_API_KEY") ?? Deno.env.get("THREE_DS_API_KEY");

const TIME_BUDGET_MS = 110_000; // stay under the edge function wall-clock limit

// siteId → marketplace (eBay site ids). Extend as needed.
const SITE_MARKET: Record<string, string> = {
  "0": "US", "2": "CA", "3": "UK", "15": "AU", "77": "DE",
  "71": "FR", "101": "IT", "186": "ES", "205": "IE",
};
const CCY_MARKET: Record<string, string> = {
  GBP: "UK", EUR: "EU", USD: "US", AUD: "AU", CAD: "CA",
};

function tdsHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function tds(path: string): Promise<{ status: number; ok: boolean; json: any }> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: tdsHeaders() });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, ok: res.ok, json };
}

function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : null;
}

function marketplaceFor(seller: any): string | null {
  const site = pick(seller, "siteId", "site_id", "ebaySiteId");
  if (site != null && SITE_MARKET[String(site)]) return SITE_MARKET[String(site)];
  const ccy = pick<string>(seller, "currency", "currencyCode");
  if (ccy && CCY_MARKET[ccy]) return CCY_MARKET[ccy];
  const country = pick<string>(seller, "country", "countryCode", "marketplace");
  return country ? String(country).toUpperCase() : null;
}

// Map a 3DS order + transaction line into a threeds_order_transactions row.
function toRow(order: any, txn: any, seller: any, marketplace: string | null) {
  const sku = pick<string>(txn, "sku", "customLabel", "SKU") ?? null;
  if (!sku) return null;
  const transaction_id =
    pick<string>(txn, "orderLineItemId", "transactionId", "id") ??
    `${pick(order, "id", "orderId")}:${sku}:${pick(txn, "externalItemId", "itemId") ?? ""}`;
  const quantity = num(pick(txn, "quantity", "qty")) ?? 1;
  const price = num(pick(txn, "price", "lineTotal", "total"));
  const unit_price = price != null && quantity > 0 ? Math.round((price / quantity) * 10000) / 10000 : price;
  return {
    transaction_id: String(transaction_id),
    order_id: pick(order, "id", "orderId") != null ? String(pick(order, "id", "orderId")) : null,
    order_external_id: pick(order, "externalId", "externalOrderId") != null
      ? String(pick(order, "externalId", "externalOrderId")) : null,
    seller_id: num(pick(seller, "id", "sellerId")),
    channel: "ebay",
    store_name: pick<string>(seller, "name", "storeName", "store", "title") ?? null,
    store_url: pick<string>(order, "store.url") ?? pick<string>(order?.store, "url") ?? pick<string>(seller, "url", "storeUrl") ?? null,
    marketplace,
    sku,
    external_item_id: pick(txn, "externalItemId", "itemId", "ebayItemId") != null
      ? String(pick(txn, "externalItemId", "itemId", "ebayItemId")) : null,
    item_name: pick<string>(txn, "itemName", "title", "name") ?? null,
    item_url: pick<string>(txn, "itemUrl", "url") ?? null,
    price,
    quantity,
    unit_price,
    currency: pick<string>(txn, "currency", "currencyCode") ?? pick<string>(order, "currency") ?? null,
    final_value_fee: num(pick(txn, "finalValueFee", "fvf", "finalValueFeeAmount")),
    order_date: pick<string>(order, "orderDate", "createdAt", "date") ?? null,
    status: pick<string>(order, "status", "orderStatus") ?? null,
    cancel_status: pick<string>(order, "cancelStatus", "cancellationStatus") ?? null,
    raw: txn,
  };
}

function flattenOrders(orders: any[], seller: any, marketplace: string | null) {
  const rows: any[] = [];
  for (const order of orders) {
    const txns: any[] = pick(order, "transactions", "lineItems", "lines") ?? [];
    for (const txn of txns) {
      const row = toRow(order, txn, seller, marketplace);
      if (row) rows.push(row);
    }
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!API_KEY) return json({ error: "THREE_DS_API_KEY not configured" }, 500);

  // ---- Auth gate: service-role key (cron/server) OR a super_user session ----
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  let authorised = bearer.length > 0 && bearer === serviceKey;
  // Also accept any token whose JWT role claim is service_role (robust to key
  // rotation / legacy-vs-new key format mismatches between caller and runtime).
  if (!authorised && bearer) {
    try {
      const payload = JSON.parse(atob(bearer.split(".")[1] ?? ""));
      if (payload?.role === "service_role") authorised = true;
    } catch { /* not a JWT */ }
  }
  if (!authorised && bearer) {
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (userData?.user?.id) {
      const admin0 = createClient(url, serviceKey);
      const { data: roleRow } = await admin0
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user.id)
        .in("role", ["super_user", "senior_user"])
        .maybeSingle();
      authorised = !!roleRow;
    }
  }
  if (!authorised) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(url, serviceKey);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode: "incremental" | "backfill" = body.mode === "backfill" ? "backfill" : "incremental";
  const pageLimit = Math.min(Math.max(parseInt(body.pageLimit, 10) || 100, 10), 200);
  const maxPagesPerSeller = Math.min(
    Math.max(parseInt(body.maxPagesPerSeller, 10) || (mode === "backfill" ? 8 : 5), 1),
    50,
  );
  const restrictSellers: number[] | null = Array.isArray(body.sellerIds)
    ? body.sellerIds.map((n: any) => Number(n)).filter((n: number) => isFinite(n))
    : null;
  // Optional: stop backfilling a seller once we page past this many days of
  // history (orders come newest-first). The listings view only uses 90 days,
  // so a modest cutoff keeps the backfill bounded. null = no cutoff (full).
  const sinceDays: number | null =
    Number.isFinite(parseInt(body.sinceDays, 10)) ? parseInt(body.sinceDays, 10) : null;
  const cutoffMs = sinceDays != null ? Date.now() - sinceDays * 86_400_000 : null;

  const startedAt = Date.now();
  const timeLeft = () => TIME_BUDGET_MS - (Date.now() - startedAt);

  // ---- List eBay sellers ----
  const sellersRes = await tds("/v1/sellers?channel=ebay");
  if (!sellersRes.ok) {
    return json({ error: "Failed to list sellers", status: sellersRes.status, body: sellersRes.json }, 502);
  }
  let sellers: any[] = sellersRes.json?.data ?? sellersRes.json ?? [];
  if (!Array.isArray(sellers)) sellers = [];
  if (restrictSellers) {
    sellers = sellers.filter((s) => restrictSellers.includes(Number(pick(s, "id", "sellerId"))));
  }

  const summary: any[] = [];
  let totalUpserted = 0;

  for (const seller of sellers) {
    if (timeLeft() < 5_000) { summary.push({ note: "time budget reached, stopping early" }); break; }

    const sellerId = Number(pick(seller, "id", "sellerId"));
    if (!isFinite(sellerId)) continue;
    const marketplace = marketplaceFor(seller);
    const storeName = pick<string>(seller, "name", "storeName", "store", "title") ?? null;

    // Load (or seed) ingest state for this seller.
    const { data: state } = await admin
      .from("threeds_ingest_state")
      .select("*")
      .eq("seller_id", sellerId)
      .maybeSingle();

    // In backfill mode, skip sellers whose backfill is already complete so
    // repeated backfill calls naturally wind down to zero work.
    if (mode === "backfill" && state?.backfill_done) {
      summary.push({ seller_id: sellerId, store_name: storeName, marketplace, skipped: "backfill done" });
      continue;
    }

    let page = mode === "backfill" ? (state?.backfill_next_page ?? 1) : 1;
    let sellerUpserted = 0;
    let pagesThisRun = 0;
    let reportedTotal: number | null = state?.reported_total ?? null;
    let backfillDone = state?.backfill_done ?? false;
    let maxDateSeen: string | null = null;
    let stopReason = "max pages";

    while (pagesThisRun < maxPagesPerSeller) {
      if (timeLeft() < 5_000) { stopReason = "time budget"; break; }

      const res = await tds(`/v1/orders?sellerId=${sellerId}&channel=ebay&page=${page}&limit=${pageLimit}`);
      if (!res.ok) { stopReason = `orders error ${res.status}`; break; }
      const orders: any[] = res.json?.data ?? [];
      reportedTotal = res.json?.metadata?.total ?? reportedTotal;
      pagesThisRun++;

      if (orders.length === 0) {
        if (mode === "backfill") { backfillDone = true; page = 1; }
        stopReason = "no more orders";
        break;
      }

      const rows = flattenOrders(orders, seller, marketplace);
      let oldestMs = Infinity;
      for (const r of rows) {
        if (r.order_date && (!maxDateSeen || r.order_date > maxDateSeen)) maxDateSeen = r.order_date;
        if (r.order_date) {
          const t = Date.parse(r.order_date);
          if (isFinite(t) && t < oldestMs) oldestMs = t;
        }
      }
      const pastCutoff = cutoffMs != null && isFinite(oldestMs) && oldestMs < cutoffMs;

      // How many of these are new? (for the incremental short-circuit)
      const ids = rows.map((r) => r.transaction_id);
      let existingCount = 0;
      if (ids.length) {
        const { data: existing } = await admin
          .from("threeds_order_transactions")
          .select("transaction_id")
          .in("transaction_id", ids);
        existingCount = existing?.length ?? 0;
      }
      const newCount = ids.length - existingCount;

      if (rows.length) {
        const { error: upErr } = await admin
          .from("threeds_order_transactions")
          .upsert(rows, { onConflict: "transaction_id" });
        if (upErr) { stopReason = `upsert error: ${upErr.message}`; break; }
        sellerUpserted += rows.length;
      }

      // Incremental: once a full page is entirely already-seen, we're caught up.
      if (mode === "incremental" && newCount === 0) { stopReason = "caught up"; break; }
      // Reached the history cutoff — we've covered the window we care about.
      if (pastCutoff) {
        if (mode === "backfill") { backfillDone = true; page = 1; }
        stopReason = "reached cutoff";
        break;
      }
      // Backfill: short page means end of data.
      if (orders.length < pageLimit) {
        if (mode === "backfill") { backfillDone = true; page = 1; }
        stopReason = "last page";
        break;
      }
      page++;
    }

    totalUpserted += sellerUpserted;

    // Persist state.
    const nextPage = mode === "backfill" ? (backfillDone ? 1 : page) : 1;
    await admin.from("threeds_ingest_state").upsert(
      {
        seller_id: sellerId,
        store_name: storeName,
        marketplace,
        channel: "ebay",
        backfill_done: backfillDone,
        backfill_next_page: nextPage,
        reported_total: reportedTotal,
        last_run_at: new Date().toISOString(),
        last_new_rows: sellerUpserted,
        last_seen_max_date: maxDateSeen,
      },
      { onConflict: "seller_id" },
    );

    summary.push({
      seller_id: sellerId,
      store_name: storeName,
      marketplace,
      pages: pagesThisRun,
      upserted: sellerUpserted,
      reported_total: reportedTotal,
      backfill_done: backfillDone,
      stop: stopReason,
    });
  }

  return json({
    ok: true,
    mode,
    sellers: sellers.length,
    total_upserted: totalUpserted,
    elapsed_ms: Date.now() - startedAt,
    summary,
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
