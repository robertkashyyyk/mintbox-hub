// Orin — read-side AI reporting layer (Scorecard + Orin build spec v1, Track A).
//
// Orin reads the scorecard's COMPUTED outputs (get_scorecard) and narrates them.
// It NEVER recomputes numbers and NEVER writes to operational tables. Its only
// write is its own narrative into ai_reports.
//
// Read/write boundary (governing principle #2 — deliberate break from the 4 other
// AI functions that write operational tables with the service role):
//   - reads via the ANON client, and only ever calls the read-only reporting RPCs:
//     get_scorecard / get_profit_day (computed metrics), get_target_pace (vs targets),
//     get_work_completed (the data-hygiene graft narrated in the "Work completed" section)
//   - the service-role client is used for EXACTLY ONE thing: inserting into ai_reports
// Do not add operational reads/writes here.
//
// Scope is hard-locked to Track A: profit/P&L, 80-20 concentration, stock
// valuation, missing-cost. The function physically only sees get_scorecard's
// output, so it cannot narrate dispatch/velocity/stock-accuracy/returns.
//
// Invoke: POST { cadence: 'daily'|'weekly'|'monthly', dry_run?: bool, lookback_weeks?: int }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { marked } from 'https://esm.sh/marked@12'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPA_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!

// Per-cadence model is tunable via app_settings 'scorecard.orin_models' (no redeploy).
const DEFAULT_MODELS: Record<string, string> = {
  daily:   'claude-haiku-4-5',
  weekly:  'claude-sonnet-4-6',
  monthly: 'claude-sonnet-4-6',
}

