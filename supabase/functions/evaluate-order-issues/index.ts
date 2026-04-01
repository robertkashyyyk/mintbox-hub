import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrderLine {
  mintsoft_order_id: number;
  line_index: number;
  sku: string;
  brand_id: string | null;
  order_date: string;
  order_status: string | null;
  order_status_id: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  times_seen: number | null;
  last_status_change_at: string | null;
}

interface IssueCandidate {
  mintsoft_order_id: number;
  line_index: number;
  sku: string;
  brand_id: string | null;
  problem_type: string;
  severity: string;
  reason: string;
  last_problem_seen_at: string;
  suggested_action: string;
}

const TERMINAL_KEYWORDS = ['dispatched', 'despatched', 'shipped', 'cancelled', 'refunded', 'completed', 'closed', 'delivered', 'returned'];
const BACKORDER_KEYWORDS = ['back order', 'backorder'];

function isTerminalStatus(s: string | null): boolean {
  if (!s) return false;
  const l = s.toLowerCase();
  return TERMINAL_KEYWORDS.some(t => l.includes(t));
}
function isNewStatus(s: string | null): boolean {
  return s?.toLowerCase().trim() === 'new';
}
function isBackOrderStatus(s: string | null): boolean {
  if (!s) return false;
  const l = s.toLowerCase();
  return BACKORDER_KEYWORDS.some(k => l.includes(k));
}
function hoursAgo(d: string | null): number {
  if (!d) return 0;
  return (Date.now() - new Date(d).getTime()) / 3_600_000;
}
function getSeverity(hours: number, thresholds: [number, number, number]): string | null {
  if (hours >= thresholds[2]) return 'critical';
  if (hours >= thresholds[1]) return 'problem';
  if (hours >= thresholds[0]) return 'watch';
  return null;
}

