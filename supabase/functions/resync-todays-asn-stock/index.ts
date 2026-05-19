// Pulls today's ASNs from Mintsoft, unions their SKUs with SKUs from
// purchase_orders created/sent today inside this app, then invokes
// sync-mintsoft-stock to refresh stock for that union.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface MintsoftAsnItem { SKU?: string; Sku?: string; sku?: string }
interface MintsoftAsn {
  ID?: number;
  Id?: number;
  ASNId?: number;
  AsnId?: number;
  POReference?: string;
  ASNReference?: string;
  Sku?: string;
  SKU?: string;
  sku?: string;
  ProductCode?: string;
  ProductSKU?: string;
  ProductSku?: string;
  StockCode?: string;
  ItemSKU?: string;
  ItemSku?: string;
  Items?: MintsoftAsnItem[];
  ASNDate?: string;
  CreatedDate?: string;
  ReceivedDate?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) return json({ error: "MINTSOFT_API_KEY not configured" }, 500);

    const { data: settings } = await supabase
      .from("mintsoft_settings").select("base_url").maybeSingle();
    const baseUrl = settings?.base_url || "https://api.mintsoft.co.uk";

    // -- today boundaries (UK)
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startIso = start.toISOString();
    const ymd = start.toISOString().slice(0, 10);

    // -- 1. SKUs from our own POs touched today
    const localSkus = new Set<string>();
    let localPoCount = 0;
    {
      const { data: posToday } = await supabase
        .from("purchase_orders").select("id")
        .or(`sent_at.gte.${startIso},created_at.gte.${startIso}`);
      const poIds = (posToday || []).map((p: any) => p.id);
      localPoCount = poIds.length;
      if (poIds.length) {
        const { data: lines } = await supabase
          .from("purchase_order_lines").select("sku").in("po_id", poIds);
        for (const l of lines || []) if (l.sku) localSkus.add(l.sku);
      }
    }

    // -- 2. ASNs from Mintsoft for today
    // Mintsoft's ASN list endpoint variants we'll attempt in order. The actual
    // tenant may only expose one; the first that returns rows wins.
    const mintsoftSkus = new Set<string>();
    const attempts: Array<{ url: string; status: number; count: number; sample?: string }> = [];
    let asnSummaries: Array<{ id: number; date: string | null; itemCount: number }> = [];

    const listCandidates = [
      `${baseUrl}/api/ASN/List?WarehouseId=5&FromDate=${ymd}&ToDate=${ymd}`,
      `${baseUrl}/api/ASN/List?WarehouseId=5`,
      `${baseUrl}/api/ASN/List`,
      `${baseUrl}/api/ASN?WarehouseId=5&FromDate=${ymd}&ToDate=${ymd}`,
      `${baseUrl}/api/ASN?WarehouseId=5`,
      `${baseUrl}/api/ASN`,
      `${baseUrl}/api/PurchaseOrder/List?WarehouseId=5`,
      `${baseUrl}/api/PurchaseOrder?WarehouseId=5`,
    ];

    let asns: MintsoftAsn[] = [];
    let chosenUrl = "";
    for (const url of listCandidates) {
      try {
        const r = await fetch(url, { headers: { "ms-apikey": apiKey, "Content-Type": "application/json" } });
        const text = r.ok ? await r.text() : "";
        let arr: any = null;
        try { arr = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
        const list: MintsoftAsn[] = Array.isArray(arr)
          ? arr
          : Array.isArray(arr?.Items) ? arr.Items
          : Array.isArray(arr?.Results) ? arr.Results
          : Array.isArray(arr?.Data) ? arr.Data
          : [];
        const sample = text ? text.slice(0, 200) : "";
        attempts.push({ url, status: r.status, count: list.length, sample });
        console.log(`[ASN-probe] ${r.status} count=${list.length} url=${url}`);
        if (sample && list.length === 0) console.log(`[ASN-probe] body sample: ${sample}`);
        if (list.length) { asns = list; chosenUrl = url; break; }
      } catch (e) {
        attempts.push({ url, status: 0, count: 0, sample: String(e).slice(0, 200) });
        console.log(`[ASN-probe] threw url=${url}: ${e}`);
      }
    }
    console.log(`[ASN-probe] chose: ${chosenUrl || "(none)"} — raw asns: ${asns.length}`);
    if (asns.length) {
      console.log(`[ASN-probe] first row keys: ${Object.keys((asns[0] as Record<string, unknown>) || {}).join(",")}`);
    }

    // Filter to today (UK-local) only when the chosen endpoint was not already
    // explicitly date-scoped. Some Mintsoft tenants return differently-shaped rows
    // (e.g. `Created`, `DateCreated`) and the previous narrow filter dropped valid ASNs.
    const readAsnDate = (a?: Record<string, unknown>) => {
      if (!a) return null;
      const candidates = [
        a.CreatedDate,
        a.ASNDate,
        a.ReceivedDate,
        a.Created,
        a.DateCreated,
        a.CreatedOn,
        a.ReceivedOn,
        a.Date,
      ];
      const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
      return typeof match === "string" ? match : null;
    };
    const isToday = (d?: string | null) => {
      if (!d) return false;
      const t = new Date(d);
      return Number.isFinite(t.getTime()) && t >= start;
    };
    const beforeFilter = asns.length;
    const firstRawAsn = asns[0] as Record<string, unknown> | undefined;
    const hasExplicitTodayWindow = /[?&]FromDate=\d{4}-\d{2}-\d{2}/.test(chosenUrl)
      && /[?&]ToDate=\d{4}-\d{2}-\d{2}/.test(chosenUrl);
    if (!hasExplicitTodayWindow) {
      asns = asns.filter((a) => isToday(readAsnDate(a as unknown as Record<string, unknown>)));
    }
    console.log(
      `[ASN-probe] after today filter: ${asns.length} (was ${beforeFilter})${hasExplicitTodayWindow ? " — trusted upstream date filter" : ""}`,
    );
    if (beforeFilter > 0 && asns.length === 0) {
      console.log(
        `[ASN-probe] first row keys for debug: ${Object.keys(firstRawAsn || {}).join(",")}; date=${readAsnDate(firstRawAsn) || "(none)"}`,
      );
    }

    const readDirectSku = (row?: Record<string, unknown>) => {
      if (!row) return "";
      const candidates = [row.SKU, row.Sku, row.sku, row.ProductSKU, row.ProductSku, row.ProductCode, row.StockCode, row.ItemSKU, row.ItemSku];
      const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
      return typeof match === "string" ? match.trim() : "";
    };
    const readAsnId = (row?: Record<string, unknown>) => {
      if (!row) return null;
      const candidates = [row.ID, row.Id, row.ASNId, row.AsnId];
      const match = candidates.find((value) => typeof value === "number" && Number.isFinite(value));
      return typeof match === "number" ? match : null;
    };
    const readAsnRef = (row?: Record<string, unknown>) => {
      if (!row) return "";
      const candidates = [row.POReference, row.ASNReference, row.AsnReference];
      const match = candidates.find((value) => typeof value === "string" && value.trim().length > 0);
      return typeof match === "string" ? match.trim() : "";
    };
    const summaryMap = new Map<string, { id: number; date: string | null; itemCount: number }>();

    // Some list endpoints return flattened ASN line rows instead of ASN headers.
    // Harvest direct SKUs first so we only fetch detail for rows that truly need it.
    const queue = [...asns.filter((a) => {
      const row = a as unknown as Record<string, unknown>;
      const directSku = readDirectSku(row);
      const ref = readAsnRef(row);
      const id = readAsnId(row);
      if (directSku) {
        mintsoftSkus.add(directSku);
        const key = String(id ?? ref ?? directSku);
        const existing = summaryMap.get(key);
        summaryMap.set(key, {
          id: id ?? existing?.id ?? 0,
          date: readAsnDate(row),
          itemCount: (existing?.itemCount ?? 0) + 1,
        });
        return false;
      }
      return true;
    })];

    // For header-style rows without embedded SKUs, fetch per-ASN detail.
    // Concurrency 6 keeps total time low.
    const concurrency = 6;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const a = queue.shift()!;
        const row = a as unknown as Record<string, unknown>;
        const id = readAsnId(row);
        if (!id) continue;
        let items: MintsoftAsnItem[] = a.Items || [];
        if (!items.length) {
          try {
            const r = await fetch(`${baseUrl}/api/ASN/${id}`, {
              headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
            });
            if (r.ok) {
              const detail = await r.json();
              items = detail?.Items || detail?.ASNItems || detail?.AsnItems || [];
            }
          } catch (_) {}
        }
        for (const it of items) {
          const sku = (it.SKU || it.Sku || it.sku || "").trim();
          if (sku) mintsoftSkus.add(sku);
        }
        summaryMap.set(String(id), { id, date: readAsnDate(row), itemCount: items.length });
      }
    }));
    asnSummaries = Array.from(summaryMap.values());

    // -- 3. Union & resync
    const union = new Set<string>([...localSkus, ...mintsoftSkus]);
    const skus = Array.from(union);

    if (skus.length === 0) {
      return json({
        success: true,
        message: "No ASN activity found today (local or Mintsoft).",
        local_po_count: localPoCount,
        local_skus: 0,
        mintsoft_asn_count: asnSummaries.length,
        mintsoft_skus: 0,
        attempts,
      });
    }

    const chunkSize = 75;
    const syncChunks: string[][] = [];
    for (let i = 0; i < skus.length; i += chunkSize) syncChunks.push(skus.slice(i, i + chunkSize));

    const runBackgroundSync = async () => {
      const batchResults: Array<{ size: number; updated: number; total: number; error?: string }> = [];
      const batchConcurrency = Math.min(2, syncChunks.length);
      let chunkIdx = 0;

      await Promise.all(Array.from({ length: batchConcurrency }, async () => {
        while (true) {
          const i = chunkIdx++;
          if (i >= syncChunks.length) return;
          const chunk = syncChunks[i];
          const { data, error } = await supabase.functions.invoke("sync-mintsoft-stock", { body: { skus: chunk } });
          if (error) {
            console.error(`[ASN-probe] stock sync batch ${i + 1}/${syncChunks.length} failed: ${error.message}`);
            batchResults.push({ size: chunk.length, updated: 0, total: chunk.length, error: error.message });
            continue;
          }

          const result = (data || {}) as { updated?: number; total?: number; error?: string };
          batchResults.push({
            size: chunk.length,
            updated: Number(result.updated ?? 0),
            total: Number(result.total ?? chunk.length),
            error: result.error,
          });
        }
      }));

      const failedBatches = batchResults.filter((r) => r.error);
      const updatedTotal = batchResults.reduce((sum, r) => sum + (r.updated || 0), 0);
      console.log(
        `[ASN-probe] background sync complete: updated=${updatedTotal} batches=${syncChunks.length} failed=${failedBatches.length}`,
      );
    };

    // @ts-ignore - EdgeRuntime is provided by the edge runtime
    EdgeRuntime.waitUntil(runBackgroundSync());

    return json({
      success: true,
      queued: true,
      message: `Queued stock refresh for ${skus.length} SKU${skus.length === 1 ? "" : "s"}.`,
      local_po_count: localPoCount,
      local_skus: localSkus.size,
      mintsoft_asn_count: asnSummaries.length,
      mintsoft_skus: mintsoftSkus.size,
      union_skus: skus.length,
      batch_count: syncChunks.length,
      asns: asnSummaries,
      attempts,
      chosen_url: chosenUrl,
    }, 202);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
