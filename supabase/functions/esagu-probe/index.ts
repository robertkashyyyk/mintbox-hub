// ============================================================================
// esagu-probe — Phase 1 read-only discovery for Amazon repricing via eSagu.
// Confirms the token works, eSagu is reachable from edge, gauges catalog
// coverage (how many repricing items eSagu holds for us), and returns the raw
// item shape so we can design the SKU↔itemId mirror. Writes NOTHING.
//
// eSagu REST API: base https://api.esagu.de/amzn/repricing/v1
//   GET /item  — list repricing items (max 100/page; paginate by-id-greater-than)
//   Auth: Authorization: Bearer <ESAGU_JWT>.  Rate limit ~120/hr.
//
// Body: { limit?: number (<=100, default 100), byIdGreaterThan?: number }
// Auth: service-role JWT (ops) or a valid authenticated user (gateway verify_jwt).
// ============================================================================

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const ESAGU_BASE = "https://api.esagu.de/amzn/repricing/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const jwt = Deno.env.get("ESAGU_JWT");
  const key = Deno.env.get("ESAGU_KEY");
  if (!jwt && !key) return json({ ok: false, error: "Neither ESAGU_JWT nor ESAGU_KEY is set in the vault." }, 500);

  let limit = 100, byIdGreaterThan: number | undefined;
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.limit) limit = Math.min(100, Math.max(1, Number(body.limit)));
    if (body.byIdGreaterThan != null) byIdGreaterThan = Number(body.byIdGreaterThan);
  } catch { /* defaults */ }

  const url = new URL(`${ESAGU_BASE}/item`);
  url.searchParams.set("limit", String(limit));
  if (byIdGreaterThan != null) url.searchParams.set("by-id-greater-than", String(byIdGreaterThan));

  // Structure metadata for each secret (no values exposed) so we can see which
  // one is actually a JWT (eyJ…eyJ…sig = exactly 2 dots).
  const shape = (name: string, v?: string) =>
    v ? { name, len: v.length, dots: (v.match(/\./g) || []).length, prefix: v.slice(0, 3), looksLikeJwt: v.startsWith("eyJ") && (v.match(/\./g) || []).length === 2 }
      : { name, present: false };
  const secretShapes = [shape("ESAGU_JWT", jwt), shape("ESAGU_KEY", key)];

  // Try BOTH secrets as the bearer; report each outcome; return first success.
  const attempts: Array<{ label: string; token: string }> = [];
  if (jwt) attempts.push({ label: "ESAGU_JWT", token: jwt });
  if (key && key !== jwt) attempts.push({ label: "ESAGU_KEY", token: key });

  const results: any[] = [];
  for (const attempt of attempts) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${attempt.token}`, Accept: "application/json" } });
    } catch (e) {
      results.push({ usedSecret: attempt.label, stage: "fetch", error: String(e) });
      continue;
    }
    const rate = { limit: res.headers.get("X-RateLimit-Limit"), remaining: res.headers.get("X-RateLimit-Remaining") };
    const text = await res.text();
    let payload: any;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 400) }; }

    if (res.ok) {
      const items: any[] = Array.isArray(payload) ? payload : (payload?.items ?? payload?.content ?? []);
      const first = items[0] ?? null;
      return json({
        ok: true, usedSecret: attempt.label, status: res.status, rate, secretShapes,
        pageSize: limit, itemsOnPage: items.length, moreLikely: items.length >= limit,
        fieldShape: first ? Object.keys(first) : [], sample: items.slice(0, 2),
        note: "read-only probe; nothing written.",
      });
    }
    results.push({ usedSecret: attempt.label, status: res.status, rate, message: payload?.message ?? payload });
  }

  return json({ ok: false, stage: "esagu", secretShapes, attempts: results,
    hint: "Neither secret authenticated. Check secretShapes: the valid eSagu bearer is a JWT (looksLikeJwt:true). If neither looks like a JWT, the ESAGU_JWT secret value is wrong/placeholder." }, 200);
});
