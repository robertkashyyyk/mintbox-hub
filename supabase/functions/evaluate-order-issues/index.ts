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
}

// Terminal statuses that indicate order is done (text-based)
const TERMINAL_STATUS_NAMES = ['dispatched', 'despatched', 'shipped', 'cancelled', 'refunded', 'completed', 'closed'];

function isTerminalStatus(statusName: string | null, statusId: number | null, dispatchedIds: number[]): boolean {
  if (statusId && dispatchedIds.includes(statusId)) return false; // handled separately as dispatched
  if (!statusName) return false;
  return TERMINAL_STATUS_NAMES.some(t => statusName.toLowerCase().includes(t));
}

// NEW status detection — matches "New" text or known new status IDs
function isNewStatus(statusName: string | null, statusId: number | null): boolean {
  if (statusName && statusName.toLowerCase() === 'new') return true;
  // Common Mintsoft "New" status IDs
  if (statusId === 1 || statusId === 4) return true;
  return false;
}

// Back order status
function isBackOrderStatus(statusName: string | null): boolean {
  if (!statusName) return false;
  return statusName.toLowerCase().includes('back order');
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

    // Fetch all active (non-terminal) order lines from last 7 days — paginate past 1000 limit
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    let orderLines: OrderLine[] = [];
    let from = 0;
    const PAGE = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("order_lines")
        .select("mintsoft_order_id, line_index, sku, brand_id, order_date, order_status, order_status_id, first_seen_at, last_seen_at, times_seen, last_status_change_at")
        .gte("order_date", sevenDaysAgo)
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
    // 1. Dispatched orders
    const dispatchedLines = orderLines.filter(
      (l) => l.order_status_id && dispatchedStatusIds.includes(l.order_status_id)
    );
    for (const line of dispatchedLines) {
      await supabase
        .from("order_issues")
        .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: "dispatched" })
        .eq("mintsoft_order_id", line.mintsoft_order_id)
        .eq("line_index", line.line_index)
        .eq("is_suppressed", false)
        .in("issue_status", ["open", "in_review"]);
    }

    // 2. Cancelled orders
    const cancelledLines = orderLines.filter((l) => isTerminalStatus(l.order_status, l.order_status_id, dispatchedStatusIds));
    for (const line of cancelledLines) {
      const resType = line.order_status?.toLowerCase().includes("cancel") ? "cancelled" : "condition_cleared";
      await supabase
        .from("order_issues")
        .update({ issue_status: "auto_resolved", resolved_at: now, resolution_type: resType })
        .eq("mintsoft_order_id", line.mintsoft_order_id)
        .eq("line_index", line.line_index)
        .eq("is_suppressed", false)
        .in("issue_status", ["open", "in_review"]);
    }

    // 3. Left active feed — orders not seen in 48h+
    const { data: staleIssues } = await supabase
      .from("order_issues")
      .select("mintsoft_order_id, line_index")
      .in("issue_status", ["open", "in_review"])
      .eq("is_suppressed", false);

    if (staleIssues) {
      for (const issue of staleIssues) {
        const matchingLine = orderLines.find(
          (l) => l.mintsoft_order_id === issue.mintsoft_order_id && l.line_index === issue.line_index
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

    // === ISSUE DETECTION (only non-terminal lines) ===
    const activeLines = orderLines.filter(
      (l) => !isTerminalStatus(l.order_status, l.order_status_id, dispatchedStatusIds) && !(l.order_status_id && dispatchedStatusIds.includes(l.order_status_id)) && !isBackOrderStatus(l.order_status)
    );

    for (const line of activeLines) {
      const orderAgeHours = hoursAgo(line.order_date);
      const statusAgeHours = hoursAgo(line.last_status_change_at);
      const timesSeen = line.times_seen || 1;

      // Rule 1 — New Order Stuck
      if (line.order_status?.toLowerCase() === "new" || line.order_status_id === 1) {
        const severity = getSeverityForAge(orderAgeHours, [4, 12, 24]);
        if (severity) {
          issuesToUpsert.push({
            mintsoft_order_id: line.mintsoft_order_id,
            line_index: line.line_index,
            sku: line.sku,
            brand_id: line.brand_id,
            problem_type: "new_stuck",
            severity,
            reason: `New order stuck for ${Math.round(orderAgeHours)}h`,
            last_problem_seen_at: now,
          });
          skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
        }
      }

      // Rule 2 — Stalled Progress (based on last_status_change_at, NOT times_seen alone)
      if (statusAgeHours >= 12) {
        const severity = getSeverityForAge(statusAgeHours, [12, 24, 48]);
        if (severity) {
          const evidence = timesSeen > 1 ? ` (seen ${timesSeen} times)` : "";
          issuesToUpsert.push({
            mintsoft_order_id: line.mintsoft_order_id,
            line_index: line.line_index,
            sku: line.sku,
            brand_id: line.brand_id,
            problem_type: "stalled_progress",
            severity,
            reason: `Status "${line.order_status || 'unknown'}" unchanged for ${Math.round(statusAgeHours)}h${evidence}`,
            last_problem_seen_at: now,
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
          reason: `Seen ${timesSeen} times across snapshots with no status change for ${Math.round(statusAgeHours)}h`,
          last_problem_seen_at: now,
        });
        skuProblemCounts[line.sku] = (skuProblemCounts[line.sku] || 0) + 1;
      }
    }

    // Rule 4 — SKU Clustering (advisory only, capped at watch)
    for (const [sku, count] of Object.entries(skuProblemCounts)) {
      if (count >= 3) {
        // Find all lines with this SKU that have issues
        const affectedLines = activeLines.filter((l) => l.sku === sku);
        for (const line of affectedLines) {
          issuesToUpsert.push({
            mintsoft_order_id: line.mintsoft_order_id,
            line_index: line.line_index,
            sku: line.sku,
            brand_id: line.brand_id,
            problem_type: "stock_discrepancy_suspected",
            severity: "watch",
            reason: `SKU ${sku} appears in ${count} flagged orders — possible stock issue`,
            last_problem_seen_at: now,
          });
        }
      }
    }

    // === UPSERT ISSUES ===
    let issuesCreated = 0;
    let issuesUpdated = 0;

    for (const issue of issuesToUpsert) {
      // Check if issue already exists
      const { data: existing } = await supabase
        .from("order_issues")
        .select("id, severity, is_suppressed, issue_status")
        .eq("mintsoft_order_id", issue.mintsoft_order_id)
        .eq("line_index", issue.line_index)
        .eq("problem_type", issue.problem_type)
        .maybeSingle();

      if (existing) {
        // Skip suppressed issues
        if (existing.is_suppressed) continue;
        // Skip already resolved
        if (existing.issue_status === "auto_resolved" || existing.issue_status === "resolved" || existing.issue_status === "ignored") continue;

        // Escalate severity (never downgrade)
        const severityRank: Record<string, number> = { watch: 1, problem: 2, critical: 3 };
        const newRank = severityRank[issue.severity] || 0;
        const existingRank = severityRank[existing.severity] || 0;

        const updatePayload: Record<string, unknown> = {
          last_problem_seen_at: now,
          reason: issue.reason,
        };

        if (newRank > existingRank) {
          updatePayload.severity = issue.severity;
        }

        await supabase.from("order_issues").update(updatePayload).eq("id", existing.id);
        issuesUpdated++;
      } else {
        // Create new issue
        const { error: insertErr } = await supabase.from("order_issues").insert({
          ...issue,
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
          (i) =>
            i.mintsoft_order_id === openIssue.mintsoft_order_id &&
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
      JSON.stringify({ success: true, issues_created: issuesCreated, issues_updated: issuesUpdated }),
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
