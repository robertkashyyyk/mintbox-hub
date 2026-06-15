// Auto LSA Update cron + on-demand runner.
//
// Computes each product's target Low Stock Alert (rolling velocity × multiplier,
// window = app_settings lsa.weekly_window_weeks) and pushes corrections to
// Mintsoft DIRECTLY via ms-apikey POST /api/Product + verify — the SAME pattern
// update-product-cost uses successfully from the cloud.
//
// WHY DIRECT (2026-06-11): the previous version POSTed to the mintsoft-update-lsa
// edge function over an internal HTTP hop using a SERVICE-ROLE token. That
// function's auth gate only accepts USER tokens, so every service-role call was
// rejected with 401 *before Mintsoft was ever contacted* — that was the "595
// failed / 0 updated" mystery, NOT a Mintsoft IP block (cost updates and other
// REST functions write to Mintsoft from the cloud fine). Calling Mintsoft inline
// removes the broken hop entirely.
//
// Policy (mirrors scripts/push-lsa-to-mintsoft.ts so cloud == local):
//   - dirty            = round(target) != round(current)
//   - NO-OP guard      = skip when coerced target == current (e.g. 1->1)
//   - IN-STOCK guard   = never LOWER on an out-of-stock SKU (current_stock <= 0);
//                        0 sales while OOS means "couldn't sell", not "no demand"
//   - coerce target 0 -> 1 (Mintsoft rejects LSA 0 on some products)
//   - mirror verified writes back into products_cache
//
// Invocation:
//   - no body              : scheduled cron tick (schedule + once-per-day guards)
//   - { brand_id }         : forced single-brand run (manual "Run now")
//   - { force, dry_run }   : bypass schedule guards / preview without writing
//
// MAX_PUSH_PER_RUN caps writes per invocation to stay within the edge runtime
// wall-clock. Steady-state weekly deltas are small; the one-time backlog is
// handled by the local script. Capped runs are flagged (never silently dropped).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPA_URL = Deno.env.get('SUPABASE_URL')!
const SUPA_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = 'PartsDoc Hub <noreply@updates.kashyyyk.co.uk>'

const MINTSOFT_BASE = 'https://api.mintsoft.co.uk'
const MS_KEY = Deno.env.get('MINTSOFT_API_KEY')!

const HARD_CAP_PER_BRAND = 5000
const MAX_PUSH_PER_RUN = 100   // edge compute guard: ~200 writes hit WORKER_RESOURCE_LIMIT
                               // (each write = POST + verify GET + cache mirror = 3 net ops).
                               // 100 leaves margin. When more than this is pending, the run
                               // SELF-CONTINUES (see chaining below) until drained.
const MAX_CHAIN = 30           // hard backstop on self-continuation batches per trigger (≤3,000 writes)

// EdgeRuntime is provided by the Supabase edge runtime; declare for type-checking.
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined
const THROTTLE_MS = 100
const RPC_PAGE = 1000
const ID_CHUNK = 200           // SKUs per products_cache .in() — small URL, fast (sku indexed)
const ERROR_SAMPLE_CAP = 50

interface Schedule {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  day_of_week: number   // 0=Sun..6=Sat
  day_of_month: number  // 1..28
  time_uk: string       // HH:MM
  dry_run: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let body: any = {}
  try { body = await req.json() } catch { /* ignore */ }
  const isContinuation: boolean = !!body?.continuation
  const chainDepth: number = Number(body?.chain_depth ?? 0)

  // A continuation batch is a fire-and-forget self-trigger from a prior capped run.
  // It must respond IMMEDIATELY (so the triggering worker isn't kept alive for the
  // whole chain) and do its work in the background via EdgeRuntime.waitUntil. The
  // first/manual call runs synchronously so the UI still gets a real summary.
  if (isContinuation) {
    const job = runBatch(body, true, chainDepth)
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(job)
    else await job
    return ok({ accepted: true, continuation: true, chain_depth: chainDepth })
  }
  return ok(await runBatch(body, false, chainDepth))
})

