// ============================================================================
// amazon-pull-sales-traffic — Phase 1 of the Amazon FBA SP-API integration.
//
// Pulls ONE day of the Sales & Traffic report (Brand Analytics) at CHILD-ASIN
// granularity and ingests it into the sealed `amazon` schema via the
// amazon_ingest_sales_traffic RPC. This is the Brand-Analytics moment of truth:
// if the seller account has Selling Partner Insights / Brand Analytics access,
// the report returns ASIN-level rows; if not, it ends FATAL or returns zero ASIN
// rows (the response says which).
//
// SP-API flow: LWA refresh-token -> access token -> createReport -> poll
// getReport -> getReportDocument -> download (+ gunzip) -> JSON.parse -> RPC.
// No AWS IAM / SigV4 needed — just the x-amz-access-token header.
//
// Secrets (Edge Function vault only — never echoed, never committed):
//   SP_API_LWA_CLIENT_ID, SP_API_LWA_CLIENT_SECRET, SP_API_REFRESH_TOKEN
//   SP_API_REGION (default 'eu'), SP_API_MARKETPLACE_IDS (default UK)
//
// Body: { day?: "YYYY-MM-DD" (default yesterday UTC),
//         reportId?: string   (resume polling an already-created report),
//         pollSeconds?: number (poll budget, default 110, capped 130) }
//
// Auth: service-role key (for cron / ops) OR a valid authenticated user.
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
const REPORT_TYPE = "GET_SALES_AND_TRAFFIC_REPORT";

async function getLwaToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `LWA token exchange failed (${res.status}): ${await res.text()} — refresh token may be expired (~12mo), ` +
        `client id/secret mismatch, or the app lost a role (re-authorise the seller).`,
    );
  }
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
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function gunzipToText(buf: ArrayBuffer): Promise<string> {
  const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
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

  if (!clientId || !clientSecret || !refreshToken) {
    return json(
      { error: "SP-API secrets missing — need SP_API_LWA_CLIENT_ID, SP_API_LWA_CLIENT_SECRET, SP_API_REFRESH_TOKEN in the Edge Function vault." },
      500,
    );
  }
  const endpoint = ENDPOINTS[region] ?? ENDPOINTS.eu;

  // ---- Auth: service-role key OR a valid authenticated user ----------------
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  let authed = !!bearer && bearer === SERVICE_KEY;
  if (!authed && bearer) {
    const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data } = await uc.auth.getUser();
    authed = !!data?.user?.id;
  }
  if (!authed) return json({ error: "Unauthorized" }, 401);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // ---- Input ----------------------------------------------------------------
  let input: any = {};
  try {
    input = req.method === "POST" ? await req.json() : {};
  } catch {
    input = {};
  }
  const yref = new Date(Date.now() - 24 * 3600 * 1000);
  const day: string = /^\d{4}-\d{2}-\d{2}$/.test(input?.day) ? input.day : yref.toISOString().slice(0, 10);
  const dayStart = `${day}T00:00:00Z`;
  const dayEnd = `${day}T23:59:59Z`;
  const pollSeconds = Math.min(Number(input?.pollSeconds) > 0 ? Number(input.pollSeconds) : 110, 130);

  try {
    const token = await getLwaToken(clientId, clientSecret, refreshToken);

    // 1. Create (or resume an existing) report -------------------------------
    let reportId: string | undefined = typeof input?.reportId === "string" ? input.reportId : undefined;
    if (!reportId) {
      const create = await spFetch(endpoint, token, "POST", "/reports/2021-06-30/reports", {
        reportType: REPORT_TYPE,
        marketplaceIds: [marketplaceId],
        dataStartTime: dayStart,
        dataEndTime: dayEnd,
        reportOptions: { asinGranularity: "CHILD", dateGranularity: "DAY" },
      });
      if (!create.ok) {
        return json(
          { error: "createReport failed", status: create.status, detail: create.body, day, marketplaceId,
            hint: "A 403/Unauthorized here usually means the app lacks the Brand Analytics role for this report type." },
          502,
        );
      }
      reportId = create.body.reportId;
    }

    // 2. Poll until DONE / FATAL / out of budget -----------------------------
    const deadline = Date.now() + pollSeconds * 1000;
    let meta: any;
    let waitMs = 4000;
    while (true) {
      const got = await spFetch(endpoint, token, "GET", `/reports/2021-06-30/reports/${reportId}`);
      if (!got.ok) return json({ error: "getReport failed", status: got.status, detail: got.body, reportId }, 502);
      meta = got.body;
      const st = meta.processingStatus;
      if (st === "DONE") break;
      if (st === "CANCELLED" || st === "FATAL") {
        return json(
          { status: st, reportId, day, marketplaceId,
            brandAnalytics: "BLOCKED — report ended " + st,
            message:
              "For Sales & Traffic, FATAL/CANCELLED almost always means the seller account lacks Brand Analytics / " +
              "Selling Partner Insights access (or there is genuinely no data for the day). This is the moment-of-truth: " +
              "if it's an access problem we pivot Phase 1 to the Orders Report.",
            meta },
          200,
        );
      }
      if (Date.now() + waitMs > deadline) {
        return json(
          { status: "IN_PROGRESS", reportId, day,
            message: "Report still generating — re-invoke with { reportId, day } to resume polling (it keeps its place).",
            meta },
          200,
        );
      }
      await new Promise((r) => setTimeout(r, waitMs));
      waitMs = Math.min(Math.floor(waitMs * 1.4), 20000);
    }

    if (!meta.reportDocumentId) return json({ error: "Report DONE but no reportDocumentId", reportId, meta }, 502);

    // 3. Download + decompress the document ----------------------------------
    const doc = await spFetch(endpoint, token, "GET", `/reports/2021-06-30/documents/${meta.reportDocumentId}`);
    if (!doc.ok) return json({ error: "getReportDocument failed", status: doc.status, detail: doc.body }, 502);
    const dl = await fetch(doc.body.url);
    if (!dl.ok) return json({ error: "document download failed", status: dl.status }, 502);
    const ab = await dl.arrayBuffer();
    const rawText = doc.body.compressionAlgorithm === "GZIP" ? await gunzipToText(ab) : new TextDecoder().decode(ab);

    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      return json({ error: "report JSON parse failed", sample: rawText.slice(0, 500) }, 502);
    }
    const asinRows: unknown[] = payload.salesAndTrafficByAsin ?? [];

    // 4. Ingest via the SECURITY DEFINER RPC ---------------------------------
    const { data: ing, error: ingErr } = await supa.rpc("amazon_ingest_sales_traffic", {
      p_marketplace_id: marketplaceId,
      p_metric_date: day,
      p_report_id: reportId,
      p_document_id: meta.reportDocumentId,
      p_processing_status: meta.processingStatus,
      p_payload: payload,
    });
    if (ingErr) {
      return json({ error: "ingest RPC failed", detail: ingErr.message, day, asinRows: asinRows.length }, 500);
    }

    return json(
      {
        ok: true,
        day,
        marketplaceId,
        reportId,
        asinRows: asinRows.length,
        ingest: ing,
        brandAnalytics:
          asinRows.length > 0
            ? "OK — Brand Analytics returned ASIN-level data. Phase 1 is GO."
            : "Report DONE but ZERO ASIN rows — either no sales that day, or the account lacks Brand Analytics. Try a day you know had FBA sales before concluding.",
      },
      200,
    );
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), day }, 500);
  }
});
