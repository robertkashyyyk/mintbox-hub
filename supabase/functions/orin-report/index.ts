// Orin — read-side AI reporting layer (Scorecard + Orin build spec v1, Track A).
//
// Orin reads the scorecard's COMPUTED outputs (get_scorecard) and narrates them.
// It NEVER recomputes numbers and NEVER writes to operational tables. Its only
// write is its own narrative into ai_reports.
//
// Read/write boundary (governing principle #2 — deliberate break from the 4 other
// AI functions that write operational tables with the service role):
//   - reads via the ANON client, and only ever calls get_scorecard()
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

SYNTHESIS, not summary: join related signals into one coherent story (e.g. "profit fell but revenue fell
harder, so margin actually held"). Do not narrate each metric in isolation. Be concrete (£ where unit is gbp,
% where pct). Proactively flag anything amber or red.

TOPICS — cover those PRESENT in the scorecard, skip those absent: weekly profit / P&L, profit-on-return %,
80-20 profit concentration, profit-tier movement (loss / break-even / poor / average / good / great — where
SKUs are migrating to and from), stock valuation & dead stock (judge materiality), missing-cost data quality
(the count AND the weekly change — how many SKUs were given a cost this week, and whether it is trending down),
repricing payoff (SKUs repriced and the additional profit generated), and dispatch performance (% despatched
within 24h / 48h on the canonical "label-printed" clock). You must NOT mention velocity, stock accuracy,
returns, or complaints — there is no data and commenting on them is a serious error. Dispatch history is short
(accurate only from mid-June 2026) — respect periods_available and describe its level, not a trend, until
enough weeks exist.

RAG: green = fine, amber = watch, red = act. A metric whose periods_available < 2 has NO trend yet —
describe its level only, never a direction. Never present a number the scorecard did not give you.`

const CADENCE_BRIEF: Record<string, string> = {
  daily:
    `DAILY brief. ~4 short bullets. LEAD with what is holding up (margin/POR first), THEN anything amber/red right now and any notable change. Credit good work with real numbers. No preamble, no headers.`,
  weekly:
    `WEEKLY report. OPEN with the positive — margin/POR holding and what is on track — then tell the week's story across the areas: what moved and why, whether the change is material, and the one or two things genuinely worth acting on. Credit any good work with its real numbers. A few short paragraphs.`,
  monthly:
    `MONTHLY review. OPEN with the positive trajectory, then use each metric's "series" array to describe the DIRECTION OF TRAVEL over the retained weeks — what is improving or decaying and how it is tracking. Credit sustained good work with real numbers. Reference the trajectory, not just the latest week.`,
}

