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

interface IssueUpsert {
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

const TERMINAL_STATUS_NAMES = ['dispatched', 'despatched', 'shipped', 'cancelled', 'refunded', 'completed', 'closed'];
const BACKORDER_KEYWORDS = ['back order', 'backorder'];

function isTerminalStatus(statusName: string | null): boolean {
  if (!statusName) return false;
  const lower = statusName.toLowerCase();
  return TERMINAL_STATUS_NAMES.some(t => lower.includes(t));
}

function isNewStatus(statusName: string | null): boolean {
  if (!statusName) return false;
  return statusName.toLowerCase().trim() === 'new';
}

function isBackOrderStatus(statusName: string | null): boolean {
  if (!statusName) return false;
  const lower = statusName.toLowerCase();
  return BACKORDER_KEYWORDS.some(k => lower.includes(k));
}

function isAwaitingPickingStatus(statusName: string | null): boolean {
  if (!statusName) return false;
  return statusName.toLowerCase().includes('awaiting picking');
}

function hoursAgo(dateStr: string | null): number {
  if (!dateStr) return 0;
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60);
}

function getSeverityForAge(hours: number, thresholds: [number, number, number]): string | null {
  if (hours >= thresholds[2]) return 'critical';
  if (hours >= thresholds[1]) return 'problem';
  if (hours >= thresholds[0]) return 'watch';
  return null;
}

