// Mintsoft LSA bulk update
// POST { items: [{ sku, mintsoft_product_id, low_stock_alert_level }] }
// Sends MINIMAL payload {ID, LowStockAlertLevel} to /api/Product (Mintsoft's
// update endpoint), then verifies by re-fetching the product. Echoing the full
// product object back triggers silent validation failures
// (e.g. "One or more pallet sizes are not valid!") where Mintsoft returns
// HTTP 200 with Success:false, so we MUST check that flag and verify.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MINTSOFT_BASE = 'https://api.mintsoft.co.uk'
const MS_KEY = Deno.env.get('MINTSOFT_API_KEY')!

interface Item {
  sku: string
  mintsoft_product_id: number
  low_stock_alert_level: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Unauthorized' }, 401)
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )
    const token = authHeader.replace('Bearer ', '')
    const { data: userData, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !userData?.user) return json({ error: 'Unauthorized' }, 401)

    const body = await req.json().catch(() => null)
    const items: Item[] = Array.isArray(body?.items) ? body.items : []
    if (!items.length) return json({ error: 'No items' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const results: Array<{ sku: string; ok: boolean; error?: string; verified?: number }> = []

    for (const it of items) {
      try {
        if (!it.mintsoft_product_id || it.low_stock_alert_level == null) {
          results.push({ sku: it.sku, ok: false, error: 'Missing id or LSA' })
          continue
        }

        const targetLsa = Math.round(it.low_stock_alert_level)

        // 1. POST minimal payload — Mintsoft treats this as an update when ID is present.
        const payload = {
          ID: it.mintsoft_product_id,
          LowStockAlertLevel: targetLsa,
        }
        const postRes = await fetch(`${MINTSOFT_BASE}/api/Product`, {
          method: 'POST',
          headers: {
            'ms-apikey': MS_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
        })
        const postText = await postRes.text()
        if (!postRes.ok) {
          results.push({ sku: it.sku, ok: false, error: `POST ${postRes.status}: ${postText.slice(0, 200)}` })
          continue
        }
        // Mintsoft can return 200 with Success:false — must check.
        let parsed: any = null
        try { parsed = JSON.parse(postText) } catch { /* ignore */ }
        if (parsed && parsed.Success === false) {
          results.push({ sku: it.sku, ok: false, error: `Mintsoft rejected: ${parsed.Message ?? postText.slice(0, 200)}` })
          continue
        }

        // 2. Verify by re-fetching
        const verifyRes = await fetch(`${MINTSOFT_BASE}/api/Product/${it.mintsoft_product_id}`, {
          headers: { 'ms-apikey': MS_KEY, Accept: 'application/json' },
        })
        if (!verifyRes.ok) {
          const txt = await verifyRes.text()
          results.push({ sku: it.sku, ok: false, error: `Verify GET ${verifyRes.status}: ${txt.slice(0, 200)}` })
          continue
        }
        const verified = await verifyRes.json()
        const verifiedLsa = Number(verified?.LowStockAlertLevel ?? 0)
        if (Math.round(verifiedLsa) !== targetLsa) {
          results.push({
            sku: it.sku,
            ok: false,
            error: `Mintsoft accepted but LSA still ${verifiedLsa} (expected ${targetLsa})`,
            verified: verifiedLsa,
          })
          continue
        }

        // 3. Mirror to local cache (only after Mintsoft confirms)
        await admin
          .from('products_cache')
          .update({ low_stock_alert_level: targetLsa })
          .eq('sku', it.sku)

        results.push({ sku: it.sku, ok: true, verified: verifiedLsa })
      } catch (e: any) {
        results.push({ sku: it.sku, ok: false, error: e?.message ?? String(e) })
      }
    }

    const ok = results.filter((r) => r.ok).length
    return json({ updated: ok, failed: results.length - ok, results })
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500)
  }

  function json(b: unknown, status = 200) {
    return new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
