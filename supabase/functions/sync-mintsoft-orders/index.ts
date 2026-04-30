import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const START_TIME = Date.now();
const MAX_RUNTIME_MS = 50_000; // 50s safety margin (edge functions timeout at 60s)
function isTimeRunningOut() { return Date.now() - START_TIME > MAX_RUNTIME_MS; }

interface MintsoftOrder {
  ID: number;
  OrderDate: string;
  OrderStatusId?: number;
  OrderStatus?: string | { ID: number; ExternalName: string } | null;
  CustomerName?: string;
  Channel: { Name: string } | null;
  ExternalOrderReference: string;
  WarehouseId?: number;
}

function extractStatusName(order: MintsoftOrder, statusLookup: Map<number, string>): string | null {
  if (typeof order.OrderStatus === 'string' && order.OrderStatus) return order.OrderStatus;
  if (order.OrderStatus && typeof order.OrderStatus === 'object' && 'ExternalName' in order.OrderStatus) {
    return order.OrderStatus.ExternalName;
  }
  if (order.OrderStatusId && statusLookup.has(order.OrderStatusId)) {
    return statusLookup.get(order.OrderStatusId)!;
  }
  return null;
}

interface MintsoftOrderItem {
  SKU: string;
  Quantity: number;
  Name?: string;
}

interface Brand {
  id: string;
  prefix: string;
  prefix_style: "hyphen" | "slash";
}

function resolveBrandFromSKU(sku: string, brands: Brand[]): string | null {
  for (const brand of brands) {
    const separator = brand.prefix_style === "slash" ? "/" : "-";
    const pattern = `${brand.prefix}${separator}`;
    if (sku.toUpperCase().startsWith(pattern.toUpperCase())) return brand.id;
  }
  return null;
}

function isDirtySku(sku: string): boolean {
  return !/^[A-Za-z]{2,4}[-\/]/.test(sku);
}