// Trigger the next self-continuation batch. The target responds immediately
// (isContinuation path above), so this await resolves fast — no nested keep-alive.
async function triggerNext(brandId: string | undefined, nextDepth: number) {
  try {
    await fetch(`${SUPA_URL}/functions/v1/auto-update-lsa-cron`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPA_SERVICE}`, 'apikey': SUPA_SERVICE },
      body: JSON.stringify({ brand_id: brandId, continuation: true, chain_depth: nextDepth, dry_run: false }),
    })
  } catch (e) {
    console.error('LSA chain trigger failed at depth', nextDepth, (e as Error).message)
  }
}

async function runBatch(body: any, isContinuation: boolean, chainDepth: number): Promise<any> {
  const admin = createClient(SUPA_URL, SUPA_SERVICE)
  const startedAt = new Date()

  const forcedBrandId: string | undefined = body?.brand_id
  const forcedDryRun: boolean | undefined = body?.dry_run
  const force: boolean = !!body?.force

  // Load schedule
  const { data: schedRow } = await admin.from('app_settings')
    .select('value').eq('key', 'lsa.auto_update_schedule').maybeSingle()
  const schedule: Schedule = {
    enabled: !!schedRow?.value?.enabled,
    frequency: schedRow?.value?.frequency ?? 'weekly',
    day_of_week: Number(schedRow?.value?.day_of_week ?? 1),
    day_of_month: Number(schedRow?.value?.day_of_month ?? 1),
    time_uk: String(schedRow?.value?.time_uk ?? '06:00'),
    dry_run: !!schedRow?.value?.dry_run,
  }

  // Schedule + idempotency guards apply only to true scheduled cron ticks
  // (no brand_id, no explicit `force`, not a self-continuation batch).
  if (!forcedBrandId && !force && !isContinuation) {
    if (!schedule.enabled) {
      return { skipped: true, reason: 'auto-lsa schedule disabled' }
    }
    if (!isFireWindow(schedule, new Date())) {
      return { skipped: true, reason: 'not fire window' }
    }
    const since = new Date(); since.setHours(0, 0, 0, 0)
    const { data: recent } = await admin.from('agent_runs')
      .select('id').eq('run_type', 'auto-lsa-update')
      .gte('started_at', since.toISOString()).limit(1)
    if (recent && recent.length > 0) {
      return { skipped: true, reason: 'already ran today' }
    }
  }

  // Insert run row. Continuation batches use a distinct run_type so they don't
  // trip the once-per-day idempotency guard above.
  const runType = forcedBrandId
    ? 'auto-lsa-update-manual'
    : (isContinuation ? 'auto-lsa-update-cont' : 'auto-lsa-update')
  const { data: runRow } = await admin.from('agent_runs')
    .insert({ run_type: runType, status: 'running' })
    .select('id').single()
  const runId = runRow?.id

  const dryRun = forcedDryRun ?? schedule.dry_run

  // Brands to process
  let brandsQuery = admin.from('brands').select('id, name').eq('auto_update_lsa', true)
  if (forcedBrandId) brandsQuery = admin.from('brands').select('id, name').eq('id', forcedBrandId)
  const { data: brands, error: brandsErr } = await brandsQuery
  if (brandsErr) {
    await finishRun(admin, runId, 'error', { error: brandsErr.message })
    return { error: brandsErr.message }
  }

  const perBrand: Record<string, any> = {}
  let totalUpdated = 0
  let totalFailed = 0
  const runBudget = { remaining: MAX_PUSH_PER_RUN }

  for (const brand of brands ?? []) {
    const summary = await processBrand(admin, brand, dryRun, runBudget)
    perBrand[brand.name] = summary
    totalUpdated += summary.updated
    totalFailed += summary.failed
    await admin.from('brands').update({
      last_lsa_auto_update_at: new Date().toISOString(),
      last_lsa_auto_update_summary: summary,
    }).eq('id', brand.id)
  }

  // Self-continuation: if this batch hit the push cap AND made progress, kick off
  // the next batch to drain the remainder (same day). Stops on no-progress (e.g.
  // Mintsoft failing) or the MAX_CHAIN backstop. Each batch is its own ≤100 run.
  const moreWork = runBudget.remaining <= 0
  const progress = totalUpdated > 0
  const willChain = !dryRun && moreWork && progress && chainDepth < MAX_CHAIN

  const finalSummary = {
    source: 'edge-cron-direct',
    brands_processed: brands?.length ?? 0,
    total_updated: totalUpdated,
    total_failed: totalFailed,
    run_push_cap: MAX_PUSH_PER_RUN,
    capped_run: moreWork,
    chained: willChain,
    chain_depth: chainDepth,
    dry_run: dryRun,
    per_brand: perBrand,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
  }

  await finishRun(admin, runId, totalFailed > 0 ? 'error' : 'complete', finalSummary)

  if (willChain) await triggerNext(forcedBrandId, chainDepth + 1)

  // Send summary email only from the FIRST run of a chain (not every continuation).
  if (!isContinuation) {
    try {
      const { data: recipRow } = await admin.from('app_settings')
        .select('value').eq('key', 'lsa.auto_update_recipients').maybeSingle()
      const emails: string[] = Array.isArray((recipRow?.value as any)?.emails)
        ? (recipRow!.value as any).emails
        : []
      if (emails.length > 0 && RESEND_API_KEY) {
        await sendSummaryEmail(emails, finalSummary, !!forcedBrandId)
      }
    } catch (e) {
      console.error('auto-lsa email send failed:', (e as Error).message)
    }
  }

  return finalSummary
}

// ---- Mintsoft: minimal-payload update + verify (same contract as update-product-cost) ----
async function pushLsa(mintsoftId: number, targetLsa: number): Promise<{ ok: boolean; error?: string }> {
  const postRes = await fetch(`${MINTSOFT_BASE}/api/Product`, {
    method: 'POST',
    headers: { 'ms-apikey': MS_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ID: mintsoftId, LowStockAlertLevel: targetLsa }),
    signal: AbortSignal.timeout(20_000),
  })
  const postText = await postRes.text()
  if (!postRes.ok) return { ok: false, error: `POST ${postRes.status}: ${postText.slice(0, 160)}` }
  let parsed: any = null
  try { parsed = JSON.parse(postText) } catch { /* ignore */ }
  if (parsed && parsed.Success === false) return { ok: false, error: `rejected: ${parsed.Message ?? postText.slice(0, 160)}` }

  const verifyRes = await fetch(`${MINTSOFT_BASE}/api/Product/${mintsoftId}`, {
    headers: { 'ms-apikey': MS_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!verifyRes.ok) return { ok: false, error: `verify GET ${verifyRes.status}` }
  const verified = await verifyRes.json()
  const verifiedLsa = Number(verified?.LowStockAlertLevel ?? 0)
  if (Math.round(verifiedLsa) !== targetLsa) {
    return { ok: false, error: `accepted but LSA still ${verifiedLsa} (expected ${targetLsa})` }
  }
  return { ok: true }
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 6, baseDelayMs = 1500): Promise<T> {
  let lastErr: any
  for (let i = 1; i <= attempts; i++) {
    try { return await fn() }
    catch (e: any) {
      lastErr = e
      if (i < attempts) await new Promise(r => setTimeout(r, baseDelayMs * i))
    }
  }
  throw lastErr
}

// chunked sku -> mintsoft_id lookup (NOT one giant .in() — that 35KB URL silently
// returned nothing for big brands like NGK in the old cron)
async function buildIdMap(admin: any, skus: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (let i = 0; i < skus.length; i += ID_CHUNK) {
    const chunk = skus.slice(i, i + ID_CHUNK)
    const data = await withRetry(async () => {
      const { data, error } = await admin.from('products_cache')
        .select('sku, mintsoft_id').in('sku', chunk).not('mintsoft_id', 'is', null)
      if (error) throw new Error(error.message)
      return data
    })
    for (const r of (data || [])) map.set(r.sku, Number(r.mintsoft_id))
  }
  return map
}

async function processBrand(
  admin: any,
  brand: { id: string; name: string },
  dryRun: boolean,
  runBudget: { remaining: number },
) {
  // Pull all calibration rows for this brand (heavy RPC → retry per page)
  const all: any[] = []
  let offset = 0
  while (true) {
    const data = await withRetry(async () => {
      const { data, error } = await admin.rpc('get_lsa_calibration', {
        p_brand_id: brand.id, p_limit: RPC_PAGE, p_offset: offset,
      } as any)
      if (error) throw new Error(error.message)
      return data as any[]
    })
    const chunk = (data || []) as any[]
    all.push(...chunk)
    if (chunk.length < RPC_PAGE) break
    offset += RPC_PAGE
    if (all.length >= HARD_CAP_PER_BRAND) break
  }

  const dirty = all.filter(r => Math.round(Number(r.target_lsa)) !== Math.round(Number(r.current_lsa)))
  const idMap = await buildIdMap(admin, dirty.map(r => r.sku))

  // Apply guards → build the real worklist
  const work: Array<{ sku: string; id: number; from: number; to: number }> = []
  let skipped_oos = 0, skipped_noop = 0, skipped_no_id = 0
  for (const r of dirty) {
    const to = Math.max(1, Math.round(Number(r.target_lsa)))   // coerce 0 -> 1
    const from = Math.round(Number(r.current_lsa))
    if (to === from) { skipped_noop++; continue }
    if (to < from && Number(r.current_stock) <= 0) { skipped_oos++; continue }
    const id = idMap.get(r.sku)
    if (!id) { skipped_no_id++; continue }
    work.push({ sku: r.sku, id, from, to })
  }

  const base = {
    brand_id: brand.id, brand_name: brand.name,
    candidates: work.length, skipped_oos, skipped_noop, skipped_no_id,
    dry_run: dryRun,
  }

  if (dryRun) return { ...base, updated: 0, failed: 0, capped: false, errors: [] }

  // Respect the per-run push budget shared across brands
  const capped = work.length > runBudget.remaining
  const slice = capped ? work.slice(0, Math.max(0, runBudget.remaining)) : work

  let updated = 0, failed = 0
  const errors: Array<{ sku: string; error: string }> = []
  for (const w of slice) {
    await new Promise(r => setTimeout(r, THROTTLE_MS))
    const res = await pushLsa(w.id, w.to)
    if (res.ok) {
      updated++
      await admin.from('products_cache').update({ low_stock_alert_level: w.to }).eq('sku', w.sku)
    } else {
      failed++
      if (errors.length < ERROR_SAMPLE_CAP) errors.push({ sku: w.sku, error: res.error ?? 'unknown' })
    }
  }
  runBudget.remaining -= slice.length

  return { ...base, updated, failed, capped, errors }
}

async function sendSummaryEmail(to: string[], summary: any, manual: boolean) {
  const subject = `[Auto LSA${summary.dry_run ? ' • DRY RUN' : ''}${manual ? ' • Manual' : ''}] ` +
    `${summary.total_updated} updated · ${summary.total_failed} failed · ${summary.brands_processed} brand(s)` +
    `${summary.capped_run ? ' · CAPPED' : ''}`

  const rows = Object.values(summary.per_brand || {}).map((b: any) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escapeHtml(b.brand_name)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;">${b.candidates}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#0a7d4f;">${b.updated}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${b.failed > 0 ? '#b00020' : '#666'};">${b.failed}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:#666;">${b.skipped_oos ?? 0} oos · ${b.capped ? 'capped' : ''}</td>
    </tr>`).join('')

  const html = `
    <div style="font-family:Arial,sans-serif;color:#222;max-width:680px;">
      <h2 style="margin:0 0 8px;">Auto LSA Update Summary</h2>
      <p style="color:#666;margin:0 0 16px;">
        ${manual ? 'Manual' : 'Scheduled'} run${summary.dry_run ? ' (dry run — no Mintsoft writes)' : ''} •
        ${new Date(summary.started_at).toUTCString()}
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:6px 10px;text-align:left;">Brand</th>
            <th style="padding:6px 10px;text-align:right;">Changes</th>
            <th style="padding:6px 10px;text-align:right;">Updated</th>
            <th style="padding:6px 10px;text-align:right;">Failed</th>
            <th style="padding:6px 10px;text-align:right;">Notes</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" style="padding:10px;color:#666;">No brands processed.</td></tr>'}</tbody>
        <tfoot>
          <tr style="background:#fafafa;font-weight:bold;">
            <td style="padding:6px 10px;">Total</td>
            <td style="padding:6px 10px;text-align:right;">—</td>
            <td style="padding:6px 10px;text-align:right;color:#0a7d4f;">${summary.total_updated}</td>
            <td style="padding:6px 10px;text-align:right;color:${summary.total_failed > 0 ? '#b00020' : '#666'};">${summary.total_failed}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
      <p style="color:#999;font-size:12px;margin-top:16px;">
        Changes = SKUs whose target LSA differs (after no-op/in-stock guards). Updated/Failed reflect verified Mintsoft writes.
        ${summary.capped_run ? `Run hit the ${summary.run_push_cap}-write cap; remainder picked up next run.` : ''}
      </p>
    </div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) console.error('Resend error:', res.status, await res.text())
}

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function isFireWindow(s: Schedule, now: Date): boolean {
  const uk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }))
  const [hh, mm] = s.time_uk.split(':').map(Number)
  const ukMin = uk.getHours() * 60 + uk.getMinutes()
  const target = (hh ?? 6) * 60 + (mm ?? 0)
  if (Math.abs(ukMin - target) > 14) return false
  if (s.frequency === 'daily') return true
  if (s.frequency === 'weekly') return uk.getDay() === (s.day_of_week ?? 1)
  if (s.frequency === 'monthly') return uk.getDate() === Math.max(1, Math.min(28, s.day_of_month ?? 1))
  return false
}

async function finishRun(admin: any, runId: any, status: string, summary: any) {
  if (!runId) return
  await admin.from('agent_runs').update({
    status, finished_at: new Date().toISOString(), summary,
  }).eq('id', runId)
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
