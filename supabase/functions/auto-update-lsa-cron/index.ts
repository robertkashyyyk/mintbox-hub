// Auto LSA Update cron + on-demand runner.
// - When invoked with no body: schedule evaluator (cron tick).
//   Reads `lsa.auto_update_schedule` from app_settings, decides if "now" is a fire window,
//   then iterates every brand with auto_update_lsa = true and pushes target LSAs to Mintsoft.
// - When invoked with { brand_id }: forced single-brand run (manual "Run now" button).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPA_URL = Deno.env.get('SUPABASE_URL')!
const SUPA_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SUPA_ANON = Deno.env.get('SUPABASE_ANON_KEY')!

const HARD_CAP_PER_BRAND = 5000
const PUSH_BATCH_SIZE = 50
const RPC_PAGE = 1000

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

  const admin = createClient(SUPA_URL, SUPA_SERVICE)
  const startedAt = new Date()

  let body: any = {}
  try { body = await req.json() } catch { /* ignore */ }
  const forcedBrandId: string | undefined = body?.brand_id
  const forcedDryRun: boolean | undefined = body?.dry_run

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

  // Decide if this tick should fire (skipped for forced runs)
  if (!forcedBrandId) {
    if (!schedule.enabled) {
      return ok({ skipped: true, reason: 'auto-lsa schedule disabled' })
    }
    if (!isFireWindow(schedule, new Date())) {
      return ok({ skipped: true, reason: 'not fire window' })
    }
  }

  // Idempotency: if we already ran today (and not forced), skip
  if (!forcedBrandId) {
    const since = new Date(); since.setHours(0, 0, 0, 0)
    const { data: recent } = await admin.from('agent_runs')
      .select('id').eq('run_type', 'auto-lsa-update')
      .gte('started_at', since.toISOString()).limit(1)
    if (recent && recent.length > 0) {
      return ok({ skipped: true, reason: 'already ran today' })
    }
  }

  // Insert run row
  const { data: runRow } = await admin.from('agent_runs')
    .insert({ run_type: forcedBrandId ? 'auto-lsa-update-manual' : 'auto-lsa-update', status: 'running' })
    .select('id').single()
  const runId = runRow?.id

  const dryRun = forcedDryRun ?? schedule.dry_run

  // Brands to process
  let brandsQuery = admin.from('brands').select('id, name').eq('auto_update_lsa', true)
  if (forcedBrandId) brandsQuery = admin.from('brands').select('id, name').eq('id', forcedBrandId)
  const { data: brands, error: brandsErr } = await brandsQuery
  if (brandsErr) {
    await finishRun(admin, runId, 'failed', { error: brandsErr.message })
    return ok({ error: brandsErr.message }, 500)
  }

  const perBrand: Record<string, any> = {}
  let totalUpdated = 0
  let totalFailed = 0

  for (const brand of brands ?? []) {
    const summary = await processBrand(admin, brand, dryRun)
    perBrand[brand.name] = summary
    totalUpdated += summary.updated
    totalFailed += summary.failed
    await admin.from('brands').update({
      last_lsa_auto_update_at: new Date().toISOString(),
      last_lsa_auto_update_summary: summary,
    }).eq('id', brand.id)
  }

  const finalSummary = {
    brands_processed: brands?.length ?? 0,
    total_updated: totalUpdated,
    total_failed: totalFailed,
    dry_run: dryRun,
    per_brand: perBrand,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
  }

  await finishRun(admin, runId, totalFailed > 0 ? 'completed_with_errors' : 'completed', finalSummary)
  return ok(finalSummary)
})

async function processBrand(
  admin: ReturnType<typeof createClient>,
  brand: { id: string; name: string },
  dryRun: boolean,
): Promise<{ brand_id: string; brand_name: string; candidates: number; updated: number; failed: number; dry_run: boolean; capped?: boolean }> {
  // Pull all calibration rows for this brand
  const all: any[] = []
  let offset = 0
  while (true) {
    const { data, error } = await admin.rpc('get_lsa_calibration', {
      p_brand_id: brand.id, p_limit: RPC_PAGE, p_offset: offset,
    } as any)
    if (error) throw new Error(error.message)
    const chunk = (data || []) as any[]
    all.push(...chunk)
    if (chunk.length < RPC_PAGE) break
    offset += RPC_PAGE
    if (all.length >= HARD_CAP_PER_BRAND) break
  }

  // Only push rows where target differs from current
  const dirty = all.filter(r => Math.round(Number(r.target_lsa)) !== Math.round(Number(r.current_lsa)))
  const capped = dirty.length > HARD_CAP_PER_BRAND
  const slice = capped ? dirty.slice(0, HARD_CAP_PER_BRAND) : dirty

  if (slice.length === 0) {
    return { brand_id: brand.id, brand_name: brand.name, candidates: 0, updated: 0, failed: 0, dry_run: dryRun }
  }

  // Need mintsoft_product_id for each SKU
  const skus = slice.map(r => r.sku)
  const { data: products } = await admin.from('products_cache')
    .select('sku, mintsoft_product_id').in('sku', skus)
  const idMap = new Map((products || []).map((p: any) => [p.sku, p.mintsoft_product_id]))

  if (dryRun) {
    return { brand_id: brand.id, brand_name: brand.name, candidates: slice.length, updated: 0, failed: 0, dry_run: true, capped }
  }

  let updated = 0, failed = 0
  for (let i = 0; i < slice.length; i += PUSH_BATCH_SIZE) {
    const batch = slice.slice(i, i + PUSH_BATCH_SIZE)
      .map(r => ({
        sku: r.sku,
        mintsoft_product_id: idMap.get(r.sku),
        low_stock_alert_level: Math.round(Number(r.target_lsa)),
      }))
      .filter(it => !!it.mintsoft_product_id)
    if (batch.length === 0) continue

    const res = await fetch(`${SUPA_URL}/functions/v1/mintsoft-update-lsa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPA_ANON}`,
        'apikey': SUPA_ANON,
      },
      body: JSON.stringify({ items: batch }),
    })
    if (!res.ok) { failed += batch.length; continue }
    const json = await res.json().catch(() => ({}))
    updated += Number(json.updated ?? 0)
    failed += Number(json.failed ?? 0)
  }

  return { brand_id: brand.id, brand_name: brand.name, candidates: slice.length, updated, failed, dry_run: false, capped }
}

function isFireWindow(s: Schedule, now: Date): boolean {
  // Compute current UK time
  const uk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }))
  const [hh, mm] = s.time_uk.split(':').map(Number)
  // Fire if within current 15-minute tick window
  const ukMin = uk.getHours() * 60 + uk.getMinutes()
  const target = (hh ?? 6) * 60 + (mm ?? 0)
  if (Math.abs(ukMin - target) > 14) return false

  if (s.frequency === 'daily') return true
  if (s.frequency === 'weekly') return uk.getDay() === (s.day_of_week ?? 1)
  if (s.frequency === 'monthly') return uk.getDate() === Math.max(1, Math.min(28, s.day_of_month ?? 1))
  return false
}

async function finishRun(admin: ReturnType<typeof createClient>, runId: any, status: string, summary: any) {
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
