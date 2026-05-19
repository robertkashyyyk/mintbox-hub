// Polls Mintsoft for ASNs created today with an OPEN status.
// Upserts SKU/qty rows into todays_open_asns. Removes rows whose ASN has
// since flipped to BOOKEDIN/RECEIVED/COMPLETE/CANCELLED (or whose creation
// date isn't today anymore). Used by get_buy_recommendations as an
// intraday overlay so the user doesn't get told to re-buy stock that's
// just been ordered in Mintsoft.
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

// Statuses we treat as "open" (stock not yet in StockLevel)
const OPEN_STATUS_TOKENS = ["AWAITINGDELIVERY", "AWAITING", "EXPECTED", "OPEN", "PARTIAL", "INTRANSIT", "IN_TRANSIT"];
// Statuses we treat as "closed" (Mintsoft has moved into StockLevel or scrapped it)
const CLOSED_STATUS_TOKENS = ["BOOKEDIN", "BOOKED_IN", "RECEIVED", "COMPLETE", "COMPLETED", "CLOSED", "CANCELLED", "CANCELED"];

const normaliseStatus = (s: unknown) =>
  typeof s === "string" ? s.toUpperCase().replace(/[\s_-]+/g, "") : "";

const isOpenStatus = (s: unknown) => {
  const n = normaliseStatus(s);
  if (!n) return true; // unknown → assume open, be safe
  if (CLOSED_STATUS_TOKENS.some((t) => n.includes(t.replace(/_/g, "")))) return false;
  return OPEN_STATUS_TOKENS.some((t) => n.includes(t.replace(/_/g, ""))) || true;
};
const isClosedStatus = (s: unknown) => {
  const n = normaliseStatus(s);
  return CLOSED_STATUS_TOKENS.some((t) => n.includes(t.replace(/_/g, "")));
};

interface MintsoftAsnItem {
  SKU?: string; Sku?: string; sku?: string;
  Quantity?: number; Qty?: number; QuantityExpected?: number; ExpectedQty?: number;
}
interface MintsoftAsn {
  ID?: number; Id?: number; ASNId?: number; AsnId?: number;
  POReference?: string; ASNReference?: string;
  Status?: string; ASNStatus?: string; AsnStatus?: string; StatusText?: string;
  Items?: MintsoftAsnItem[];
  ASNDate?: string; CreatedDate?: string; ReceivedDate?: string;
  Created?: string; DateCreated?: string; CreatedOn?: string;
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

    // today boundary (UK ≈ server) — keep midnight local
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const ymd = start.toISOString().slice(0, 10);

    // 1. Pull today's ASNs from Mintsoft
    const listCandidates = [
      `${baseUrl}/api/ASN/List?WarehouseId=5&FromDate=${ymd}&ToDate=${ymd}`,
      `${baseUrl}/api/ASN/List?WarehouseId=5`,
      `${baseUrl}/api/ASN/List`,
      `${baseUrl}/api/ASN?WarehouseId=5&FromDate=${ymd}&ToDate=${ymd}`,
      `${baseUrl}/api/ASN?WarehouseId=5`,
    ];

    let asns: MintsoftAsn[] = [];
    let chosenUrl = "";
    const attempts: Array<{ url: string; status: number; count: number }> = [];

    for (const url of listCandidates) {
      try {
        const r = await fetch(url, { headers: { "ms-apikey": apiKey, "Content-Type": "application/json" } });
        const text = r.ok ? await r.text() : "";
        let arr: any = null;
        try { arr = text ? JSON.parse(text) : null; } catch { /* */ }
        const list: MintsoftAsn[] = Array.isArray(arr)
          ? arr
          : Array.isArray(arr?.Items) ? arr.Items
          : Array.isArray(arr?.Results) ? arr.Results
          : Array.isArray(arr?.Data) ? arr.Data : [];
        attempts.push({ url, status: r.status, count: list.length });
        if (list.length) { asns = list; chosenUrl = url; break; }
      } catch (e) {
        attempts.push({ url, status: 0, count: 0 });
        console.log(`[todays-asn] probe threw ${url}: ${e}`);
      }
    }
    console.log(`[todays-asn] chose ${chosenUrl || "(none)"} — raw=${asns.length}`);

