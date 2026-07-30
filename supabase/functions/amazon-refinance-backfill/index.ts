// ============================================================================
// amazon-refinance-backfill — one-shot historical re-pull of Amazon finances
// after the event_hash fix (multi-unit Principal rows were being deduped away).
//
// Per 7-day window it: (1) DELETES amazon.financial_events in that window, then
// (2) re-pulls it by invoking amazon-pull-finances {start,end}, looping its
// nextToken until the window is done. Processes windows until its time budget is
// spent, then SELF-INVOKES with { from: nextWindowStart } so a single trigger
// cascades through the whole range in the background.
//
// Body: { from?: "YYYY-MM-DD" (default 2026-03-16), windowDays?: 7,
//         budgetSeconds?: 110 }
// Auth: service-role only.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmtDay = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // service-role only
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer !== SERVICE_KEY) {
    try {
      const part = bearer.split(".")[1];
      const role = part ? JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=="))?.role : null;
      if (role !== "service_role") return json({ error: "Unauthorized" }, 401);
    } catch { return json({ error: "Unauthorized" }, 401); }
  }

  let input: any = {};
  try { input = req.method === "POST" ? await req.json() : {}; } catch { input = {}; }
  const windowDays = Number(input?.windowDays) > 0 ? Number(input.windowDays) : 7;
  const budgetSeconds = Math.min(Number(input?.budgetSeconds) > 0 ? Number(input.budgetSeconds) : 110, 130);
  const deadline = Date.now() + budgetSeconds * 1000;
  const dayMs = 24 * 3600 * 1000;

  const from = /^\d{4}-\d{2}-\d{2}$/.test(input?.from) ? new Date(`${input.from}T00:00:00Z`) : new Date("2026-03-16T00:00:00Z");
  const nowCap = new Date(Date.now() - 5 * 60 * 1000);

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  const pullUrl = `${SUPABASE_URL}/functions/v1/amazon-pull-finances`;
  const selfUrl = `${SUPABASE_URL}/functions/v1/amazon-refinance-backfill`;
  const auth = { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` };

  const windowsDone: string[] = [];
  let cursor = new Date(from);

  try {
    while (cursor < nowCap) {
      if (Date.now() > deadline) break;
      const wStart = new Date(cursor);
      const wEnd = new Date(Math.min(cursor.getTime() + windowDays * dayMs, nowCap.getTime()));
      const startStr = fmtDay(wStart);
      const endStr = fmtDay(new Date(wEnd.getTime() - 1)); // inclusive day label

      // 1) delete existing events in this window (old-hash rows) via SECURITY DEFINER RPC
      const del = await supa.rpc("amazon_delete_finance_window", { p_start: wStart.toISOString(), p_end: wEnd.toISOString() });
      if (del.error) return json({ error: `delete failed @${startStr}: ${del.error.message}`, windowsDone }, 500);

      // 2) re-pull the window, following nextToken until done
      let nextToken: string | undefined;
      let guard = 0;
      while (guard++ < 60) {
        const res = await fetch(pullUrl, {
          method: "POST", headers: auth,
          body: JSON.stringify({ start: startStr, end: endStr, nextToken, budgetSeconds: 120 }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return json({ error: `pull failed @${startStr}: ${JSON.stringify(body).slice(0, 200)}`, windowsDone }, 502);
        if (body?.throttled) { await sleep(2500); nextToken = body.nextToken; continue; }
        if (body?.done) break;
        nextToken = body?.nextToken;
        if (!nextToken) break;
        if (Date.now() > deadline) break; // resume this window on next invocation
      }
      windowsDone.push(`${startStr}..${endStr}`);
      cursor = wEnd;
    }

    const done = cursor >= nowCap;
    if (!done) {
      // self-chain for the remaining windows — waitUntil keeps the isolate alive
      // so the follow-up request is reliably sent after we return.
      const chain = fetch(selfUrl, { method: "POST", headers: auth, body: JSON.stringify({ from: fmtDay(cursor), windowDays, budgetSeconds }) }).catch(() => {});
      // @ts-ignore EdgeRuntime is provided by the Supabase runtime
      try { EdgeRuntime.waitUntil(chain); } catch { /* ignore */ }
    }
    return json({ ok: true, done, windowsDone, nextFrom: done ? null : fmtDay(cursor) });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), windowsDone, nextFrom: fmtDay(cursor) }, 500);
  }
});