async function fetchOrderItems(baseUrl: string, apiKey: string, orderId: number): Promise<MintsoftOrderItem[]> {
  const resp = await fetch(`${baseUrl}/api/Order/${orderId}/Items`, {
    headers: { "ms-apikey": apiKey, "Content-Type": "application/json" },
  });
  if (!resp.ok) return [];
  return await resp.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("Starting Mintsoft orders sync...");
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    const { data: settings } = await supabase.from("mintsoft_settings").select("base_url, dispatched_status_ids").limit(1).single();
    if (!settings) throw new Error("Mintsoft settings not found");

    const dispatchedStatusIds = settings.dispatched_status_ids || [40];
    const mintsoftApiKey = Deno.env.get("MINTSOFT_API_KEY");
    if (!mintsoftApiKey) throw new Error("MINTSOFT_API_KEY not configured");

    const MIN_DATE = new Date('2026-01-01T00:00:00Z');
    let isBackfill = false;
    let fromDate: string;
    let backfillLimit = 0;
    // Default for cron live-tail: last 1 day (Mintsoft API only filters by date, not time)
    const defaultLiveTailFromDate = () => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().split('T')[0];
    };
    try {
      const body = await req.json();
      // Treat null / "null" / missing fromDate as live-tail default
      fromDate = (body && body.fromDate && body.fromDate !== 'null')
        ? body.fromDate
        : defaultLiveTailFromDate();
      isBackfill = body.backfill === true;
      backfillLimit = body.backfillLimit || 50;
    } catch {
      fromDate = defaultLiveTailFromDate();
    }

    // Backfill mode: read cursor from ingest_run_state, work backward
    if (isBackfill) {
      const { data: cursorRow } = await supabase
        .from("ingest_run_state")
        .select("last_status")
        .eq("id", "order_backfill_cursor")
        .single();

      const cursorDate = cursorRow?.last_status ? new Date(cursorRow.last_status) : new Date();
      if (cursorDate <= MIN_DATE) {
        console.log("Backfill complete — cursor has reached 2026-01-01");
        return new Response(JSON.stringify({ success: true, backfill_complete: true, message: "Backfill already complete" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Go back 6 hours per run
      const backfillFrom = new Date(cursorDate.getTime() - 6 * 60 * 60 * 1000);
      const clampedFrom = backfillFrom < MIN_DATE ? MIN_DATE : backfillFrom;
      fromDate = clampedFrom.toISOString().split('T')[0];
      console.log(`Backfill mode: ${clampedFrom.toISOString()} → ${cursorDate.toISOString()} (limit ${backfillLimit})`);
    }

    let fromDateObj = new Date(`${fromDate}T00:00:00Z`);
    // Enforce hard boundary
    if (fromDateObj < MIN_DATE) fromDateObj = MIN_DATE;

    // LIVE-TAIL MODE (default cron): ignore OrderDate filter entirely so we
    // refresh ALL non-terminal orders regardless of age. This is the only way
    // to detect orders that Mintsoft has since despatched / cancelled but were
    // placed weeks ago. Backfill mode keeps the date filter so it can sweep
    // a defined window.
    const ignoreDateFilter = !isBackfill;
    if (ignoreDateFilter) {
      console.log(`Live-tail: pulling ALL non-terminal orders (ignoring OrderDate filter)`);
    } else {
      console.log(`Backfill mode: filtering orders since ${fromDateObj.toISOString().split('T')[0]}`);
    }

    const { data: brands, error: brandsError } = await supabase.from("brands").select("id, prefix, prefix_style");
    if (brandsError) throw brandsError;
    if (!brands?.length) throw new Error("No brands found");

    // Fetch ALL Mintsoft statuses for lookup AND to know which status IDs to query
    const statusLookup = new Map<number, string>();
    const activeStatusIds: number[] = [];
    const terminalNames = ['despatched', 'dispatched', 'cancelled', 'completed', 'delivered', 'refunded', 'returned', 'closed'];
    try {
      const statusResp = await fetch(`${settings.base_url}/api/Order/Statuses`, {
        headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
      });
      if (statusResp.ok) {
        const statuses = await statusResp.json();
        for (const s of statuses) {
          if (s.ID && s.ExternalName) statusLookup.set(s.ID, s.ExternalName);
          // Only fetch headers for non-terminal statuses to avoid timeout
          const isTerminal = terminalNames.some(t => (s.ExternalName || '').toLowerCase().includes(t));
          if (s.ID && s.Active !== false && !isTerminal) activeStatusIds.push(s.ID);
        }
        console.log(`Loaded ${statusLookup.size} status names, fetching ${activeStatusIds.length} non-terminal statuses`);
      }
    } catch (e) { console.error("Failed to fetch status names:", e); }

    // If we couldn't fetch statuses, fall back to configured IDs
    const statusIdsToFetch = activeStatusIds.length > 0 ? activeStatusIds : dispatchedStatusIds;

    // 1. Fetch order headers across ALL statuses
    let allOrders: MintsoftOrder[] = [];
    const seenOrderIds = new Set<number>();
    
      let timedOut = false;
      for (const statusId of statusIdsToFetch) {
        if (isTimeRunningOut()) { timedOut = true; break; }
        let pageNo = 1;
        while (true) {
          const resp = await fetch(`${settings.base_url}/api/Order/List?OrderStatusId=${statusId}&Limit=100&PageNo=${pageNo}`, {
            headers: { "ms-apikey": mintsoftApiKey, "Content-Type": "application/json" },
          });
          if (!resp.ok) break;
          const orders: MintsoftOrder[] = await resp.json();
          if (orders.length === 0) break;
          const filtered = orders.filter(o => {
            if (seenOrderIds.has(o.ID)) return false;
            // Honor MIN_DATE always; honor fromDate only in backfill mode
            const orderDateObj = new Date(o.OrderDate);
            if (orderDateObj < MIN_DATE) return false;
            if (!ignoreDateFilter && orderDateObj < fromDateObj) return false;
            seenOrderIds.add(o.ID);
            return true;
          });
          allOrders = allOrders.concat(filtered);
          if (orders.length < 100 || pageNo >= 50) break;
          pageNo++;
        }
      }
      console.log(`Fetched ${allOrders.length} order headers across ${statusIdsToFetch.length} statuses${timedOut ? ' (partial - timed out)' : ''}`);

    // 2. Find which orders we already have lines for
    const orderIds = [...new Set(allOrders.map(o => o.ID))];
    const knownOrderIds = new Set<number>();
    const existingLineMap = new Map<string, { order_status: string | null; order_status_id: number | null; times_seen: number; sku: string; qty: number; order_date: string; channel: string | null; channel_order_ref: string | null; warehouse_id: string | null; brand_id: string | null; product_name: string | null }>();
    
    for (let i = 0; i < orderIds.length; i += 500) {
      const batch = orderIds.slice(i, i + 500);
      const { data: existing } = await supabase
        .from("order_lines")
        .select("mintsoft_order_id, line_index, order_status, order_status_id, times_seen, sku, qty, order_date, channel, channel_order_ref, warehouse_id, brand_id, product_name")
        .in("mintsoft_order_id", batch);
      for (const line of existing || []) {
        knownOrderIds.add(line.mintsoft_order_id);
        existingLineMap.set(`${line.mintsoft_order_id}-${line.line_index}`, {
          order_status: line.order_status,
          order_status_id: line.order_status_id,
          times_seen: line.times_seen || 1,
          sku: line.sku,
          qty: line.qty,
          order_date: line.order_date,
          channel: line.channel,
          channel_order_ref: line.channel_order_ref,
          warehouse_id: line.warehouse_id,
          brand_id: line.brand_id,
          product_name: line.product_name,
        });
      }
    }

    const newOrders = allOrders.filter(o => !knownOrderIds.has(o.ID));
    const existingOrders = allOrders.filter(o => knownOrderIds.has(o.ID));
    console.log(`${newOrders.length} new orders need item fetch, ${existingOrders.length} existing orders for status update`);

    const now = new Date().toISOString();
    let linesProcessed = 0, linesInserted = 0, linesSkipped = 0, productsCreated = 0;

    // 3. For EXISTING orders — bulk update status fields
    if (existingOrders.length > 0) {
      const updatePayloads: Record<string, unknown>[] = [];
      for (const order of existingOrders) {
        const lineKeys = [...existingLineMap.keys()].filter(k => k.startsWith(`${order.ID}-`));
        const newStatusName = extractStatusName(order, statusLookup);
        
        for (const key of lineKeys) {
          const existing = existingLineMap.get(key)!;
          const [, lineIndexStr] = key.split('-');
          
          // Detect if status actually changed
          const oldStatus = existing.order_status;
          const statusChanged = newStatusName !== oldStatus;
          
          const payload: Record<string, unknown> = {
            mintsoft_order_id: order.ID,
            line_index: parseInt(lineIndexStr),
            sku: existing.sku,
            qty: existing.qty,
            order_date: existing.order_date,
            channel: existing.channel,
            channel_order_ref: existing.channel_order_ref,
            warehouse_id: existing.warehouse_id,
            brand_id: existing.brand_id,
            product_name: existing.product_name,
            last_seen_at: now,
            times_seen: (existing.times_seen || 1) + 1,
            order_status: newStatusName,
             order_status_id: order.OrderStatusId ?? null,
            customer_name: order.CustomerName || null,
            tracking_number: (order as any).TrackingNo || (order as any).Consignment || (order as any).TrackingNumber || existing.tracking_number || null,
          };
          if (statusChanged) {
            payload.last_status_change_at = now;
            // Track backorder recovery
            if (oldStatus && oldStatus.toUpperCase().includes('BACKORDER') && newStatusName && !newStatusName.toUpperCase().includes('BACKORDER')) {
              payload.was_backordered = true;
              payload.last_backordered_at = now;
            }
          }
          updatePayloads.push(payload);
        }
      }
      
      for (let i = 0; i < updatePayloads.length; i += 500) {
        const batch = updatePayloads.slice(i, i + 500);
        const { error } = await supabase.from("order_lines").upsert(batch, { onConflict: "mintsoft_order_id,line_index" });
        if (error) console.error("Status update error:", error);
        else linesInserted += batch.length;
      }
      console.log(`Updated ${linesInserted} existing lines with status info`);
    }

    // 4. For NEW orders — fetch items and create lines
    const CONCURRENCY = 25;
    const CHUNK = 50;

    let earlyExit = false;
    for (let c = 0; c < newOrders.length; c += CHUNK) {
      if (isTimeRunningOut()) { earlyExit = true; console.log("Time limit approaching, saving progress..."); break; }
      const chunk = newOrders.slice(c, c + CHUNK);

      const itemsMap = new Map<number, MintsoftOrderItem[]>();
      for (let i = 0; i < chunk.length; i += CONCURRENCY) {
        if (isTimeRunningOut()) { earlyExit = true; break; }
        const batch = chunk.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(async o => ({
          id: o.ID,
          items: await fetchOrderItems(settings.base_url, mintsoftApiKey, o.ID),
        })));
        for (const r of results) itemsMap.set(r.id, r.items);
      }
      if (earlyExit) break;

      const upsertPayloads: Record<string, unknown>[] = [];
      const newSkus: { sku: string; brand_id: string | null; quarantined: boolean }[] = [];

      for (const order of chunk) {
        const items = itemsMap.get(order.ID) || [];
        let lineIndex = 1;
        for (const item of items) {
          linesProcessed++;
          const brandId = resolveBrandFromSKU(item.SKU, brands);
          const dirty = isDirtySku(item.SKU);
          newSkus.push({ sku: item.SKU, brand_id: brandId, quarantined: dirty });

          upsertPayloads.push({
            mintsoft_order_id: order.ID,
            line_index: lineIndex,
            sku: item.SKU,
            qty: item.Quantity,
            order_date: order.OrderDate,
            channel: order.Channel?.Name || null,
            channel_order_ref: order.ExternalOrderReference || null,
            warehouse_id: order.WarehouseId?.toString() || null,
            brand_id: brandId,
            order_status: extractStatusName(order, statusLookup),
            order_status_id: order.OrderStatusId ?? null,
             product_name: item.Name || null,
            customer_name: order.CustomerName || null,
            tracking_number: (order as any).TrackingNo || (order as any).Consignment || (order as any).TrackingNumber || null,
            first_seen_at: now,
            last_seen_at: now,
            last_status_change_at: now,
            times_seen: 1,
          });
          lineIndex++;
        }
      }

      // Auto-create products
      const uniqueSkus = [...new Map(newSkus.map(s => [s.sku, s])).values()];
      if (uniqueSkus.length > 0) {
        const { data: ep } = await supabase.from("products_cache").select("sku").in("sku", uniqueSkus.map(s => s.sku));
        const existSet = new Set((ep || []).map(p => p.sku));
        const np = uniqueSkus.filter(s => !existSet.has(s.sku)).map(s => ({
          sku: s.sku,
          name: s.sku,
          brand_id: s.brand_id,
          discovery_source: s.quarantined ? 'order_dirty' : 'order',
          quarantined: s.quarantined,
        }));
        if (np.length > 0) {
          const { error } = await supabase.from("products_cache").upsert(np, { onConflict: 'sku', ignoreDuplicates: true });
          if (!error) productsCreated += np.length;
          else console.error("Product create error:", error);
        }
      }

      if (upsertPayloads.length > 0) {
        const { error } = await supabase.from("order_lines").upsert(upsertPayloads, { onConflict: "mintsoft_order_id,line_index" });
        if (error) console.error("Upsert error:", error);
        else linesInserted += upsertPayloads.length;
      }

      console.log(`Chunk ${c + CHUNK}/${newOrders.length}: ${linesInserted} lines saved so far`);
    }

    console.log(`Done. Lines: ${linesInserted}, Skipped: ${linesSkipped}, Products: ${productsCreated}`);

    // RECONCILIATION PASS — only if this was a complete live-tail run.
    // Any order_lines row currently in NEW/AWAITINGPICKING/ONBACKORDER that
    // was NOT returned by Mintsoft this pass is presumed despatched/closed.
    // We mark it as DESPATCHED so dashboards reflect reality.
    let ghostsClosed = 0;
    if (ignoreDateFilter && !isBackfill && !timedOut && !earlyExit && seenOrderIds.size > 0) {
      const seenIds = [...seenOrderIds];
      // Page through DB in chunks — IDs not in the latest sync get auto-closed
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: openRows, error: openErr } = await supabase
          .from("order_lines")
          .select("id, mintsoft_order_id, order_status")
          .in("order_status", ["NEW", "AWAITINGPICKING", "ONBACKORDER"])
          .gte("order_date", "2026-01-01T00:00:00Z")
          .order("id", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (openErr) { console.error("Reconcile fetch error:", openErr); break; }
        if (!openRows || openRows.length === 0) break;

        const seenSet = new Set(seenIds);
        const ghostIds = openRows
          .filter(r => !seenSet.has(r.mintsoft_order_id))
          .map(r => r.id);

        if (ghostIds.length > 0) {
          for (let i = 0; i < ghostIds.length; i += 500) {
            const batch = ghostIds.slice(i, i + 500);
            const { error: upErr } = await supabase
              .from("order_lines")
              .update({
                order_status: "DESPATCHED",
                last_status_change_at: now,
                last_seen_at: now,
              })
              .in("id", batch);
            if (upErr) console.error("Reconcile update error:", upErr);
            else ghostsClosed += batch.length;
          }
        }

        if (openRows.length < PAGE) break;
        offset += PAGE;
        if (isTimeRunningOut()) { console.log("Reconcile pass timed out"); break; }
      }
      console.log(`Reconciliation: closed ${ghostsClosed} ghost order lines`);
    }

    // Fire-and-forget: trigger issue evaluation without awaiting (prevents sync timeout)
    if (!earlyExit) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/evaluate-order-issues`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ triggered_by: "sync-mintsoft-orders" }),
      }).catch(e => console.error("eval trigger failed:", e));
    }

    // Update backfill cursor if in backfill mode
    if (isBackfill) {
      const newCursor = fromDateObj.toISOString();
      await supabase.from("ingest_run_state").upsert({
        id: "order_backfill_cursor",
        last_run_at: new Date().toISOString(),
        last_ok_at: new Date().toISOString(),
        last_status: newCursor,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      console.log(`Backfill cursor updated to ${newCursor}`);
    }

    const partial = earlyExit ? " (partial — run again to continue)" : "";
    return new Response(JSON.stringify({
      success: true,
      partial: earlyExit,
      backfill: isBackfill,
      orders_fetched: allOrders.length,
      new_orders: newOrders.length,
      existing_orders_updated: existingOrders.length,
      lines_inserted: linesInserted,
      lines_skipped: linesSkipped,
      products_created: productsCreated,
      statuses_queried: statusIdsToFetch.length,
      message: `Synced ${allOrders.length} orders across ${statusIdsToFetch.length} statuses (${newOrders.length} new, ${existingOrders.length} updated)${partial}`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Orders sync error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
