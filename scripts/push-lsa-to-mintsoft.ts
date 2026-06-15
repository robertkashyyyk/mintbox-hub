/**
 * push-lsa-to-mintsoft — local replacement for the auto-update-lsa-cron edge
 * function, which cannot write to Mintsoft (Mintsoft blocks Supabase IPs, so
 * every push from the edge function fails — confirmed 595/595 failed on the
 * 2026-06-08 scheduled run, 0 successful writes since the feature went live).
 *
 * This runs on the Mac, whose IP Mintsoft accepts, so the writes actually land.
 * It mirrors the mintsoft-update-lsa edge function's MINIMAL-payload + verify
 * contract and the push-dims-to-mintsoft.ts safety conventions.
 *
 * What it does, per brand with auto_update_lsa = true (or a --brand filter):
 *   1. Pulls calibration rows from the get_lsa_calibration RPC (target vs current LSA)
 *   2. Keeps only "dirty" rows (round(target_lsa) != round(current_lsa))
 *   3. IN-STOCK GUARD — never LOWERS the LSA on an out-of-stock SKU (current_stock
 *      <= 0): zero recent sales on an OOS item means "couldn't sell", not "no
 *      demand". Raises are always allowed. (Pairs with the widened velocity window
 *      lsa.weekly_window_weeks, which credits earlier-in-quarter sales.)
 *   4. Resolves mintsoft_id via small CHUNKED .in() lookups over only the dirty
 *      SKUs — NOT one giant .in() over thousands of SKUs (that 35KB URL is exactly
 *      what silently skipped NGK's 2,920 candidates in the cron)
 *   5. POSTs minimal {ID, LowStockAlertLevel} to Mintsoft, verifies by re-fetch,
 *      then mirrors the new level into products_cache
 *   6. Records a run row in agent_runs (run_type 'auto-lsa-update-local') whose
 *      summary includes PER-SKU errors — so a silent 0/0 can never hide again
 *
 * Safety:
 *   - Dry-run by default. Pass --live to actually write to Mintsoft.
 *   - LSA of 0 is coerced to 1 (Mintsoft rejects 0 on some products; our logic
 *     treats <= lsa.min_threshold as "off" anyway) — same rule as the edge fn.
 *   - Throttled to ~5 req/s. Every attempt logged to lsa-push-{date}.jsonl.
 *
 * Usage:
 *   npx tsx scripts/push-lsa-to-mintsoft.ts                 # dry run, all auto brands
 *   npx tsx scripts/push-lsa-to-mintsoft.ts --live          # write to Mintsoft
 *   npx tsx scripts/push-lsa-to-mintsoft.ts --brand=NGK     # single brand, dry run
 *   npx tsx scripts/push-lsa-to-mintsoft.ts --brand=NGK --live
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { appendFileSync } from 'fs'

config({ path: resolve(process.cwd(), '.env.local') })

const SUPABASE_URL     = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!
const SUPABASE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY!
const MINTSOFT_API_KEY = process.env.MINTSOFT_API_KEY!
const MINTSOFT_BASE    = 'https://api.mintsoft.co.uk'

const isLive   = process.argv.includes('--live')
const brandArg = process.argv.find(a => a.startsWith('--brand='))?.split('=')[1]
             ?? (process.argv.indexOf('--brand') >= 0 ? process.argv[process.argv.indexOf('--brand') + 1] : null)

const logFile  = resolve(process.cwd(), `lsa-push-${new Date().toISOString().slice(0, 10)}.jsonl`)
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

function log(obj: object) { appendFileSync(logFile, JSON.stringify(obj) + '\n') }

// get_lsa_calibration is a heavy full-scan RPC that sits right on the canonical
// project's ~8s statement_timeout: a COLD call 500s, but the retry warms the
// plan/cache and succeeds (observed 8.5s fail → 2.6s ok). So every RPC/DB read
// is wrapped in a small retry-with-backoff. Worth it to stay 1:1 with the page's
// own target_lsa rather than re-deriving velocity ourselves.
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 6, baseDelayMs = 1500): Promise<T> {
  let lastErr: any
  for (let i = 1; i <= attempts; i++) {
    try { return await fn() }
    catch (e: any) {
      lastErr = e
      if (i < attempts) {
        const wait = baseDelayMs * i
        console.error(`  ${label}: attempt ${i}/${attempts} failed (${e?.message ?? e}); retrying in ${wait}ms`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }
  throw lastErr
}

interface CalRow {
  sku: string
  brand_id: string | null
  brand_name: string | null
  current_stock: number
  current_lsa: number
  target_lsa: number
}

interface BrandResult {
  brand_id: string
  brand_name: string
  candidates: number
  updated: number
  failed: number
  skipped_no_id: number
  skipped_oos: number      // lowering suppressed because the SKU is out of stock — see IN-STOCK GUARD
  skipped_noop: number     // coerced target already equals current LSA (e.g. 1->1) — nothing to write
  dry_run: boolean
  errors: Array<{ sku: string; error: string }>   // capped sample — see ERROR_SAMPLE_CAP
}

const RPC_PAGE        = 1000
const ID_LOOKUP_CHUNK = 200    // SKUs per products_cache .in() lookup — small enough to keep the URL short
const THROTTLE_MS     = 200
const ERROR_SAMPLE_CAP = 50   // how many per-SKU errors to persist into agent_runs.summary

// --- Mintsoft: minimal-payload update + verify (mirrors mintsoft-update-lsa) ---
async function pushLsa(mintsoftId: number, targetLsa: number): Promise<{ ok: boolean; error?: string; verified?: number }> {
  const postRes = await fetch(`${MINTSOFT_BASE}/api/Product`, {
    method: 'POST',
    headers: { 'ms-apikey': MINTSOFT_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ ID: mintsoftId, LowStockAlertLevel: targetLsa }),
    signal: AbortSignal.timeout(20_000),
  })
  const postText = await postRes.text()
  if (!postRes.ok) return { ok: false, error: `POST ${postRes.status}: ${postText.slice(0, 160)}` }
  let parsed: any = null
  try { parsed = JSON.parse(postText) } catch { /* ignore */ }
  if (parsed && parsed.Success === false) return { ok: false, error: `rejected: ${parsed.Message ?? postText.slice(0, 160)}` }

  const verifyRes = await fetch(`${MINTSOFT_BASE}/api/Product/${mintsoftId}`, {
    headers: { 'ms-apikey': MINTSOFT_API_KEY, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!verifyRes.ok) return { ok: false, error: `verify GET ${verifyRes.status}` }
  const verified = await verifyRes.json()
  const verifiedLsa = Number(verified?.LowStockAlertLevel ?? 0)
  if (Math.round(verifiedLsa) !== targetLsa) {
    return { ok: false, error: `accepted but LSA still ${verifiedLsa} (expected ${targetLsa})`, verified: verifiedLsa }
  }
  return { ok: true, verified: verifiedLsa }
}

// --- sku -> mintsoft_id map, looked up in small CHUNKED .in() batches over the
// exact SKUs we need. sku is indexed, so this is fast; the original cron did one
// giant .in() over thousands of SKUs (35KB+ URL) which silently returned nothing
// for big brands like NGK — hence its 2,920 candidates / 0 updated / 0 failed.
async function buildIdMap(skus: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (let i = 0; i < skus.length; i += ID_LOOKUP_CHUNK) {
    const chunk = skus.slice(i, i + ID_LOOKUP_CHUNK)
    const data = await withRetry(async () => {
      const { data, error } = await supabase
        .from('products_cache')
        .select('sku, mintsoft_id')
        .in('sku', chunk)
        .not('mintsoft_id', 'is', null)
      if (error) throw new Error(error.message)
      return data
    }, `idMap chunk ${i / ID_LOOKUP_CHUNK}`)
    for (const r of (data || []) as any[]) map.set(r.sku, Number(r.mintsoft_id))
  }
  return map
}

async function getCalibrationRows(brandId: string): Promise<CalRow[]> {
  const all: CalRow[] = []
  let offset = 0
  for (;;) {
    const data = await withRetry(async () => {
      // All 3 args are required to disambiguate the two RPC overloads — passing
      // only p_brand_id returns HTTP 300 Multiple Choices.
      const { data, error } = await supabase.rpc('get_lsa_calibration', {
        p_brand_id: brandId, p_limit: RPC_PAGE, p_offset: offset,
      })
      if (error) throw new Error(error.message)
      return data
    }, `get_lsa_calibration offset ${offset}`)
    const chunk = (data || []) as CalRow[]
    all.push(...chunk)
    if (chunk.length < RPC_PAGE) break
    offset += RPC_PAGE
  }
  return all
}

async function processBrand(brand: { id: string; name: string }): Promise<BrandResult> {
  const rows = await getCalibrationRows(brand.id)
  const dirty = rows.filter(r => Math.round(Number(r.target_lsa)) !== Math.round(Number(r.current_lsa)))
  const idMap = await buildIdMap(dirty.map(r => r.sku))

  const res: BrandResult = {
    brand_id: brand.id, brand_name: brand.name,
    candidates: dirty.length, updated: 0, failed: 0, skipped_no_id: 0, skipped_oos: 0, skipped_noop: 0,
    dry_run: !isLive, errors: [],
  }

  console.log(`\n${brand.name}: ${dirty.length} candidate(s) (of ${rows.length} in scope)`)

  for (const r of dirty) {
    const mintsoftId = idMap.get(r.sku)
    const targetLsa = Math.max(1, Math.round(Number(r.target_lsa)))   // coerce 0 -> 1
    const curLsa = Math.round(Number(r.current_lsa))

    // NO-OP GUARD: the dirty filter compares raw round(target) vs round(current),
    // but we coerce a 0 target up to 1. That makes "current=1, target≈0" look
    // dirty yet resolve to 1->1. Skip those — don't churn Mintsoft writing the
    // value it already has. (~2,970 of ~3,620 candidates are exactly this.)
    if (targetLsa === curLsa) {
      res.skipped_noop++
      continue
    }

    // IN-STOCK GUARD: never LOWER the alert level on an out-of-stock SKU. Zero
    // recent sales on an OOS item means "couldn't sell", not "no demand" — so
    // dropping its LSA would mute the restock alert on exactly the lines we want
    // to reorder. Raises are always allowed (harmless on an OOS item). 67% of
    // the would-be-lowerings were OOS, hence this guard. The widened velocity
    // window (lsa.weekly_window_weeks) catches the rest by crediting earlier sales.
    if (targetLsa < curLsa && Number(r.current_stock) <= 0) {
      res.skipped_oos++
      log({ sku: r.sku, action: 'skipped_oos_lowering', current_stock: r.current_stock, from: curLsa, to: targetLsa })
      continue
    }

    if (!mintsoftId) {
      res.skipped_no_id++
      log({ sku: r.sku, action: 'skipped_no_mintsoft_id', current_lsa: r.current_lsa, target_lsa: r.target_lsa })
      continue
    }

    if (!isLive) {
      log({ sku: r.sku, mintsoft_id: mintsoftId, action: 'would_push', from: r.current_lsa, to: targetLsa })
      continue
    }

    await new Promise(rr => setTimeout(rr, THROTTLE_MS))
    const out = await pushLsa(mintsoftId, targetLsa)
    if (out.ok) {
      res.updated++
      await supabase.from('products_cache').update({ low_stock_alert_level: targetLsa }).eq('sku', r.sku)
      log({ sku: r.sku, mintsoft_id: mintsoftId, action: 'pushed_ok', from: r.current_lsa, to: targetLsa })
    } else {
      res.failed++
      if (res.errors.length < ERROR_SAMPLE_CAP) res.errors.push({ sku: r.sku, error: out.error ?? 'unknown' })
      console.error(`  ${r.sku} (ID ${mintsoftId}): ${out.error}`)
      log({ sku: r.sku, mintsoft_id: mintsoftId, action: 'push_failed', to: targetLsa, error: out.error })
    }
  }

  const realChanges = res.candidates - res.skipped_noop - res.skipped_oos - res.skipped_no_id
  console.log(`  → ${realChanges} real change(s); updated ${res.updated}, failed ${res.failed}, skipped(oos) ${res.skipped_oos}, skipped(noop) ${res.skipped_noop}, skipped(no id) ${res.skipped_no_id}`)
  return res
}

async function main() {
  console.log(`Mode: ${isLive ? '🔴 LIVE — will write to Mintsoft' : '🟡 DRY RUN — no Mintsoft writes'}`)
  if (brandArg) console.log(`Brand filter: ${brandArg}`)
  console.log(`Log: ${logFile}`)

  // Brands to process: auto_update_lsa = true, optionally narrowed by --brand
  let bq = supabase.from('brands').select('id, name').eq('auto_update_lsa', true)
  if (brandArg) bq = bq.ilike('name', `%${brandArg}%`)
  const { data: brands, error: bErr } = await bq
  if (bErr) { console.error('Brand lookup error:', bErr.message); process.exit(1) }
  if (!brands || brands.length === 0) { console.error('No matching auto-LSA brands.'); process.exit(1) }
  console.log(`Brands in scope: ${brands.map((b: any) => b.name).join(', ')}`)

  const startedAt = new Date().toISOString()

  // Open a run row (only when live — dry runs don't pollute agent_runs)
  let runId: any = null
  if (isLive) {
    const { data: runRow } = await supabase.from('agent_runs')
      .insert({ run_type: 'auto-lsa-update-local', status: 'running', started_at: startedAt })
      .select('id').single()
    runId = runRow?.id
  }

  const perBrand: Record<string, BrandResult> = {}
  let totalUpdated = 0, totalFailed = 0, totalSkipped = 0, totalOos = 0, totalNoop = 0
  for (const b of brands as any[]) {
    const r = await processBrand({ id: b.id, name: b.name })
    perBrand[b.name] = r
    totalUpdated += r.updated; totalFailed += r.failed; totalSkipped += r.skipped_no_id
    totalOos += r.skipped_oos; totalNoop += r.skipped_noop
    if (isLive) {
      await supabase.from('brands').update({
        last_lsa_auto_update_at: new Date().toISOString(),
        last_lsa_auto_update_summary: r,
      }).eq('id', b.id)
    }
  }

  const summary = {
    source: 'local-script', dry_run: !isLive,
    brands_processed: brands.length,
    total_updated: totalUpdated, total_failed: totalFailed,
    total_skipped_oos: totalOos, total_skipped_noop: totalNoop, total_skipped_no_id: totalSkipped,
    per_brand: perBrand, started_at: startedAt, finished_at: new Date().toISOString(),
  }

  if (isLive && runId) {
    await supabase.from('agent_runs').update({
      status: totalFailed > 0 ? 'error' : 'complete',
      finished_at: new Date().toISOString(), summary,
    }).eq('id', runId)
  }

  console.log(`\n── Summary ──────────────────────────`)
  console.log(`Brands:                 ${brands.length}`)
  console.log(`Candidates (dirty):     ${Object.values(perBrand).reduce((s, r) => s + r.candidates, 0)}`)
  if (isLive) {
    console.log(`Pushed successfully:    ${totalUpdated}`)
    console.log(`Failed:                 ${totalFailed}`)
  }
  console.log(`Skipped (OOS lowering):   ${totalOos}`)
  console.log(`Skipped (no-op 1->1):     ${totalNoop}`)
  console.log(`Skipped (no mintsoft_id): ${totalSkipped}`)
  console.log(`Log written to: ${logFile}`)
  if (!isLive) {
    const wouldPush = Object.values(perBrand).reduce((s, r) => s + (r.candidates - r.skipped_no_id - r.skipped_oos - r.skipped_noop), 0)
    console.log(`\nRe-run with --live to write ${wouldPush} real LSA change(s) to Mintsoft.`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
