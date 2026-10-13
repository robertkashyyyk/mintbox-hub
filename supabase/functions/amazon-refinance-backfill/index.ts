// ============================================================================
// amazon-refinance-backfill — historical re-pull of Amazon finances, window by window.
//
// STAGE-THEN-SWAP (security/prompt0-fixes, 2026-10-13). The old driver deleted a
// window's live rows first and then re-pulled it; if the time budget or the page
// guard ran out mid-window it still marked the window done and moved on, so the
// deleted rows were never re-pulled. Now, per window:
//   1) amazon_begin_finance_window      → stage_id (nothing live is touched)
//   2) amazon-pull-finances {stageId}   → pages land in amazon.financial_events_stage
//      (if the budget runs out, self-chain with resume {stageId, window, nextToken})
//   3) amazon_swap_finance_window       → ONE transaction, only once the pull is
//      complete: diff-swap on the natural key within the range Amazon was queried
// A pull that errors abandons the stage; live data stays exactly as it was.
//
// Body: { from?: "YYYY-MM-DD" (default 2026-03-16), windowDays?: 7, budgetSeconds?: 110,
//         resume?: { stageId, windowStart: ISO, windowEnd: ISO, nextToken? } }
// Auth: service-role only. Pause the nightly finances cron (amazon-nightly-finances)
// while a long backfill runs.
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
const UK_MARKETPLACE = "A1F83G8C2ARO7P";
const UUID_RX = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const marketplaceId = (Deno.env.get("SP_API_MARKETPLACE_IDS") || UK_MARKETPLACE).split(",")[0].trim();

  // service-role only (gateway verify_jwt has already checked the signature)
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (bearer !== SERVICE_KEY) {
    try {
      const part = bearer.split(".")[1];
      const b64 = (part ?? "").replace(/-/g, "+").replace(/_/g, "/");
      const role = part ? JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)))?.role : null;
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
  let resume = input?.resume && UUID_RX.test(String(input.resume.stageId ?? "")) &&
      !isNaN(Date.parse(input.resume.windowStart)) && !isNaN(Date.parse(input.resume.windowEnd))
    ? input.resume as { stageId: string; windowStart: string; windowEnd: string; nextToken?: string }
    : null;

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);
  const pullUrl = `${SUPABASE_URL}/functions/v1/amazon-pull-finances`;
  const selfUrl = `${SUPABASE_URL}/functions/v1/amazon-refinance-backfill`;
  const auth = { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` };
  const chain = (body: unknown) => {
    const p = fetch(selfUrl, { method: "POST", headers: auth, body: JSON.stringify(body) }).catch(() => {});
    // @ts-ignore EdgeRuntime is provided by the Supabase runtime
    try { EdgeRuntime.waitUntil(p); } catch { /* ignore */ }
  };

  const windowsDone: unknown[] = [];
  let cursor = resume ? new Date(resume.windowStart) : new Date(from);

  try {
    while (cursor < nowCap) {
      if (Date.now() > deadline) break;

      let stageId: string;
      let wStart: Date, wEnd: Date;
      let nextToken: string | undefined;
      if (resume) {
        stageId = resume.stageId;
        wStart = new Date(resume.windowStart);
        wEnd = new Date(resume.windowEnd);
        nextToken = resume.nextToken || undefined;
        resume = null;
      } else {
        wStart = new Date(cursor);
        wEnd = new Date(Math.min(cursor.getTime() + windowDays * dayMs, nowCap.getTime()));
        const { data: sid, error: bErr } = await supa.rpc("amazon_begin_finance_window", {
          p_marketplace_id: marketplaceId, p_start: wStart.toISOString(), p_end: wEnd.toISOString(),
        });
        if (bErr || !sid) return json({ error: `begin failed @${fmtDay(wStart)}: ${bErr?.message}`, windowsDone }, 500);
        stageId = sid as string;
      }
      const startStr = fmtDay(wStart);
      const endStr = fmtDay(new Date(wEnd.getTime() - 1)); // inclusive day label

      // Pull the window into staging, following nextToken. Live data is untouched here.
      let complete = false;
      let guard = 0;
      while (guard++ < 60) {
        const remaining = Math.floor((deadline - Date.now()) / 1000) - 10;
        if (remaining < 15) break;
        const res = await fetch(pullUrl, {
          method: "POST", headers: auth,
          body: JSON.stringify({ start: startStr, end: endStr, nextToken, stageId, budgetSeconds: Math.min(100, remaining) }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = `pull ${res.status}: ${JSON.stringify(body).slice(0, 200)}`;
          await supa.rpc("amazon_abandon_finance_window", { p_stage_id: stageId, p_error: msg });
          return json({ error: `pull failed @${startStr} (live data untouched): ${msg}`, windowsDone }, 502);
        }
        if (body?.throttled) { await sleep(2500); nextToken = body.nextToken ?? nextToken; continue; }
        if (body?.done) { complete = true; break; }
        nextToken = body?.nextToken;
        if (!nextToken) { complete = true; break; }
      }

      if (!complete) {
        // Out of budget (or page guard) mid-window: nothing live changed. Resume THIS window.
        const resumeBody = { from: fmtDay(cursor), windowDays, budgetSeconds,
          resume: { stageId, windowStart: wStart.toISOString(), windowEnd: wEnd.toISOString(), nextToken } };
        chain(resumeBody);
        return json({ ok: true, done: false, windowsDone, resuming: { window: `${startStr}..${endStr}`, stageId } });
      }

      // Pull complete → swap into live atomically.
      const { data: sw, error: swErr } = await supa.rpc("amazon_swap_finance_window", { p_stage_id: stageId });
      if (swErr || !sw?.ok) {
        return json({ error: `swap failed/refused @${startStr}: ${swErr?.message ?? JSON.stringify(sw)}`, windowsDone }, 500);
      }
      windowsDone.push({ window: `${startStr}..${endStr}`, ...sw });
      cursor = wEnd;
    }

    const done = cursor >= nowCap;
    if (!done) chain({ from: fmtDay(cursor), windowDays, budgetSeconds });
    return json({ ok: true, done, windowsDone, nextFrom: done ? null : fmtDay(cursor) });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e), windowsDone, nextFrom: fmtDay(cursor) }, 500);
  }
});