const SYSTEM_PROMPT =
  `You are Orin, the internal reporting analyst for PartsDocHub (an automotive-parts e-commerce operation).
You are given a pre-computed scorecard. EVERY number is already calculated — treat them as ground truth and
NEVER recompute, estimate, or invent a figure. Only ever cite numbers present in the scorecard JSON; if a
topic is not in the data, simply do not mention it. You report and suggest; you never take action.

TONE & FRAMING (important — this is how the team wants to read you):
- LEAD WITH THE POSITIVE. Open every report with what is holding up or improving — above all margin quality
  (profit-on-return %). Only AFTER the positive do you raise watch-items. Never open on a decline.
- MARGIN FIRST. If POR% is steady, say so up front as the reassuring headline: absolute revenue/profit will
  swing week to week, but a held POR means pricing and cost discipline are intact. Frame any profit/revenue
  dip against that (e.g. "POR held at 22.7%, only 0.27pts down — revenue eased but the margin is intact").
- PROFIT OVER REVENUE (non-negotiable). Profit and margin are what matter — they are the headline. Revenue is
  supporting context only, NEVER the lead figure. When you state a vs-target position, the PROFIT number leads;
  revenue follows as colour. Never open or headline on revenue.
- NO YEAR-ON-YEAR DATA YET. We do not have prior-year comparisons. Do not imply one. Judge performance against
  the recent weekly series ("in line with the recent average / recent range") and note YoY context will come
  once more history accrues.
- JUDGE MATERIALITY, not just direction. A small absolute change on a large base is NOT real progress — say so.
  e.g. dead stock barely moving (a few hundred £ against ~£190k) means this is NOT getting enough focus —
  state plainly it needs real action; do not dress a trivial move up as "encouraging".
- CREDIT GOOD WORK with the actual figures. When the data shows deliberate effort paying off, call it out
  specifically and positively, naming the numbers: how many SKUs were repriced and the additional profit it
  generated, how many SKUs were given a cost this week, items migrating UP out of the loss / break-even tiers.
  If a clear push is happening and working, make that obvious.

STRUCTURE — open with a TL;DR the reader grasps in five seconds, THEN the detail:
- **TL;DR** at the very top: a one-line HEADLINE (the single most important thing — a profit/margin statement,
  never revenue), then "Key movements" (3-4 tight bullets of what actually moved this period), then
  "Watch-items" (the 1-2 things genuinely worth acting on).
- THEN the fuller narrative below, area by area. The detail DEEPENS the TL;DR — it must never simply restate it.
- SAY IT ONCE. Each fact lives in exactly ONE place. State the "behind/ahead of Primary pace" position ONCE
  (in the headline), not again in every section. "Say it once, let it land."
- GROSS-IS-PARTIAL: state this caveat EXACTLY ONCE, as a single footnote-style line at the very end
  (e.g. "* Profit/gross is partial pending the missing-cost backlog"). Do NOT repeat "gross is partial" against
  every profit figure — mark it once with an asterisk and move on.

SYNTHESIS, not summary: join related signals into one coherent story (e.g. "profit fell but revenue fell
harder, so margin actually held"). Do not narrate each metric in isolation. Be concrete (£ where unit is gbp,
% where pct). Proactively flag anything amber or red.

TARGETS (lead with this when target pace is supplied): you may be given PartsDocHub target pace — actual-
to-date vs Primary/Stretch/Ultimate lines, with a banding tier per metric (below_primary / on_primary /
firmly_primary / on_stretch / firmly_stretch / on_ultimate / above_ultimate). OPEN the report by framing
the period against targets, LEADING WITH PROFIT (the 'gross' metric — profit matters more than revenue, so it
is the headline): state the profit tier/variance first ("profit is tracking ~12% behind Primary, but firmly
above break-even pace"), THEN revenue and orders as supporting colour, never as the lead. Use the emitted
tier/variance verbatim — never recompute. If the 'gross' row has partial_cost=true, still lead with profit; the
partial caveat goes ONCE in the single end footnote (see STRUCTURE) — not inline against each figure.

TOPICS — cover those PRESENT in the scorecard, skip those absent: weekly profit / P&L, profit-on-return %,
- AOV (average order value, metric aov_gbp) — a PRIORITY the team is actively working to lift. ALWAYS report it
  when present: its level AND direction of travel over the series (is it climbing or slipping, and by how much).
  It moves in small increments (pence), so judge it on the trend across weeks, not one week's wobble. When an
  aov_leverage block is supplied, use it to frame WHY it matters (the £/order and £/yr stake per +£1) — cite the
  supplied numbers, never compute your own. Flag clearly whether AOV is helping or hurting the profit picture.
80-20 profit concentration, profit-tier movement (loss / break-even / poor / average / good / great — where
SKUs are migrating to and from), stock valuation & dead stock (judge materiality), missing-cost data quality
(the count AND the weekly change — how many SKUs were given a cost this week, and whether it is trending down),
repricing payoff (SKUs repriced and the additional profit generated), and dispatch performance (% despatched
within 24h / 48h on the canonical "label-printed" clock).
- WORK COMPLETED / DATA HYGIENE (only when a work_completed block is supplied): the "what we actively did to the
  data" story — credit the deliberate graft in the window with the real numbers: missing costs amended
  (costs_amended = individual + bulk), LSA levels recalibrated (lsa_recalibrated), and purchase orders raised
  (count + value). Two figures are CUMULATIVE totals, not per-window — describe them as coverage reached, not
  work done this period: the dirt-SKU crosswalk (dirt_alias_coverage, "the crosswalk now maps N SKUs") and
  repricing coverage (reprice_coverage_skus, "repricing now covers N SKUs").
  Also state the remaining FBA unmapped backlog (fba_unmapped_backlog) as a watch-item — note per-period tie-ups
  aren't logged yet, so report it as work-still-to-do, not as completed. Frame this whole section as deliberate
  effort SEPARATE from the trading result. If a count is 0, don't invent activity — just omit that line.
You must NOT mention velocity, stock accuracy,
returns, or complaints — there is no data and commenting on them is a serious error. Dispatch history is short
(accurate only from mid-June 2026) — respect periods_available and describe its level, not a trend, until
enough weeks exist.

RAG: green = fine, amber = watch, red = act. A metric whose periods_available < 2 has NO trend yet —
describe its level only, never a direction. Never present a number the scorecard did not give you.`

const CADENCE_BRIEF: Record<string, string> = {
  daily:
    `DAILY brief. ~4 short bullets. LEAD with what is holding up (margin/POR first), THEN anything amber/red right now and any notable change. Credit good work with real numbers. No preamble, no headers.`,
  weekly:
    `WEEKLY report. Lead with a short TL;DR: a one-line HEADLINE (profit/margin first), then 2-3 "Key movements" bullets and 1 "Watch-item". Then the week's story across the areas — what moved, why, whether it is material — plus a short "Work completed" note from the work_completed block crediting the data-hygiene graft with real numbers. Say each thing once; put the single gross-partial footnote at the very end if profit is partial.`,
  monthly:
    `MONTHLY review. Structure it top-down: (1) TL;DR — a one-line HEADLINE leading with profit/margin, then "Key movements" (3-4 bullets, using each metric's "series" for the DIRECTION OF TRAVEL over the retained weeks) and "Watch-items" (the 1-2 things worth acting on); (2) the fuller detail below, area by area, referencing the trajectory not just the latest week; (3) a "Work completed" section from the work_completed block — the missing costs amended, dirt-SKU work, LSA recalibration, POs raised and repricing coverage, with real numbers, framed as deliberate graft; (4) end with the single gross-partial footnote if profit is partial. Say each thing once — the detail deepens the TL;DR, never repeats it.`,
}