function suggestAction(type: string, status: string | null): string {
  switch (type) {
    case 'new_stuck': return 'Check warehouse for pick availability. If stock exists, investigate pick queue. If not, move to backorder.';
    case 'stalled_progress':
      if (status?.toLowerCase().includes('awaiting picking')) return 'Investigate pick failure — check physical stock location and picker queue.';
      return 'Review order status in warehouse system. Consider escalating if no progress.';
    case 'repeated_snapshot': return 'Order repeatedly appearing without progress. Check for system or stock issue.';
    case 'stock_discrepancy_suspected': return 'Multiple orders stuck on this SKU — verify physical stock count. Consider stock adjustment.';
    default: return 'Review order and take appropriate action.';
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    console.log("Starting order issue evaluation...");
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    const now = new Date().toISOString();

    // Clear expired suppressions
    await supabase
      .from("order_issues")
      .update({ is_suppressed: false, suppressed_until: null })
      .lt("suppressed_until", now)
      .eq("is_suppressed", true);

    // Fetch order lines from last 14 days (paginated)
    const lookback = new Date(Date.now() - 14 * 86_400_000).toISOString();
    let orderLines: OrderLine[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("order_lines")
        .select("mintsoft_order_id, line_index, sku, brand_id, order_date, order_status, order_status_id, first_seen_at, last_seen_at, times_seen, last_status_change_at")
        .gte("order_date", lookback)
        .range(from, from + 999);
      if (error) throw error;
      orderLines = orderLines.concat(data || []);
      if (!data || data.length < 1000) break;
      from += 1000;
    }

    console.log(`Evaluating ${orderLines.length} order lines...`);
    if (orderLines.length === 0) {
      return new Response(JSON.stringify({ success: true, issues_created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch ALL existing open issues upfront (avoid N+1)
    let existingIssues: { id: string; mintsoft_order_id: number; line_index: number; problem_type: string; severity: string; is_suppressed: boolean; issue_status: string }[] = [];
    from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("order_issues")
        .select("id, mintsoft_order_id, line_index, problem_type, severity, is_suppressed, issue_status")
        .in("issue_status", ["open", "in_review", "waiting_stock"])
        .range(from, from + 999);
      if (error) throw error;
      existingIssues = existingIssues.concat(data || []);
      if (!data || data.length < 1000) break;
      from += 1000;
    }

    // Build lookup map: "orderId-lineIndex-problemType" -> issue
    const issueMap = new Map<string, typeof existingIssues[0]>();
    for (const iss of existingIssues) {
      issueMap.set(`${iss.mintsoft_order_id}-${iss.line_index}-${iss.problem_type}`, iss);
    }

    // === AUTO-RESOLVE terminal statuses in batch ===
    const terminalOrderIds = orderLines
      .filter(l => isTerminalStatus(l.order_status))
      .map(l => l.mintsoft_order_id);
    
    if (terminalOrderIds.length > 0) {
      const uniqueTerminal = [...new Set(terminalOrderIds)];
      for (let i = 0; i < uniqueTerminal.length; i += 500) {
        await supabase
          .from("order_issues")
          .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: "dispatched" })
          .in("mintsoft_order_id", uniqueTerminal.slice(i, i + 500))
          .eq("is_suppressed", false)
          .in("issue_status", ["open", "in_review"]);
      }
    }

    // === DETECT ISSUES (non-terminal, non-backorder only) ===
    const activeLines = orderLines.filter(l => !isTerminalStatus(l.order_status) && !isBackOrderStatus(l.order_status));
    const candidates: IssueCandidate[] = [];
    const skuProblemCounts: Record<string, number> = {};

    for (const line of activeLines) {
      const orderAge = hoursAgo(line.order_date);
      const statusAge = hoursAgo(line.last_status_change_at);
      const timesSeen = line.times_seen || 1;
      const recentChange = statusAge < 8;

      // Rule 1: New Stuck
      if (isNewStatus(line.order_status) && !recentChange) {
        const sev = getSeverity(orderAge, [4, 12, 24]);
        if (sev) {
          candidates.push({
            mintsoft_order_id: line.mintsoft_order_id, line_index: line.line_index,
            sku: line.sku, brand_id: line.brand_id, problem_type: "new_stuck", severity: sev,
            reason: `NEW order not progressed for ${Math.round(orderAge)}h (status unchanged ${Math.round(statusAge)}h)`,
            last_problem_seen_at: now, suggested_action: suggestAction('new_stuck', line.order_status),
          });
          skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
        }
      }

      // Rule 2: Stalled Progress
      if (!isNewStatus(line.order_status) && statusAge >= 12) {
        const sev = getSeverity(statusAge, [12, 24, 48]);
        if (sev) {
          const extra = timesSeen > 1 ? ` Seen ${timesSeen}× across syncs.` : "";
          candidates.push({
            mintsoft_order_id: line.mintsoft_order_id, line_index: line.line_index,
            sku: line.sku, brand_id: line.brand_id, problem_type: "stalled_progress", severity: sev,
            reason: `Status "${line.order_status || 'unknown'}" unchanged for ${Math.round(statusAge)}h.${extra}`,
            last_problem_seen_at: now, suggested_action: suggestAction('stalled_progress', line.order_status),
          });
          skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
        }
      }

      // Rule 3: Repeated Without Progress
      if (timesSeen >= 3 && statusAge > 12) {
        candidates.push({
          mintsoft_order_id: line.mintsoft_order_id, line_index: line.line_index,
          sku: line.sku, brand_id: line.brand_id, problem_type: "repeated_snapshot",
          severity: timesSeen >= 8 ? "critical" : timesSeen >= 4 ? "problem" : "watch",
          reason: `Seen ${timesSeen}× with no status change for ${Math.round(statusAge)}h`,
          last_problem_seen_at: now, suggested_action: suggestAction('repeated_snapshot', line.order_status),
        });
        skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
      }
    }

    // Rule 4: SKU clustering (advisory)
    for (const [sku, count] of Object.entries(skuProblemCounts)) {
      if (count >= 3) {
        for (const line of activeLines.filter(l => l.sku === sku)) {
          candidates.push({
            mintsoft_order_id: line.mintsoft_order_id, line_index: line.line_index,
            sku, brand_id: line.brand_id, problem_type: "stock_discrepancy_suspected", severity: "watch",
            reason: `SKU ${sku} appears in ${count} flagged orders — possible stock integrity issue`,
            last_problem_seen_at: now, suggested_action: suggestAction('stock_discrepancy_suspected', line.order_status),
          });
        }
      }
    }

    console.log(`Detected ${candidates.length} issue candidates`);

    // === BATCH UPSERT ===
    const sevRank: Record<string, number> = { watch: 1, problem: 2, critical: 3 };
    const toInsert: Record<string, unknown>[] = [];
    const toUpdate: { id: string; payload: Record<string, unknown> }[] = [];
    const candidateKeys = new Set<string>();

    for (const c of candidates) {
      const key = `${c.mintsoft_order_id}-${c.line_index}-${c.problem_type}`;
      candidateKeys.add(key);
      const existing = issueMap.get(key);

      if (existing) {
        if (existing.is_suppressed) continue;
        if (["auto_resolved", "resolved", "ignored"].includes(existing.issue_status)) continue;
        const payload: Record<string, unknown> = { last_problem_seen_at: now, reason: c.reason };
        if ((sevRank[c.severity] || 0) > (sevRank[existing.severity] || 0)) payload.severity = c.severity;
        toUpdate.push({ id: existing.id, payload });
      } else {
        toInsert.push({
          mintsoft_order_id: c.mintsoft_order_id, line_index: c.line_index, sku: c.sku,
          brand_id: c.brand_id, problem_type: c.problem_type, severity: c.severity,
          reason: c.reason, last_problem_seen_at: now, first_problem_seen_at: now, issue_status: "open",
        });
      }
    }

    // Batch insert new issues
    let issuesCreated = 0;
    for (let i = 0; i < toInsert.length; i += 200) {
      const batch = toInsert.slice(i, i + 200);
      const { error } = await supabase.from("order_issues").insert(batch);
      if (!error) issuesCreated += batch.length;
      else console.error("Insert batch error:", error.message);
    }

    // Batch update existing issues
    let issuesUpdated = 0;
    for (const { id, payload } of toUpdate) {
      await supabase.from("order_issues").update(payload).eq("id", id);
      issuesUpdated++;
    }

    // Auto-resolve issues where condition no longer applies
    let autoResolved = 0;
    for (const existing of existingIssues) {
      const key = `${existing.mintsoft_order_id}-${existing.line_index}-${existing.problem_type}`;
      if (!candidateKeys.has(key) && !existing.is_suppressed) {
        await supabase
          .from("order_issues")
          .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: "condition_cleared" })
          .eq("id", existing.id);
        autoResolved++;
      }
    }

    console.log(`Done. Created: ${issuesCreated}, Updated: ${issuesUpdated}, Auto-resolved: ${autoResolved}`);

    return new Response(
      JSON.stringify({ success: true, issues_created: issuesCreated, issues_updated: issuesUpdated, auto_resolved: autoResolved, lines_evaluated: orderLines.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Evaluate error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
