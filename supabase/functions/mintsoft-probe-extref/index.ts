// Read-only probe: does Mintsoft's Order payload carry an ExternalReference /
// ExternalId / ChannelOrderReference that equals the 3D Sellers externalId
// (e.g. eBay order ID like 06-14669-20984)?
//
// Pulls the most-recent ~200 orders from Mintsoft across all statuses,
// scans every top-level field that looks like a marketplace reference, and
// reports per-channel:
//   - what % of orders have a non-empty value in each candidate field
//   - 5 redacted samples per channel showing the actual values

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANDIDATE_FIELDS = [
  "ExternalReference", "ExternalId", "ExternalID",
  "ChannelOrderReference", "ChannelOrderRef",
  "OrderNumber", "OrderRef", "OrderReference",
  "Source", "ChannelName", "Channel",
  "MarketplaceOrderId", "MarketplaceReference",
  "ExternalOrderReference", "ExternalSource", "ExternalSourceReference",
];

function classifyPattern(v: unknown): string {
  if (typeof v !== "string" || !v) return "empty";
  if (/^\d{2}-\d{5}-\d{5}$/.test(v)) return "ebay_order_id";
  if (/^\d{3}-\d{7}-\d{7}$/.test(v)) return "amazon_order_id";
  if (/^[A-Z0-9-]{8,}$/.test(v)) return "alphanum_ref";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("MINTSOFT_API_KEY missing");
    const baseUrl = "https://api.mintsoft.co.uk";

    // Get statuses, then pull recent orders across active + a couple of terminal
    // statuses to cover a representative slice.
    const statusResp = await fetch(`${baseUrl}/api/Order/Statuses`, {
      headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
    });
    const statuses = statusResp.ok ? await statusResp.json() : [];

    // Pick a sensible cross-section: a few hot + terminal statuses, newest first.
    const wantedNames = ["dispatched", "despatched", "new", "awaitingpicking", "onbackorder"];
    const targetStatusIds: { id: number; name: string }[] = [];
    for (const s of statuses) {
      const nm = String(s.ExternalName || s.Name || "").toLowerCase().replace(/\s+/g, "");
      if (wantedNames.some((w) => nm.includes(w))) targetStatusIds.push({ id: s.ID, name: s.ExternalName || s.Name });
    }

    const orders: Array<Record<string, unknown>> = [];
    for (const st of targetStatusIds) {
      if (orders.length >= 200) break;
      // Mintsoft limit is 100 per page
      for (let page = 1; page <= 3 && orders.length < 200; page++) {
        const url = `${baseUrl}/api/Order/List?OrderStatusId=${st.id}&PageNo=${page}&Limit=100`;
        const r = await fetch(url, {
          headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
        });
        if (!r.ok) break;
        const batch = await r.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const o of batch) orders.push(o);
        if (batch.length < 100) break;
      }
    }

    // Limit to 200 newest by OrderDate
    orders.sort((a, b) => String(b.OrderDate || "").localeCompare(String(a.OrderDate || "")));
    const sample = orders.slice(0, 200);

    // Stats: for each candidate field, count populated + pattern breakdown
    const fieldStats: Record<string, Record<string, number>> = {};
    for (const f of CANDIDATE_FIELDS) fieldStats[f] = { total: 0, populated: 0 };

    // Per-channel samples + per-channel populated %
    const byChannel: Record<string, {
      total: number;
      field_populated: Record<string, number>;
      pattern_counts: Record<string, number>;
      samples: Array<Record<string, unknown>>;
    }> = {};

    // Discover any extra fields that look like a marketplace ref but aren't in the candidate list
    const undiscoveredFields = new Set<string>();
    const firstOrderKeys = sample[0] ? Object.keys(sample[0]) : [];
    for (const k of firstOrderKeys) {
      if (CANDIDATE_FIELDS.includes(k)) continue;
      if (/ref|external|channel|source|order/i.test(k) && /^[A-Za-z]/.test(k)) {
        undiscoveredFields.add(k);
      }
    }

    for (const o of sample) {
      const channel = String(o.Source ?? o.ChannelName ?? o.Channel ?? "Unknown");
      if (!byChannel[channel]) {
        byChannel[channel] = {
          total: 0,
          field_populated: Object.fromEntries(CANDIDATE_FIELDS.map((f) => [f, 0])),
          pattern_counts: {},
          samples: [],
        };
      }
      byChannel[channel].total++;

      for (const f of CANDIDATE_FIELDS) {
        fieldStats[f].total++;
        const v = (o as Record<string, unknown>)[f];
        if (v != null && v !== "") {
          fieldStats[f].populated++;
          byChannel[channel].field_populated[f]++;
        }
      }

      // Pattern on the leading-candidate "ExternalReference"
      const ext = (o as Record<string, unknown>).ExternalReference ?? (o as Record<string, unknown>).ExternalId;
      const p = classifyPattern(ext);
      byChannel[channel].pattern_counts[p] = (byChannel[channel].pattern_counts[p] || 0) + 1;

      // Keep up to 5 samples per channel with only the join-key fields, lightly redacted
      if (byChannel[channel].samples.length < 5) {
        const obj: Record<string, unknown> = {
          ID: o.ID,
          OrderNumber: o.OrderNumber,
          OrderDate: o.OrderDate,
          Source: o.Source,
          ChannelName: o.ChannelName,
          Channel: o.Channel,
        };
        for (const f of CANDIDATE_FIELDS) {
          if ((o as Record<string, unknown>)[f] != null) obj[f] = (o as Record<string, unknown>)[f];
        }
        byChannel[channel].samples.push(obj);
      }
    }

    return new Response(
      JSON.stringify({
        scanned_orders: sample.length,
        statuses_pulled: targetStatusIds.map((s) => s.name),
        candidate_field_stats: fieldStats,
        per_channel: byChannel,
        undiscovered_ref_like_fields: Array.from(undiscoveredFields),
        first_order_all_keys: firstOrderKeys,
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