// Daily is a different beast: not the weekly scorecard, just yesterday's headline figures
// plus a prompt to set today's focus. Kept deliberately tiny.
const DAILY_SYSTEM_PROMPT =
  `You are Orin, the internal analyst for PartsDocHub. You are given YESTERDAY's headline trading
figures AND how they landed against the daily TARGETS (Primary/Stretch/Ultimate), already calculated —
never recompute or invent a number. Write a VERY short daily note:
- LEAD with yesterday's PROFIT vs the Primary profit target (profit matters more than revenue) — e.g.
  "Yesterday's profit beat Primary by 12%" or "profit came in 8% short of Primary". A single day is not
  "tiered" — just say ahead/behind Primary (and by how much), and note if it cleared Stretch/Ultimate.
- Then state revenue and orders as supporting context (a tight line or two), positive and encouraging in tone.
- Include ONE line on AOV (average order value): the figure and whether it is ahead/behind the day's target. AOV
  is a priority lever — every +£1 is ~£0.68 incremental profit per order — so it's always worth a mention, but
  keep it to a single line and don't over-read a single day.
- POR% is given as a LEVEL only. You may state it ("25.0% POR"), but you are NOT given any margin target or
  baseline — so NEVER say margin/POR is "above"/"below"/"well above" an expected level, and never invent a
  baseline figure (e.g. a "27.5% baseline"). Beating the profit £ target does NOT imply margin is high; do not
  claim margin "drove" the day. Only compare against the Primary/Stretch/Ultimate PROFIT £ lines you are given.
- Then ask ONE short, specific question to get the team thinking about today's focus.
No preamble, no headers, no other metrics, no analysis beyond those figures. Never invent or compare against any
target/baseline not present in the data.`

