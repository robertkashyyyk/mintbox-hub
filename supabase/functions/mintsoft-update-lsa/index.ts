// Mintsoft LSA bulk update
// POST { items: [{ sku: string, mintsoft_product_id: number, low_stock_alert_level: number }] }
// Pulls full product object from Mintsoft, sets LowStockAlertLevel, posts back, mirrors to products_cache.
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

    const results: Array<{ sku: string; ok: boolean; error?: string }> = []

    for (const it of items) {
      try {
        if (!it.mintsoft_product_id || it.low_stock_alert_level == null) {
          results.push({ sku: it.sku, ok: false, error: 'Missing id or LSA' })
          continue
        }

        // 1. Fetch current product
        const getRes = await fetch(`${MINTSOFT_BASE}/api/Product/${it.mintsoft_product_id}`, {
          headers: { 'ms-apikey': MS_KEY, Accept: 'application/json' },
        })
        if (!getRes.ok) {
          const txt = await getRes.text()
          results.push({ sku: it.sku, ok: false, error: `GET ${getRes.status}: ${txt.slice(0, 200)}` })
          continue
        }
        const product = await getRes.json()

        // 2. Mutate LSA
        product.LowStockAlertLevel = Math.round(it.low_stock_alert_level)

        // 3. POST back full product
        const postRes = await fetch(`${MINTSOFT_BASE}/api/Product`, {
          method: 'POST',
          headers: {
            'ms-apikey': MS_KEY,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(product),
        })
        if (!postRes.ok) {
          const txt = await postRes.text()
          results.push({ sku: it.sku, ok: false, error: `POST ${postRes.status}: ${txt.slice(0, 200)}` })
          continue
        }

        // 4. Mirror to local cache
        await admin
          .from('products_cache')
          .update({ low_stock_alert_level: it.low_stock_alert_level })
          .eq('sku', it.sku)

        results.push({ sku: it.sku, ok: true })
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