// Daily is a different beast: not the weekly scorecard, just yesterday's headline figures
// plus a prompt to set today's focus. Kept deliberately tiny.
const DAILY_SYSTEM_PROMPT =
  `You are Orin, the internal analyst for PartsDocHub. You are given YESTERDAY's headline trading
figures, already calculated — never recompute or invent a number. Write a VERY short daily note:
state yesterday's revenue, orders and profit clearly (a tight few lines) in a positive, encouraging
tone, then ask ONE short, specific question to get the team thinking about today's focus. No preamble,
no headers, no other metrics, no analysis beyond those three figures.`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    let body: any = {}
    try { body = await req.json() } catch { /* ignore */ }
    const cadence: string = ['daily', 'weekly', 'monthly'].includes(body?.cadence) ? body.cadence : 'weekly'
    const dryRun: boolean = !!body?.dry_run
    const lookback: number = Number(body?.lookback_weeks ?? (cadence === 'monthly' ? 12 : 8))

    // READ-ONLY client — only ever used to call get_scorecard().
    const read = createClient(SUPA_URL, ANON_KEY)

    // model config (tunable)
    const { data: modelRow } = await read.from('app_settings').select('value').eq('key', 'scorecard.orin_models').maybeSingle()
    const model = (modelRow?.value as any)?.[cadence] ?? DEFAULT_MODELS[cadence]

    // Build the data + prompt. Daily = yesterday's headline figures; weekly/monthly = scorecard.
    let periodKey: string
    let systemPrompt: string
    let userContent: string
    let maxTokens: number
    let inputSnapshot: any

    if (cadence === 'daily') {
      const { data: dayRows, error: dErr } = await read.rpc('get_profit_day')
      if (dErr) return json({ error: `get_profit_day: ${dErr.message}` }, 500)
      const d: any = Array.isArray(dayRows) ? dayRows[0] : dayRows
      if (!d) return json({ error: 'no daily data' }, 500)
      inputSnapshot = d
      periodKey = String(d.day)
      systemPrompt = DAILY_SYSTEM_PROMPT
      maxTokens = 350
      const gbp = (n: any) => '£' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 0 })
      const por = d.por_pct != null ? ` (POR ${(Number(d.por_pct) * 100).toFixed(1)}%)` : ''
      userContent =
        `Yesterday (${d.day}): Revenue ${gbp(d.revenue)}, Orders ${d.orders}, Profit ${gbp(d.profit)}${por}.\n\n` +
        `Write the short daily note now.`
    } else {
      const { data: scorecard, error: scErr } = await read.rpc('get_scorecard', { p_lookback_weeks: lookback })
      if (scErr) return json({ error: `get_scorecard: ${scErr.message}` }, 500)
      if (!scorecard || (scorecard as any[]).length === 0) return json({ error: 'scorecard empty' }, 500)
      inputSnapshot = scorecard
      periodKey = derivePeriodKey(cadence, scorecard as any[])
      systemPrompt = SYSTEM_PROMPT
      maxTokens = 1400
      userContent =
        `${CADENCE_BRIEF[cadence]}\n\n` +
        `Today is ${new Date().toISOString().slice(0, 10)}. Report period: ${periodKey}.\n\n` +
        `Scorecard (JSON — already computed, do not recompute):\n` +
        JSON.stringify(scorecard, null, 2)
    }

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
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
    if (!aiRes.ok) {
      const t = await aiRes.text()
      return json({ error: `Anthropic ${aiRes.status}: ${t.slice(0, 300)}` }, 502)
    }
    const aiJson = await aiRes.json()
    const narrative = (aiJson?.content ?? []).map((b: any) => b?.text ?? '').join('').trim()
    if (!narrative) return json({ error: 'empty narrative from model' }, 502)

    if (dryRun) {
      return json({ cadence, period_key: periodKey, model, dry_run: true, narrative, metrics: (scorecard as any[]).length })
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
      const { data: recRow } = await read.from('app_settings').select('value').eq('key', 'orin.recipients').maybeSingle()
      const { data: cadRow } = await read.from('app_settings').select('value').eq('key', 'orin.email_cadences').maybeSingle()
      const { data: fromRow } = await read.from('app_settings').select('value').eq('key', 'orin.email_from').maybeSingle()
      const recipients: string[] = Array.isArray(recRow?.value) ? (recRow!.value as string[]) : []
      const cadences: string[] = Array.isArray(cadRow?.value) ? (cadRow!.value as string[]) : ['weekly', 'monthly']
      // from address: app_settings override, else the verified partsdochub.com sender.
      const fromAddr: string = (typeof fromRow?.value === 'string' && fromRow.value)
        ? (fromRow.value as string) : 'PartsDoc Orin <orin@partsdochub.com>'
      if (RESEND_API_KEY && recipients.length > 0 && cadences.includes(cadence)) {
        const html = renderEmailHtml(narrative, cadence, periodKey)
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromAddr,
            to: recipients,
            subject: `Orin ${cadence} report — ${periodKey}`,
            html, text: narrative,
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
function renderEmailHtml(narrative: string, cadence: string, periodKey: string): string {
  const bodyHtml = marked.parse(narrative, { async: false }) as string
  const title = cadence === 'daily' ? 'Daily Brief' : cadence === 'weekly' ? 'Weekly Report' : 'Monthly Review'
  const sans = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  .orin-body{font-family:${sans};color:#1a1a1a;line-height:1.6;font-size:15px}
  .orin-body h1,.orin-body h2,.orin-body h3{line-height:1.3;margin:1.4em 0 .5em;color:#0f172a}
  .orin-body h1{font-size:20px}.orin-body h2{font-size:17px}.orin-body h3{font-size:15px}
  .orin-body p{margin:.6em 0}
  .orin-body ul,.orin-body ol{margin:.6em 0;padding-left:1.2em}.orin-body li{margin:.25em 0}
  .orin-body strong{color:#0f172a}
  .orin-body table{border-collapse:collapse;width:100%;margin:1em 0;font-size:14px}
  .orin-body th,.orin-body td{border:1px solid #e2e8f0;padding:8px 10px;text-align:left}
  .orin-body th{background:#f8fafc}
  .orin-body blockquote{margin:1em 0;padding:.5em 1em;border-left:3px solid #cbd5e1;background:#f8fafc;color:#334155}
  .orin-body hr{border:none;border-top:1px solid #e2e8f0;margin:1.5em 0}
</style></head>
<body style="margin:0;background:#f1f5f9;padding:24px">
  <div style="max-width:680px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#0f172a;padding:20px 28px">
      <div style="color:#fff;font-size:18px;font-weight:700;font-family:${sans}">Orin</div>
      <div style="color:#94a3b8;font-size:12px;margin-top:2px;font-family:${sans}">PartsDocHub · ${title} · ${periodKey}</div>
    </div>
    <div class="orin-body" style="padding:24px 28px">${bodyHtml}</div>
    <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;font-family:${sans}">
      Automated ${cadence} report generated by Orin · figures from the PartsDocHub scorecard
    </div>
  </div>
</body></html>`
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