// get_scorecard / get_profit_day are heavy and sit on the ~8s statement timeout
// when COLD (cache/plan not warm) — a single cold call fails the report. Retry so
// the warm attempt (≈3-4s) succeeds. Same pattern as the LSA/dispatch RPCs.
async function rpcRetry(client: any, fnName: string, args: any, attempts = 4) {
  let last: any = null
  for (let i = 1; i <= attempts; i++) {
    const { data, error } = await client.rpc(fnName, args)
    if (!error) return { data, error: null }
    last = error
    if (i < attempts) await new Promise(r => setTimeout(r, 1500 * i))
  }
  return { data: null, error: last }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    let body: any = {}
    try { body = await req.json() } catch { /* ignore */ }
    const cadence: string = ['daily', 'weekly', 'monthly'].includes(body?.cadence) ? body.cadence : 'weekly'
    const dryRun: boolean = !!body?.dry_run
    const lookback: number = Number(body?.lookback_weeks ?? (cadence === 'monthly' ? 12 : 8))

    // READ client — only ever calls the read-only reporting RPCs (get_scorecard /
    // get_profit_day / get_target_pace / get_work_completed / get_aov_now). These are
    // SECURITY DEFINER and granted to authenticated + service_role but NOT anon (the anon
    // key is public in the frontend, so exposing profit data to it is undesirable). This is
    // a backend cron function, so it reads with the service role. (2026-07-30: an overnight
    // revoke of anon's EXECUTE silently killed the daily — this makes Orin independent of it.)
    const read = createClient(SUPA_URL, SERVICE_KEY)

    // model config (tunable)
    const { data: modelRow } = await read.from('app_settings').select('value').eq('key', 'scorecard.orin_models').maybeSingle()
    const model = (modelRow?.value as any)?.[cadence] ?? DEFAULT_MODELS[cadence]

    // Build the data + prompt. Daily = yesterday's headline figures; weekly/monthly = scorecard.
    let periodKey: string
    let systemPrompt: string
    let userContent: string
    let maxTokens: number
    let inputSnapshot: any
    // KPI tiles for the email (hub card style), built from the structured data per cadence.
    let cards: Array<{ label: string; value: string; sub: string; accent: string }> = []
    const gbp = (n: any) => '£' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })

    if (cadence === 'daily') {
      const { data: dayRows, error: dErr } = await rpcRetry(read, 'get_profit_day', {})
      if (dErr) return json({ error: `get_profit_day: ${dErr.message}` }, 500)
      const d: any = Array.isArray(dayRows) ? dayRows[0] : dayRows
      if (!d) return json({ error: 'no daily data' }, 500)
      // Yesterday vs the daily targets (Primary/Stretch/Ultimate) — single day, not tiered.
      // Retry: a cold get_target_pace (now FBA-union) can miss the first call at 6am.
      const { data: pace } = await rpcRetry(read, 'get_target_pace', { p_grain: 'day', p_asof: d.day })
      inputSnapshot = { day: d, targets: pace ?? [] }
      periodKey = String(d.day)
      systemPrompt = DAILY_SYSTEM_PROMPT
      maxTokens = 450
      const por = d.por_pct != null ? ` (POR ${(Number(d.por_pct) * 100).toFixed(1)}%)` : ''
      // KPI cards: yesterday's figures + how each landed vs the Primary daily target.
      const pRow = (mk: string) => (pace as any[] ?? []).find((x) => x.metric === mk)
      const vsP = (mk: string) => {
        const v = pRow(mk)?.variance_vs_primary_pct
        return v == null ? '' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}% vs Primary`
      }
      const accP = (mk: string) => {
        const v = pRow(mk)?.variance_vs_primary_pct
        return v == null ? '#64748b' : (v >= 0 ? '#2A9D8F' : '#d97706')
      }
      // AOV = revenue / orders. Target AOV = the day's implied Primary (revenue target / orders target).
      // AOV is a PRIORITY lever: each +£1 drops through at high incremental margin (~£0.68/order).
      const aov = Number(d.orders) > 0 ? Number(d.revenue) / Number(d.orders) : null
      const revP = pRow('revenue')?.exp_primary, ordP = pRow('orders')?.exp_primary
      const aovTarget = (revP && ordP) ? Number(revP) / Number(ordP) : null
      cards = [
        { label: 'Revenue', value: gbp(d.revenue), sub: vsP('revenue'), accent: accP('revenue') },
        { label: 'Orders', value: Number(d.orders).toLocaleString('en-GB'), sub: vsP('orders'), accent: accP('orders') },
        { label: 'AOV', value: aov != null ? '£' + aov.toFixed(2) : '—',
          sub: (aov != null && aovTarget) ? `${aov >= aovTarget ? '+' : ''}£${(aov - aovTarget).toFixed(2)} vs £${aovTarget.toFixed(2)} target` : '',
          accent: (aov != null && aovTarget) ? (aov >= aovTarget ? '#2A9D8F' : '#d97706') : '#64748b' },
        { label: 'Profit', value: gbp(d.profit), sub: d.por_pct != null ? `POR ${(Number(d.por_pct) * 100).toFixed(1)}%` : '', accent: '#64748b' },
      ]
      userContent =
        `Yesterday (${d.day}): Revenue ${gbp(d.revenue)}, Orders ${d.orders}, Profit ${gbp(d.profit)}${por}.\n` +
        (aov != null ? `AOV (average order value) = £${aov.toFixed(2)}${aovTarget ? ` vs £${aovTarget.toFixed(2)} target (${aov >= aovTarget ? 'ahead' : 'behind'})` : ''}. ` +
          `AOV is a priority lever — every +£1 of AOV is ~£0.68 incremental profit per order.\n` : '\n') +
        `\nDaily targets vs actual (Primary/Stretch/Ultimate; variance_vs_primary_pct is the fraction ` +
        `above/below the Primary target — positive = ahead):\n${JSON.stringify(pace ?? [], null, 2)}\n\n` +
        `Write the short daily note now — LEAD with how yesterday landed vs the Primary daily target, and ` +
        `include one line on AOV (the figure and whether it is ahead/behind target).`
    } else {
      const { data: scorecard, error: scErr } = await rpcRetry(read, 'get_scorecard', { p_lookback_weeks: lookback })
      if (scErr) return json({ error: `get_scorecard: ${scErr.message}` }, 500)
      if (!scorecard || (scorecard as any[]).length === 0) return json({ error: 'scorecard empty' }, 500)
      // Target pace vs Primary/Stretch/Ultimate — the WEEK for the weekly story, YTD for the monthly.
      // A weekly report is about the week, not month-to-date. asof=yesterday so the Monday cron's
      // 'week' grain resolves to the just-completed Mon–Sun week (not a ragged rolling 7 days).
      const paceGrain = cadence === 'monthly' ? 'ytd' : 'week'
      const paceArgs: any = { p_grain: paceGrain }
      if (cadence === 'weekly') paceArgs.p_asof = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const { data: pace } = await rpcRetry(read, 'get_target_pace', paceArgs)
      // Work-completed / data-hygiene graft over the recent window (read-only: activity_log +
      // dirt + reprice + FBA backlog). Trailing 30d for monthly, 7d for weekly. Never fatal.
      const wcDays = cadence === 'monthly' ? 30 : 7
      const wcTo = new Date().toISOString().slice(0, 10)
      const wcFrom = new Date(Date.now() - (wcDays - 1) * 86400000).toISOString().slice(0, 10)
      const { data: work } = await read.rpc('get_work_completed', { p_from: wcFrom, p_to: wcTo })
      // Live current-week AOV (a ratio, so a partial week is representative) — the scorecard's
      // aov_gbp only carries COMPLETED weeks, so without this Orin narrates a week-stale figure.
      const { data: aovNow } = await read.rpc('get_aov_now')
      // AOV leverage — a priority lever. Each +£1 of AOV drops through at high incremental margin
      // (~£0.68/order, the team's rule of thumb). Annualise at the current weekly order run-rate
      // (orders = weekly revenue / AOV, both from the scorecard) so Orin can state the stake precisely.
      const AOV_PROFIT_PER_POUND = 0.68
      const sc = (mk: string) => (scorecard as any[]).find((r) => r.metric_key === mk)
      const aovWk = sc('aov_gbp')?.current_value
      const wkRev = sc('revenue_gbp')?.current_value
      const wkOrders = (wkRev && aovWk) ? Number(wkRev) / Number(aovWk) : null
      const aovLeverage = wkOrders ? {
        profit_per_pound_per_order: AOV_PROFIT_PER_POUND,
        annual_orders_runrate: Math.round(wkOrders * 52),
        gbp_per_year_per_plus_1_aov: Math.round(wkOrders * 52 * AOV_PROFIT_PER_POUND),
      } : null
      // The live current-week AOV is only meaningful once the week has a real sample. Weekly/monthly
      // reports run at period-start (Mon/1st), when the current week has a handful of orders — so
      // gate on order count: below the floor, lead AOV with the last COMPLETED week, not noise.
      const AOV_MIN_ORDERS = 1000
      const aovRepresentative = !!(aovNow && Number(aovNow.orders_so_far) >= AOV_MIN_ORDERS)
      const aovCompletedWk = sc('aov_gbp')  // scorecard = completed weeks only
      inputSnapshot = { scorecard, target_pace: pace ?? [], work_completed: work ?? null, aov_leverage: aovLeverage, aov_now: aovNow ?? null }
      periodKey = derivePeriodKey(cadence, scorecard as any[])
      systemPrompt = SYSTEM_PROMPT
      maxTokens = cadence === 'monthly' ? 4000 : 2000   // monthly review is long — don't truncate
      userContent =
        `${CADENCE_BRIEF[cadence]}\n\n` +
        `Today is ${new Date().toISOString().slice(0, 10)}. Report period: ${periodKey}.\n\n` +
        `PartsDocHub target pace — ${cadence === 'weekly'
          ? 'THIS COMPLETED WEEK vs the weekly Primary/Stretch/Ultimate target. This is a WEEKLY report: frame it around the WEEK, not month-to-date, and do not lead on MTD figures'
          : 'YTD actual-to-date vs Primary/Stretch/Ultimate'} ` +
        `— with the banding tier per metric. LEAD the report with this: state the tier (e.g. "revenue is ` +
        `firmly in Primary, building toward Stretch") and whether we're ahead/behind Primary pace. ` +
        `For 'gross' rows with partial_cost=true, caveat that gross is partial pending full cost data:\n` +
        `${JSON.stringify(pace ?? [], null, 2)}\n\n` +
        (work
          ? `Work completed / data-hygiene graft in the last ${wcDays} days (already counted — give this its ` +
            `own "Work completed" section and name the numbers; omit any line whose count is 0; the FBA ` +
            `backlog is work still-to-do, not completed):\n${JSON.stringify(work, null, 2)}\n\n`
          : '') +
        (aovLeverage
          ? `AOV (average order value) is a PRIORITY the team is actively lifting. ` +
            (aovRepresentative
              ? `The live current week (${aovNow.current_week}) already has a real sample — £${aovNow.current_week_aov} ` +
                `across ${aovNow.orders_so_far} orders, ${aovNow.wow_delta >= 0 ? 'up' : 'down'} £${Math.abs(aovNow.wow_delta).toFixed(2)} ` +
                `on ${aovNow.last_completed_week}'s £${aovNow.last_completed_aov}. Lead with it (say "so far this week"), THEN the ` +
                `completed-week trend (scorecard aov_gbp). `
              : `LEAD with the last COMPLETED week: scorecard aov_gbp is £${aovCompletedWk?.current_value} in ` +
                `${aovCompletedWk?.period_label} (prior £${aovCompletedWk?.prior_value}) — report that level and the ` +
                `direction of travel over the series. ` +
                (aovNow ? `The current week (${aovNow.current_week}) has only ${aovNow.orders_so_far} orders so far — FAR ` +
                  `too few to read, so do NOT cite its AOV (${aovNow.current_week_aov}) or treat it as a signal or headline. ` : '')) +
            `Frame the stake using these SUPPLIED figures (do not compute your own): each +£1 of AOV ≈ ` +
            `£${AOV_PROFIT_PER_POUND.toFixed(2)} incremental profit per order; at ~${aovLeverage.annual_orders_runrate.toLocaleString('en-GB')} ` +
            `orders/yr that is ≈ £${aovLeverage.gbp_per_year_per_plus_1_aov.toLocaleString('en-GB')}/yr per +£1 of AOV.\n\n`
          : '') +
        `Scorecard (JSON — already computed, do not recompute):\n` +
        JSON.stringify(scorecard, null, 2)
      // KPI cards: target pace per metric (actual-to-date + banding tier).
      const grainTag = cadence === 'monthly' ? 'YTD' : 'WK'
      const tierAcc = (t: string | null) =>
        t === 'below_primary' ? '#d97706'
          : (t && t !== 'on_primary' && t !== 'firmly_primary') ? '#2A9D8F'
          : '#64748b'
      const pr = (mk: string) => (pace as any[] ?? []).find((x) => x.metric === mk)
      cards = ([
        ['revenue', `Revenue · ${grainTag}`, true],
        ['gross', 'Gross', true],
        ['orders', `Orders · ${grainTag}`, false],
      ] as [string, string, boolean][]).map(([mk, label, money]) => {
        const r = pr(mk)
        if (!r) return null
        return {
          label: label + (mk === 'gross' && r.partial_cost ? ' *' : ''),
          value: money ? gbp(r.actual) : Number(r.actual).toLocaleString('en-GB'),
          sub: r.tier_label ?? '',
          accent: tierAcc(r.tier),
        }
      }).filter(Boolean) as typeof cards
      // AOV tile — the live current week ONLY if it has a real sample (else it's Monday-morning
      // noise, e.g. £23.77 off 19 orders). Otherwise show the last COMPLETED week's AOV.
      const aovRow = aovCompletedWk
      if (aovRepresentative && aovNow?.current_week_aov != null) {
        const dl = Number(aovNow.wow_delta)
        cards.push({
          label: 'AOV · this wk',
          value: '£' + Number(aovNow.current_week_aov).toFixed(2),
          sub: Number.isFinite(dl) ? `${dl >= 0 ? '+' : ''}£${dl.toFixed(2)} vs last wk` : '',
          accent: !Number.isFinite(dl) ? '#64748b' : (dl >= 0 ? '#2A9D8F' : '#d97706'),
        })
      } else if (aovRow?.current_value != null) {
        const dp = aovRow.delta_pct
        cards.push({
          label: 'AOV · latest wk',
          value: '£' + Number(aovRow.current_value).toFixed(2),
          sub: dp != null ? `${dp >= 0 ? '+' : ''}${dp}% WoW` : '',
          accent: dp == null ? '#64748b' : (dp >= 0 ? '#2A9D8F' : '#d97706'),
        })
      }
    }

    // Retry the model call: a single transient blip (429/529/5xx or a network
    // wobble) must not drop the whole report + its email, as happened 2026-07-30.
    let aiRes: Response | null = null
    let lastErr = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: 'user', content: userContent }],
          }),
        })
        if (aiRes.ok) break
        // 4xx other than 429 won't fix themselves — fail fast.
        if (aiRes.status !== 429 && aiRes.status < 500) {
          lastErr = `Anthropic ${aiRes.status}: ${(await aiRes.text()).slice(0, 300)}`
          break
        }
        lastErr = `Anthropic ${aiRes.status}`
      } catch (e: any) {
        lastErr = `Anthropic fetch: ${e?.message ?? String(e)}`
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 2000)) // 2s, 4s
    }
    if (!aiRes || !aiRes.ok) {
      return json({ error: lastErr || 'Anthropic call failed after retries' }, 502)
    }
    const aiJson = await aiRes.json()
    const narrative = (aiJson?.content ?? []).map((b: any) => b?.text ?? '').join('').trim()
    if (!narrative) return json({ error: 'empty narrative from model' }, 502)

    if (dryRun) {
      return json({ cadence, period_key: periodKey, model, dry_run: true, narrative, metrics: (inputSnapshot?.scorecard?.length ?? null) })
    }

    // The ONLY write: Orin's narrative into its own store. Service client used here only.
    const write = createClient(SUPA_URL, SERVICE_KEY)
    const { data: inserted, error: insErr } = await write.from('ai_reports').insert({
      cadence, period_key: periodKey, scope: 'track_a', model,
      input_snapshot: inputSnapshot, narrative, status: 'complete',
    }).select('id').single()
    if (insErr) return json({ error: `ai_reports insert: ${insErr.message}` }, 500)

    // Optional DELIVERY (not an operational write): email the digest to configured
    // recipients. Recipients + which cadences to send live in app_settings so they can be
    // changed with no redeploy. Wrapped so a mail failure never fails report generation.
    let emailed: string[] = []
    try {
      const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
      // app_settings is RLS-locked to authenticated, so read delivery config via the SERVICE
      // client (anon reads return nothing → silently no recipients → no email).
      const { data: recRow } = await write.from('app_settings').select('value').eq('key', 'orin.recipients').maybeSingle()
      const { data: cadRow } = await write.from('app_settings').select('value').eq('key', 'orin.email_cadences').maybeSingle()
      const { data: fromRow } = await write.from('app_settings').select('value').eq('key', 'orin.email_from').maybeSingle()
      // test_to overrides recipients (for previewing without mailing the full list).
      const testTo = body?.test_to
      // Optional one-off note (e.g. a correction/apology while in test) — rendered as a
      // banner above the report in the email ONLY; never stored in ai_reports.narrative.
      const note = typeof body?.note === 'string' ? body.note.trim() : ''
      const cfgRecipients: string[] = Array.isArray(recRow?.value) ? (recRow!.value as string[]) : []
      const recipients: string[] = testTo ? (Array.isArray(testTo) ? testTo : [testTo]) : cfgRecipients
      const cadences: string[] = Array.isArray(cadRow?.value) ? (cadRow!.value as string[]) : ['weekly', 'monthly']
      // from address: app_settings override, else the verified partsdochub.com sender.
      const fromAddr: string = (typeof fromRow?.value === 'string' && fromRow.value)
        ? (fromRow.value as string) : 'PartsDoc Orin <orin@partsdochub.com>'
      if (RESEND_API_KEY && recipients.length > 0 && (testTo || cadences.includes(cadence))) {
        // Prepend the note as a blockquote banner (styled via .orin-body blockquote) for the email only.
        const emailBody = note ? `> ${note}\n\n${narrative}` : narrative
        const html = renderEmailHtml(emailBody, cadence, periodKey, cards)
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromAddr,
            to: recipients,
            subject: `Orin ${cadence} report — ${periodKey}`,
            html, text: emailBody,
          }),
        })
        if (r.ok) emailed = recipients
        else console.error('orin email send failed', r.status, (await r.text()).slice(0, 300))
      }
    } catch (e: any) { console.error('orin email error', e?.message ?? String(e)) }

    return json({ cadence, period_key: periodKey, model, dry_run: false, report_id: inserted?.id, emailed, narrative })
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500)
  }
})

