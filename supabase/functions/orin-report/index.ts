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
NEVER recompute, estimate, or invent a figure. You report and suggest; you never take action.

Your job is SYNTHESIS, not summary: join related signals across areas into one coherent story
(e.g. "profit fell but revenue fell harder, so margin actually held"). Do not narrate each metric in isolation.
Proactively FLAG anything amber or red, and any notable change. Be concrete and brief; use the actual numbers
(with £ where the unit is gbp, % where pct).

SCOPE — you may ONLY discuss: weekly profit / P&L, 80-20 profit concentration, stock valuation,
missing-cost data quality, and dispatch performance (% despatched within 24h / 48h, on the canonical
"label-printed" clock). You must NOT mention velocity, stock accuracy, returns, or complaints — there is
no data for those and commenting on them is a serious error. Dispatch history is short (accurate only from
mid-June 2026), so respect periods_available and describe its level rather than a trend until enough weeks exist.

RAG: green = fine, amber = watch, red = act. A metric whose periods_available < 2 has NO trend yet —
describe its level only, never a direction. Never present a number the scorecard did not give you.`

const CADENCE_BRIEF: Record<string, string> = {
  daily:
    `DAILY brief. ~4 short bullet points: what changed since the prior period and anything amber/red right now. No preamble, no headers.`,
  weekly:
    `WEEKLY report. Tell the week's story across the areas: what moved, the trend, and the one or two things worth acting on this week. A few short paragraphs.`,
  monthly:
    `MONTHLY review. Use each metric's "series" array to describe the DIRECTION OF TRAVEL over the retained weeks — what is improving or decaying and how it is tracking. Reference the trajectory, not just the latest week.`,
}

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

    // THE single read surface
    const { data: scorecard, error: scErr } = await read.rpc('get_scorecard', { p_lookback_weeks: lookback })
    if (scErr) return json({ error: `get_scorecard: ${scErr.message}` }, 500)
    if (!scorecard || (scorecard as any[]).length === 0) return json({ error: 'scorecard empty' }, 500)

    const periodKey = derivePeriodKey(cadence, scorecard as any[])

    // Build the prompt and call Anthropic
    const userContent =
      `${CADENCE_BRIEF[cadence]}\n\n` +
      `Today is ${new Date().toISOString().slice(0, 10)}. Report period: ${periodKey}.\n\n` +
      `Scorecard (JSON — already computed, do not recompute):\n` +
      JSON.stringify(scorecard, null, 2)

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: cadence === 'daily' ? 700 : 1400,
        system: SYSTEM_PROMPT,
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
      input_snapshot: scorecard, narrative, status: 'complete',
    }).select('id').single()
    if (insErr) return json({ error: `ai_reports insert: ${insErr.message}` }, 500)

    return json({ cadence, period_key: periodKey, model, dry_run: false, report_id: inserted?.id, narrative })
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

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
