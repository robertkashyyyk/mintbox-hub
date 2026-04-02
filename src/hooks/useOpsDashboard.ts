import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StageAgeing {
  status: string;
  order_count: number;
  avg_age_hours: number;
  median_age_hours: number;
}

export interface HourlyFlow {
  hour: number;
  new_orders: number;
  despatched: number;
}

export interface OpsDashboardData {
  // Today's Reality
  newOrdersToday: number;
  despatchedToday: number;
  currentBackorders: number;
  awaitingPicking: number;
  netFlow: number;
  // Queue counts
  queueNew: number;
  queueAwaitingPicking: number;
  queueOnBackorder: number;
  totalActive: number;
  // Start-of-day deltas
  deltaNew: number;
  deltaAwaitingPicking: number;
  deltaBackorder: number;
  // Despatch performance
  despatch24h: number;
  despatch48h: number;
  despatch72h: number;
  totalDespatched: number;
  // 7-day averages
  despatch24h7d: number;
  despatch48h7d: number;
  despatch72h7d: number;
  totalDespatched7d: number;
  // MTD
  despatch24hMtd: number;
  despatch48hMtd: number;
  despatch72hMtd: number;
  totalDespatchedMtd: number;
  // Problem pressure
  totalProblems: number;
  criticalIssues: number;
  newStuck: number;
  repeatedSnapshot: number;
  stockDiscrepancy: number;
  // Stage ageing
  stageAgeing: StageAgeing[];
  // Hourly flow
  hourlyFlow: HourlyFlow[];
  // Metadata
  lastSyncAt: string | null;
}