function derivePeriodKey(cadence: string, scorecard: any[]): string {
  if (cadence === 'monthly') {
    const d = new Date()
    return `${d.getUTCFullYear()}-M${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  }
  if (cadence === 'daily') return new Date().toISOString().slice(0, 10)
  // weekly → the latest profit period label (e.g. 2026-W24)
  const profit = scorecard.find(r => r.metric_key === 'profit_gbp') ?? scorecard[0]
  return profit?.period_label ?? new Date().toISOString().slice(0, 10)
}

// Branded HTML email — renders the markdown narrative (headings, bold, lists, tables) into a
// clean PartsDocHub-styled shell. Resend also gets the raw narrative as the plain-text part.
// PartsDocHub brand palette (email needs static colours — mirrors src/index.css tokens):
//   charcoal #0F172A (pd-charcoal) · teal accent #2A9D8F (pd-accent 174 58% 37%) · slate greys.
const BRAND = { charcoal: '#0F172A', teal: '#2A9D8F', tealDark: '#1f7a70', slate: '#94a3b8', ink: '#1a1a1a' }
const LOGO_URL = 'https://partsdochub.com/email/partsdoc-logo-white.png'

function renderEmailHtml(
  narrative: string, cadence: string, periodKey: string,
  cards: Array<{ label: string; value: string; sub: string; accent: string }> = [],
): string {
  const bodyHtml = marked.parse(narrative, { async: false }) as string
  const title = cadence === 'daily' ? 'Daily Brief' : cadence === 'weekly' ? 'Weekly Report' : 'Monthly Review'
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  const cw = cards.length ? Math.floor(100 / cards.length) : 0
  const cardsHtml = cards.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0"><tr>` +
      cards.map((c) =>
        `<td style="padding:5px;vertical-align:top;width:${cw}%">` +
        `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:13px 14px;background:#fff">` +
        `<div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;font-family:${sans}">${c.label}</div>` +
        `<div style="font-size:22px;font-weight:700;color:#0f172a;margin-top:5px;font-family:${sans}">${c.value}</div>` +
        (c.sub ? `<div style="font-size:12px;color:${c.accent};margin-top:4px;font-family:${sans};font-weight:600">${c.sub}</div>` : '') +
        `</div></td>`).join('') +
      `</tr></table>`
    : ''
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  .orin-body{font-family:${sans};color:${BRAND.ink};line-height:1.6;font-size:15px}
  .orin-body h1,.orin-body h2,.orin-body h3{line-height:1.3;margin:1.4em 0 .5em;color:${BRAND.charcoal};font-weight:700}
  .orin-body h1{font-size:20px}.orin-body h2{font-size:17px}.orin-body h3{font-size:15px}
  .orin-body p{margin:.65em 0}
  .orin-body ul,.orin-body ol{margin:.6em 0;padding-left:1.2em}.orin-body li{margin:.3em 0}
  .orin-body strong{color:${BRAND.charcoal}}
  .orin-body table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px}
  .orin-body th,.orin-body td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}
  .orin-body th{background:#f1f5f9;color:${BRAND.charcoal}}
  .orin-body blockquote{margin:1em 0;padding:.6em 1em;border-left:3px solid ${BRAND.teal};background:#f0faf8;color:#334155}
  .orin-body a{color:${BRAND.tealDark}}
  .orin-body hr{border:none;border-top:1px solid #e2e8f0;margin:1.5em 0}
</style></head>
<body style="margin:0;background:#eef2f6;padding:24px;-webkit-font-smoothing:antialiased">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,.06)">
    <div style="height:4px;background:${BRAND.teal}"></div>
    <div style="background:${BRAND.charcoal};padding:22px 28px">
      <img src="${LOGO_URL}" alt="PartsDoc" height="26" style="height:26px;display:block;border:0;outline:none">
      <div style="color:${BRAND.slate};font-size:12px;margin-top:10px;font-family:${sans};letter-spacing:.02em">
        <span style="color:${BRAND.teal};font-weight:600">Orin</span> &middot; ${title} &middot; ${periodKey}
      </div>
    </div>
    ${cardsHtml ? `<div style="padding:18px 19px 4px">${cardsHtml}</div>` : ''}
    <div class="orin-body" style="padding:${cardsHtml ? '8px' : '26px'} 28px 26px">${bodyHtml}</div>
    <div style="padding:16px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:${BRAND.slate};font-size:11px;font-family:${sans}">
      Automated ${cadence} report by <span style="color:${BRAND.tealDark};font-weight:600">Orin</span> &middot; figures from the PartsDocHub scorecard
    </div>
  </div>
</body></html>`
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