function suggestAction(problemType: string, line: OrderLine): string {
  switch (problemType) {
    case 'new_stuck':
      return 'Check warehouse for pick availability. If stock exists, investigate pick queue. If not, move to backorder.';
    case 'stalled_progress':
      if (isAwaitingPickingStatus(line.order_status)) return 'Investigate pick failure — check physical stock location and picker queue.';
      return 'Review order status in warehouse system. Consider escalating if no progress.';
    case 'repeated_snapshot':
      return 'Order is repeatedly appearing without progress. Check for system or stock issue preventing fulfilment.';
    case 'stock_discrepancy_suspected':
      return 'Multiple orders stuck on this SKU — verify physical stock count matches system. Consider stock adjustment.';
    default:
      return 'Review order and take appropriate action.';
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Starting order issue evaluation...");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const now = new Date().toISOString();

    // Get dispatched status IDs for auto-resolution
    const { data: settings } = await supabase
      .from("mintsoft_settings")
      .select("dispatched_status_ids")
      .limit(1)
      .single();
    const dispatchedStatusIds = settings?.dispatched_status_ids || [40];

    // Clear expired suppressions
    await supabase
      .from("order_issues")
      .update({ is_suppressed: false, suppressed_until: null })
      .lt("suppressed_until", now)
      .eq("is_suppressed", true);

    // Fetch all order lines from last 14 days
    const lookbackDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    let orderLines: OrderLine[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("order_lines")
        .select("mintsoft_order_id, line_index, sku, brand_id, order_date, order_status, order_status_id, first_seen_at, last_seen_at, times_seen, last_status_change_at")
        .gte("order_date", lookbackDate)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      orderLines = orderLines.concat(data || []);
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }

    if (!orderLines || orderLines.length === 0) {
      console.log("No order lines to evaluate");
      return new Response(JSON.stringify({ success: true, issues_created: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Evaluating ${orderLines.length} order lines...`);

    const issuesToUpsert: IssueUpsert[] = [];
    const skuProblemCounts: Record<string, number> = {};

    // === AUTO-RESOLUTION ===
    // 1. Terminal statuses (dispatched, cancelled, etc.)
    const terminalLines = orderLines.filter(l => isTerminalStatus(l.order_status));
    for (const line of terminalLines) {
      const resType = line.order_status?.toLowerCase().includes("cancel") ? "cancelled" : 
                      line.order_status?.toLowerCase().includes("despatch") || line.order_status?.toLowerCase().includes("dispatch") ? "dispatched" : "condition_cleared";
      await supabase
        .from("order_issues")
        .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: resType })
        .eq("mintsoft_order_id", line.mintsoft_order_id)
        .eq("line_index", line.line_index)
        .eq("is_suppressed", false)
        .in("issue_status", ["open", "in_review"]);
    }

    // 2. Left active feed — orders not seen in 48h+
    const { data: staleIssues } = await supabase
      .from("order_issues")
      .select("mintsoft_order_id, line_index")
      .in("issue_status", ["open", "in_review"])
      .eq("is_suppressed", false);

    if (staleIssues) {
      for (const issue of staleIssues) {
        const matchingLine = orderLines.find(
          l => l.mintsoft_order_id === issue.mintsoft_order_id && l.line_index === issue.line_index
        );
        if (matchingLine) {
          const lastSeenHours = hoursAgo(matchingLine.last_seen_at);
          if (lastSeenHours > 48) {
            await supabase
              .from("order_issues")
              .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: "left_feed" })
              .eq("mintsoft_order_id", issue.mintsoft_order_id)
              .eq("line_index", issue.line_index)
              .eq("is_suppressed", false)
              .in("issue_status", ["open", "in_review"]);
          }
        }
      }
    }

    // === ISSUE DETECTION (only non-terminal, non-backorder lines) ===
    const activeLines = orderLines.filter(
      l => !isTerminalStatus(l.order_status) && !isBackOrderStatus(l.order_status)
    );

    // Build a map of lines that WERE on backorder previously (status changed from backorder to something else)
    // We detect this by: current status is NOT backorder, but the order is relatively young (grace period)
    // Since we can't track previous status directly, we use last_status_change_at as a proxy:
    // If status changed recently (< 8h ago), apply a grace period for lines that may have just come off backorder
    
    for (const line of activeLines) {
      const orderAgeHours = hoursAgo(line.order_date);
      const statusAgeHours = hoursAgo(line.last_status_change_at);
      const timesSeen = line.times_seen || 1;

      // Backorder grace period: if status changed very recently (< 8h), 
      // the order may have just come off backorder — don't flag as stuck yet
      const recentStatusChange = statusAgeHours < 8;

      // Rule 1 — New Order Stuck (skip if status changed recently — possible backorder recovery)
      if (isNewStatus(line.order_status) && !recentStatusChange) {
        const severity = getSeverityForAge(orderAgeHours, [4, 12, 24]);
        if (severity) {
          issuesToUpsert.push({
            mintsoft_order_id: line.mintsoft_order_id,
            line_index: line.line_index,
            sku: line.sku,
            brand_id: line.brand_id,
            problem_type: "new_stuck",
            severity,
            reason: `NEW order has not progressed for ${Math.round(orderAgeHours)}h (status unchanged for ${Math.round(statusAgeHours)}h)`,
            last_problem_seen_at: now,
            suggested_action: suggestAction('new_stuck', line),
          });
          skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
        }
      }

      // Rule 2 — Stalled Progress (primary signal: last_status_change_at age)
      if (!isNewStatus(line.order_status) && statusAgeHours >= 12) {
        const severity = getSeverityForAge(statusAgeHours, [12, 24, 48]);
        if (severity) {
          const evidence = timesSeen > 1 ? ` Seen ${timesSeen}× across syncs.` : "";
          issuesToUpsert.push({
            mintsoft_order_id: line.mintsoft_order_id,
            line_index: line.line_index,
            sku: line.sku,
            brand_id: line.brand_id,
            problem_type: "stalled_progress",
            severity,
            reason: `Status "${line.order_status || 'unknown'}" unchanged for ${Math.round(statusAgeHours)}h.${evidence}`,
            last_problem_seen_at: now,
            suggested_action: suggestAction('stalled_progress', line),
          });
          skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
        }
      }

      // Rule 3 — Repeated Without Progress (requires BOTH times_seen >= 3 AND status age > 12h)
      if (timesSeen >= 3 && statusAgeHours > 12) {
        issuesToUpsert.push({
          mintsoft_order_id: line.mintsoft_order_id,
          line_index: line.line_index,
          sku: line.sku,
          brand_id: line.brand_id,
          problem_type: "repeated_snapshot",
          severity: timesSeen >= 8 ? "critical" : timesSeen >= 4 ? "problem" : "watch",
          reason: `Seen ${timesSeen}× across snapshots with no status change for ${Math.round(statusAgeHours)}h`,
          last_problem_seen_at: now,
          suggested_action: suggestAction('repeated_snapshot', line),
        });
        skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
      }
    }

    // Rule 4 — SKU Clustering (advisory only, capped at watch)
    for (const [sku, count] of Object.entries(skuProblemCounts)) {
      if (count >= 3) {
        const affectedLines = activeLines.filter(l => l.sku === sku);
        for (const line of affectedLines) {
          issuesToUpsert.push({
            mintsoft_order_id: line.mintsoft_order_id,
            line_index: line.line_index,
            sku: line.sku,
            brand_id: line.brand_id,
            problem_type: "stock_discrepancy_suspected",
            severity: "watch",
            reason: `SKU ${sku} appears in ${count} flagged orders — possible stock integrity issue`,
            last_problem_seen_at: now,
            suggested_action: suggestAction('stock_discrepancy_suspected', line),
          });
        }
      }
    }

    // === UPSERT ISSUES ===
    let issuesCreated = 0;
    let issuesUpdated = 0;

    for (const issue of issuesToUpsert) {
      const { data: existing } = await supabase
        .from("order_issues")
        .select("id, severity, is_suppressed, issue_status")
        .eq("mintsoft_order_id", issue.mintsoft_order_id)
        .eq("line_index", issue.line_index)
        .eq("problem_type", issue.problem_type)
        .maybeSingle();

      if (existing) {
        if (existing.is_suppressed) continue;
        if (["auto_resolved", "resolved", "ignored"].includes(existing.issue_status)) continue;

        const severityRank: Record<string, number> = { watch: 1, problem: 2, critical: 3 };
        const newRank = severityRank[issue.severity] || 0;
        const existingRank = severityRank[existing.severity] || 0;

        const updatePayload: Record<string, unknown> = {
          last_problem_seen_at: now,
          reason: issue.reason,
        };
        if (newRank > existingRank) updatePayload.severity = issue.severity;

        await supabase.from("order_issues").update(updatePayload).eq("id", existing.id);
        issuesUpdated++;
      } else {
        const { error: insertErr } = await supabase.from("order_issues").insert({
          mintsoft_order_id: issue.mintsoft_order_id,
          line_index: issue.line_index,
          sku: issue.sku,
          brand_id: issue.brand_id,
          problem_type: issue.problem_type,
          severity: issue.severity,
          reason: issue.reason,
          last_problem_seen_at: now,
          first_problem_seen_at: now,
          issue_status: "open",
        });
        if (!insertErr) issuesCreated++;
      }
    }

    // Auto-resolve issues where condition no longer applies
    const { data: openIssues } = await supabase
      .from("order_issues")
      .select("id, mintsoft_order_id, line_index, problem_type")
      .in("issue_status", ["open", "in_review"])
      .eq("is_suppressed", false);

    if (openIssues) {
      for (const openIssue of openIssues) {
        const stillFlagged = issuesToUpsert.some(
          i => i.mintsoft_order_id === openIssue.mintsoft_order_id &&
               i.line_index === openIssue.line_index &&
               i.problem_type === openIssue.problem_type
        );
        if (!stillFlagged) {
          await supabase
            .from("order_issues")
            .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: "condition_cleared" })
            .eq("id", openIssue.id);
        }
      }
    }

    console.log(`Evaluation complete. Created: ${issuesCreated}, Updated: ${issuesUpdated}`);

    return new Response(
      JSON.stringify({ success: true, issues_created: issuesCreated, issues_updated: issuesUpdated, lines_evaluated: orderLines.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Evaluate order issues error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