export const useOpsDashboard = () => {
  return useQuery({
    queryKey: ["ops-dashboard-live"],
    queryFn: async (): Promise<OpsDashboardData> => {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const mtdStart = `${todayStr.substring(0, 7)}-01`;

      // Parallel queries
      const [
        todayReality,
        queueCounts,
        despatchToday,
        despatch7d,
        despatchMtd,
        problemPressure,
        lastSync,
        startOfDay,
        stageAgeingResult,
        hourlyFlowResult,
      ] = await Promise.all([
        // Today's new orders (placed today)
        supabase
          .from("order_lines")
          .select("mintsoft_order_id", { count: "exact", head: true })
          .gte("order_date", `${todayStr}T00:00:00`)
          .lt("order_date", `${todayStr}T23:59:59.999`),

        // Current queue counts
        supabase.rpc("get_ops_queue_counts" as any),

        // Despatch performance today
        supabase.rpc("get_despatch_performance" as any, {
          from_date: todayStr,
          to_date: todayStr,
        }),

        // Despatch performance 7 days
        supabase.rpc("get_despatch_performance" as any, {
          from_date: sevenDaysAgo.toISOString().split("T")[0],
          to_date: todayStr,
        }),

        // Despatch performance MTD
        supabase.rpc("get_despatch_performance" as any, {
          from_date: mtdStart,
          to_date: todayStr,
        }),

        // Problem pressure from order_issues
        supabase
          .from("order_issues")
          .select("problem_type, severity")
          .not("issue_status", "in", "(resolved,ignored,auto_resolved)")
          .eq("is_suppressed", false),

        // Last sync timestamp
        supabase
          .from("order_lines")
          .select("last_seen_at")
          .order("last_seen_at", { ascending: false })
          .limit(1)
          .maybeSingle(),

        // Start of day snapshot for delta calculation (use archived snapshots if available)
        supabase
          .from("order_status_snapshots")
          .select("new_count, onbackorder_count, awaitingpicking_count")
          .eq("capture_date_uk", todayStr)
          .order("captured_at", { ascending: true })
          .limit(1)
          .maybeSingle(),

        // Stage ageing
        supabase.rpc("get_ops_stage_ageing" as any),

        // Hourly flow
        supabase.rpc("get_ops_hourly_flow" as any),
      ]);

      // Parse queue counts from RPC
      const queues = (queueCounts.data as any)?.[0] || {
        new_count: 0,
        awaiting_picking_count: 0,
        onbackorder_count: 0,
        despatched_today_count: 0,
      };

      const queueNew = Number(queues.new_count) || 0;
      const queueAwaitingPicking = Number(queues.awaiting_picking_count) || 0;
      const queueOnBackorder = Number(queues.onbackorder_count) || 0;
      const despatchedTodayCount = Number(queues.despatched_today_count) || 0;
      const newTodayCount = todayReality.count || 0;

      // Deltas from start of day
      const sod = startOfDay.data;
      const deltaNew = sod ? queueNew - (sod.new_count || 0) : 0;
      const deltaAwaitingPicking = sod
        ? queueAwaitingPicking - (sod.awaitingpicking_count || 0)
        : 0;
      const deltaBackorder = sod
        ? queueOnBackorder - (sod.onbackorder_count || 0)
        : 0;

      // Despatch performance parsing
      const dToday = (despatchToday.data as any)?.[0] || {};
      const d7d = (despatch7d.data as any)?.[0] || {};
      const dMtd = (despatchMtd.data as any)?.[0] || {};

      // Problem pressure
      const issues = (problemPressure.data as any[]) || [];
      const totalProblems = issues.length;
      const criticalIssues = issues.filter(
        (i) => i.severity === "critical"
      ).length;
      const newStuck = issues.filter(
        (i) => i.problem_type === "new_stuck"
      ).length;
      const repeatedSnapshot = issues.filter(
        (i) => i.problem_type === "repeated_snapshot"
      ).length;
      const stockDiscrepancy = issues.filter(
        (i) => i.problem_type === "stock_discrepancy_suspected"
      ).length;

      // Stage ageing
      const stageAgeing: StageAgeing[] = ((stageAgeingResult.data as any[]) || []).map(
        (r: any) => ({
          status: r.status,
          order_count: Number(r.order_count) || 0,
          avg_age_hours: Number(r.avg_age_hours) || 0,
          median_age_hours: Number(r.median_age_hours) || 0,
        })
      );

      // Hourly flow
      const hourlyFlow: HourlyFlow[] = ((hourlyFlowResult.data as any[]) || []).map(
        (r: any) => ({
          hour: Number(r.hour_of_day),
          new_orders: Number(r.new_orders) || 0,
          despatched: Number(r.despatched) || 0,
        })
      );

      return {
        newOrdersToday: newTodayCount,
        despatchedToday: despatchedTodayCount,
        currentBackorders: queueOnBackorder,
        awaitingPicking: queueAwaitingPicking,
        netFlow: despatchedTodayCount - newTodayCount,
        queueNew,
        queueAwaitingPicking,
        queueOnBackorder,
        totalActive: queueNew + queueAwaitingPicking + queueOnBackorder,
        deltaNew,
        deltaAwaitingPicking,
        deltaBackorder,
        despatch24h: Number(dToday.within_24h) || 0,
        despatch48h: Number(dToday.within_48h) || 0,
        despatch72h: Number(dToday.within_72h) || 0,
        totalDespatched: Number(dToday.total_despatched) || 0,
        despatch24h7d: Number(d7d.within_24h) || 0,
        despatch48h7d: Number(d7d.within_48h) || 0,
        despatch72h7d: Number(d7d.within_72h) || 0,
        totalDespatched7d: Number(d7d.total_despatched) || 0,
        despatch24hMtd: Number(dMtd.within_24h) || 0,
        despatch48hMtd: Number(dMtd.within_48h) || 0,
        despatch72hMtd: Number(dMtd.within_72h) || 0,
        totalDespatchedMtd: Number(dMtd.total_despatched) || 0,
        totalProblems,
        criticalIssues,
        newStuck,
        repeatedSnapshot,
        stockDiscrepancy,
        stageAgeing,
        hourlyFlow,
        lastSyncAt: lastSync.data?.last_seen_at || null,
      };
    },
    refetchInterval: 60000,
  });
};