    const readDate = (a: Record<string, unknown>) => {
      const cands = [a.CreatedDate, a.Created, a.DateCreated, a.CreatedOn, a.ASNDate, a.Date];
      const m = cands.find((v) => typeof v === "string" && v);
      return typeof m === "string" ? m : null;
    };
    const readId = (a: Record<string, unknown>) => {
      const cands = [a.ID, a.Id, a.ASNId, a.AsnId];
      const m = cands.find((v) => typeof v === "number" && Number.isFinite(v));
      return typeof m === "number" ? m : null;
    };
    const readRef = (a: Record<string, unknown>) => {
      const cands = [a.POReference, a.ASNReference, (a as any).AsnReference];
      const m = cands.find((v) => typeof v === "string" && (v as string).trim());
      return typeof m === "string" ? m.trim() : "";
    };
    const readStatus = (a: Record<string, unknown>) =>
      String(a.Status || a.ASNStatus || (a as any).AsnStatus || a.StatusText || "");

    // 2. Filter: created TODAY, status OPEN
    if (asns.length) {
      const first = asns[0] as unknown as Record<string, unknown>;
      console.log(`[todays-asn] sample keys: ${Object.keys(first).join(",")}`);
      console.log(`[todays-asn] sample date=${readDate(first)} status=${readStatus(first)} id=${readId(first)}`);
    }
    const todayOpen = asns.filter((a) => {
      const row = a as unknown as Record<string, unknown>;
      const dStr = readDate(row);
      if (!dStr) return false;
      const t = new Date(dStr).getTime();
      if (!Number.isFinite(t) || t < startMs) return false;
      const status = readStatus(row);
      if (isClosedStatus(status)) return false;
      return isOpenStatus(status);
    });
    console.log(`[todays-asn] today+open: ${todayOpen.length}/${asns.length}`);

    // 3. Fetch lines for each ASN (some endpoints return headers only)
    type Row = { asn_id: number; sku: string; qty: number; status: string; asn_date: string | null; asn_reference: string };
    const rows: Row[] = [];
    const queue = [...todayOpen];

    const concurrency = 6;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const a = queue.shift()!;
        const row = a as unknown as Record<string, unknown>;
        const id = readId(row);
        if (!id) continue;
        const status = readStatus(row);
        const asnDate = readDate(row);
        const ref = readRef(row);

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
          if (!sku) continue;
          const qty = Number(it.Quantity ?? it.Qty ?? it.QuantityExpected ?? it.ExpectedQty ?? 0);
          if (!Number.isFinite(qty) || qty <= 0) continue;
          rows.push({ asn_id: id, sku, qty, status, asn_date: asnDate, asn_reference: ref });
        }
      }
    }));

    // 4. Wipe entire table and re-insert. Simpler than diff, and the table is
    //    small (a handful of ASNs per day). Anything that has flipped to
    //    BOOKEDIN, isn't from today, or is no longer returned by Mintsoft
    //    simply doesn't get re-inserted.
    const { error: delErr } = await supabase.from("todays_open_asns").delete().neq("asn_id", -1);
    if (delErr) {
      console.error("[todays-asn] delete error:", delErr.message);
      return json({ error: delErr.message }, 500);
    }

    if (rows.length) {
      // Aggregate duplicate (asn_id, sku) pairs so the PK doesn't blow up
      const agg = new Map<string, Row>();
      for (const r of rows) {
        const key = `${r.asn_id}::${r.sku}`;
        const cur = agg.get(key);
        if (cur) cur.qty += r.qty;
        else agg.set(key, { ...r });
      }
      const payload = Array.from(agg.values());
      const { error: insErr } = await supabase.from("todays_open_asns").insert(payload);
      if (insErr) {
        console.error("[todays-asn] insert error:", insErr.message);
        return json({ error: insErr.message }, 500);
      }
    }

    return json({
      success: true,
      asns_today_open: todayOpen.length,
      line_rows: rows.length,
      chosen_url: chosenUrl,
      attempts,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
