import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TRUE_SKU_RE = /^[A-Z0-9]{3}[-/]/;
const RECHECK_DAYS = 7;
const MAX_ATTEMPTS = 5;
const HARD_CAP = 500;
const DEFAULT_BATCH = 50;
const RATE_DELAY_MS = 60;
const SOFT_WALL_MS = 110_000; // stop gracefully before edge timeout

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface MintsoftProduct {
  ID: number;
  SKU: string;
  Name?: string;
  EANBarcode?: string;
  UPCBarcode?: string;
  CostPrice?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const startedAt = new Date().toISOString();
  const { data: runRow } = await supabase
    .from("agent_runs")
    .insert({ run_type: "resolve_orphan_skus", status: "running" })
    .select("id")
    .single();
  const runId = runRow?.id;

  try {
    // Master switch
    const { data: enabledRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "orphan_sku_resolver.enabled")
      .single();
    const enabled = enabledRow?.value === true || enabledRow?.value === "true";

    let body: { batchSize?: number; skus?: string[]; force?: boolean } = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { body = {}; }
    }

    if (!enabled && !body.force && !body.skus?.length) {
      await supabase.from("agent_runs").update({
        status: "complete",
        finished_at: new Date().toISOString(),
        summary: { reason: "resolver disabled" },
      }).eq("id", runId);
      return new Response(JSON.stringify({ skipped: true, reason: "disabled" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!apiKey) throw new Error("Mintsoft API key not configured");
    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("base_url")
      .single();
    const baseUrl = settings?.base_url || "https://api.mintsoft.co.uk";

    // Build candidate list
    const batchSize = Math.min(body.batchSize ?? DEFAULT_BATCH, HARD_CAP);
    let candidates: Array<{ id: string; sku: string; attempts: number }> = [];

    if (body.skus?.length) {
      const { data } = await supabase
        .from("products_cache")
        .select("id, sku, mintsoft_resolve_attempts")
        .in("sku", body.skus)
        .is("mintsoft_product_id", null);
      candidates = (data ?? []).map((r: any) => ({
        id: r.id, sku: r.sku, attempts: r.mintsoft_resolve_attempts ?? 0,
      }));
    } else {
      const recheckCutoff = new Date(Date.now() - RECHECK_DAYS * 86400000).toISOString();
      // Oldest-attempted first (nulls first)
      const { data } = await supabase
        .from("products_cache")
        .select("id, sku, mintsoft_resolve_attempts, last_mintsoft_resolve_attempt_at")
        .is("mintsoft_product_id", null)
        .eq("mintsoft_resolve_ignored", false)
        .eq("quarantined", false)
        .eq("discontinued", false)
        .lt("mintsoft_resolve_attempts", MAX_ATTEMPTS)
        .or(`last_mintsoft_resolve_attempt_at.is.null,last_mintsoft_resolve_attempt_at.lt.${recheckCutoff}`)
        .order("last_mintsoft_resolve_attempt_at", { ascending: true, nullsFirst: true })
        .limit(batchSize * 2); // overfetch so we can filter by regex
      candidates = (data ?? [])
        .filter((r: any) => TRUE_SKU_RE.test(r.sku))
        .slice(0, batchSize)
        .map((r: any) => ({ id: r.id, sku: r.sku, attempts: r.mintsoft_resolve_attempts ?? 0 }));
    }

    let resolved = 0;
    let notFound = 0;
    let errors = 0;
    let checked = 0;
    const resolvedSkus: string[] = [];
    const errorSamples: Array<{ sku: string; status: number; body: string }> = [];
    const wallStart = Date.now();
    let timedOut = false;

    for (const c of candidates) {
      if (Date.now() - wallStart > SOFT_WALL_MS) { timedOut = true; break; }
      checked++;
      try {
        const url = `${baseUrl}/api/Product/List?SKU=${encodeURIComponent(c.sku)}&PageNo=1&Limit=50`;
        const res = await fetch(url, {
          headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
        });

        if (!res.ok) {
          errors++;
          const body = await res.text().catch(() => "");
          if (errorSamples.length < 10) {
            errorSamples.push({ sku: c.sku, status: res.status, body: body.slice(0, 200) });
          }
          console.log(`ERR ${res.status} sku="${c.sku}" body=${body.slice(0, 150)}`);
          await supabase.from("products_cache").update({
            last_mintsoft_resolve_attempt_at: new Date().toISOString(),
            mintsoft_resolve_attempts: c.attempts + 1,
          }).eq("id", c.id);
          await sleep(RATE_DELAY_MS);
          continue;
        }

        const json = await res.json();
        const arr: MintsoftProduct[] = Array.isArray(json)
          ? json
          : Array.isArray(json?.Items) ? json.Items
          : json?.SKU ? [json] : [];

        const exact = arr.find((p) => (p.SKU || "").toUpperCase() === c.sku.toUpperCase());

        if (exact?.ID) {
          await supabase.from("products_cache").update({
            mintsoft_product_id: exact.ID,
            mintsoft_resolved_at: new Date().toISOString(),
            last_mintsoft_resolve_attempt_at: new Date().toISOString(),
            barcode: exact.EANBarcode || exact.UPCBarcode || undefined,
          }).eq("id", c.id);
          resolved++;
          resolvedSkus.push(c.sku);
        } else {
          notFound++;
          await supabase.from("products_cache").update({
            last_mintsoft_resolve_attempt_at: new Date().toISOString(),
            mintsoft_resolve_attempts: c.attempts + 1,
          }).eq("id", c.id);
        }
      } catch (e) {
        errors++;
        if (errorSamples.length < 10) {
          errorSamples.push({ sku: c.sku, status: 0, body: String(e).slice(0, 200) });
        }
      }
      await sleep(RATE_DELAY_MS);
    }

    const summary = {
      candidates: candidates.length,
      checked,
      resolved,
      not_found: notFound,
      errors,
      timed_out: timedOut,
      resolved_skus: resolvedSkus.slice(0, 50),
      error_samples: errorSamples,
      mode: body.skus?.length ? "manual" : "cron",
    };

    await supabase.from("agent_runs").update({
      status: "complete",
      finished_at: new Date().toISOString(),
      summary,
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, startedAt, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unexpected error";
    await supabase.from("agent_runs").update({
      status: "error",
      finished_at: new Date().toISOString(),
      error: msg,
    }).eq("id", runId);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
