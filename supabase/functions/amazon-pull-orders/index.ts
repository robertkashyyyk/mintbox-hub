// ============================================================================
// amazon-pull-orders — Phase 2a. Pulls the all-orders flat-file report
// (GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL) for a window keyed by
// last-updated, parses the TSV, and upserts amazon.orders + amazon.order_items
// via amazon_ingest_orders. Order-level fields are deduped here (one row per
// order×sku in the flat file); order_item_id is synthesised from sku in the RPC.
//
// SP-API flow mirrors amazon-pull-sales-traffic. Resumable via { reportId }.
//
// Body: { start?: "YYYY-MM-DD", end?: "YYYY-MM-DD" (default last 7 days, UTC),
//         reportId?: string, pollSeconds?: number }
// Auth: service-role JWT (cron/ops) OR a valid authenticated user.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";
const ENDPOINTS: Record<string, string> = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};
const UK_MARKETPLACE = "A1F83G8C2ARO7P";
const REPORT_TYPE = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_LAST_UPDATE_GENERAL";

async function getLwaToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  if (!res.ok) throw new Error(`LWA token exchange failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token as string;
}

async function spFetch(endpoint: string, token: string, method: string, path: string, body?: unknown) {
  const res = await fetch(endpoint + path, {
    method,
    headers: { "x-amz-access-token": token, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function gunzipToText(buf: ArrayBuffer): Promise<string> {
  const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}

function jwtRole(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role ?? null;
  } catch { return null; }
}

function parseTsv(raw: string): Array<Record<string, string>> {
  const lines = raw.replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t").map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split("\t");
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = (cells[j] ?? "").trim();
    out.push(row);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const clientId = Deno.env.get("SP_API_LWA_CLIENT_ID");
  const clientSecret = Deno.env.get("SP_API_LWA_CLIENT_SECRET");
  const refreshToken = Deno.env.get("SP_API_REFRESH_TOKEN");
  const region = (Deno.env.get("SP_API_REGION") || "eu").toLowerCase();
  const marketplaceId = (Deno.env.get("SP_API_MARKETPLACE_IDS") || UK_MARKETPLACE).split(",")[0].trim();
  if (!clientId || !clientSecret || !refreshToken) return json({ error: "SP-API secrets missing" }, 500);
  const endpoint = ENDPOINTS[region] ?? ENDPOINTS.eu;

  // ---- Auth ----------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  let authed = !!bearer && bearer === SERVICE_KEY;
  if (!authed && bearer) {
    const role = jwtRole(bearer);
    if (role === "service_role") authed = true;
    else if (role === "authenticated") {
      const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data } = await uc.auth.getUser();
      authed = !!data?.user?.id;
    }
  }
  if (!authed) return json({ error: "Unauthorized" }, 401);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- Input / window ------------------------------------------------------
  let input: any = {};
  try { input = req.method === "POST" ? await req.json() : {}; } catch { input = {}; }
  const now = new Date();
  const dayMs = 24 * 3600 * 1000;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(input?.end) ? `${input.end}T23:59:59Z` : now.toISOString();
  const start = /^\d{4}-\d{2}-\d{2}$/.test(input?.start)
    ? `${input.start}T00:00:00Z`
    : new Date(now.getTime() - 7 * dayMs).toISOString();
  const pollSeconds = Math.min(Number(input?.pollSeconds) > 0 ? Number(input.pollSeconds) : 110, 130);

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);

    // 1. Create or resume report --------------------------------------------
    let reportId: string | undefined = typeof input?.reportId === "string" ? input.reportId : undefined;
    if (!reportId) {
      const create = await spFetch(endpoint, token, "POST", "/reports/2021-06-30/reports", {
        reportType: REPORT_TYPE,
        marketplaceIds: [marketplaceId],
        dataStartTime: start,
        dataEndTime: end,
      });
      if (!create.ok) return json({ error: "createReport failed", status: create.status, detail: create.body, start, end }, 502);
      reportId = create.body.reportId;
    }

    // 2. Poll ----------------------------------------------------------------
    const deadline = Date.now() + pollSeconds * 1000;
    let meta: any;
    let waitMs = 4000;
    while (true) {
      const got = await spFetch(endpoint, token, "GET", `/reports/2021-06-30/reports/${reportId}`);
      if (!got.ok) return json({ error: "getReport failed", status: got.status, detail: got.body, reportId }, 502);
      meta = got.body;
      if (meta.processingStatus === "DONE") break;
      if (meta.processingStatus === "CANCELLED" || meta.processingStatus === "FATAL") {
        return json({ status: meta.processingStatus, reportId, start, end, message: "Orders report ended " + meta.processingStatus, meta }, 200);
      }
      if (Date.now() + waitMs > deadline) {
        return json({ status: "IN_PROGRESS", reportId, start, end, message: "Re-invoke with { reportId } to resume.", meta }, 200);
      }
      await new Promise((r) => setTimeout(r, waitMs));
      waitMs = Math.min(Math.floor(waitMs * 1.4), 20000);
    }
    if (!meta.reportDocumentId) return json({ error: "DONE but no reportDocumentId", reportId, meta }, 502);

    // 3. Download + parse TSV ------------------------------------------------
    const doc = await spFetch(endpoint, token, "GET", `/reports/2021-06-30/documents/${meta.reportDocumentId}`);
    if (!doc.ok) return json({ error: "getReportDocument failed", status: doc.status, detail: doc.body }, 502);
    const dl = await fetch(doc.body.url);
    if (!dl.ok) return json({ error: "document download failed", status: dl.status }, 502);
    const ab = await dl.arrayBuffer();
    const rawText = doc.body.compressionAlgorithm === "GZIP" ? await gunzipToText(ab) : new TextDecoder().decode(ab);
    const rows = parseTsv(rawText);

    // 4. Map -> clean order + item arrays -----------------------------------
    const ordersById = new Map<string, any>();
    const items: any[] = [];
    for (const r of rows) {
      const oid = r["amazon-order-id"];
      if (!oid) continue;
      if (!ordersById.has(oid)) {
        ordersById.set(oid, {
          amazon_order_id: oid,
          merchant_order_id: r["merchant-order-id"] ?? "",
          purchase_date: r["purchase-date"] ?? "",
          last_updated_date: r["last-updated-date"] ?? "",
          order_status: r["order-status"] ?? "",
          fulfillment_channel: r["fulfillment-channel"] ?? "",
          sales_channel: r["sales-channel"] ?? "",
          ship_service_level: r["ship-service-level"] ?? "",
          is_business_order: r["is-business-order"] ?? "",
          ship_country: r["ship-country"] ?? "",
          ship_postal_code: r["ship-postal-code"] ?? "",
        });
      }
      items.push({
        amazon_order_id: oid,
        order_item_id: r["order-item-id"] ?? "",
        asin: r["asin"] ?? "",
        sku: r["sku"] ?? "",
        product_name: r["product-name"] ?? "",
        quantity: r["quantity"] ?? "0",
        quantity_shipped: r["quantity-shipped"] ?? "0",
        item_price: r["item-price"] ?? "",
        item_tax: r["item-tax"] ?? "",
        shipping_price: r["shipping-price"] ?? "",
        item_promotion_discount: r["item-promotion-discount"] ?? "",
        currency_code: r["currency"] ?? "",
      });
    }
    const orders = Array.from(ordersById.values());

    // 5. Ingest --------------------------------------------------------------
    const { data: ing, error: ingErr } = await supa.rpc("amazon_ingest_orders", {
      p_marketplace_id: marketplaceId,
      p_window_start: start,
      p_window_end: end,
      p_report_id: reportId,
      p_document_id: meta.reportDocumentId,
      p_processing_status: meta.processingStatus,
      p_orders: orders,
      p_items: items,
    });
    if (ingErr) return json({ error: "ingest RPC failed", detail: ingErr.message, orders: orders.length, items: items.length }, 500);

    return json({ ok: true, start, end, reportId, tsvRows: rows.length, orders: orders.length, items: items.length, ingest: ing }, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), start, end }, 500);
  }
});
