import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DailyTrend {
  day: string;
  new_orders: number;
  despatched: number;
  backorders: number;
  awaiting_picking: number;
  net_flow: number;
}

export interface DespatchPerformanceDay {
  day: string;
  pct_24h: number;
  pct_48h: number;
  pct_72h: number;
  total: number;
}

export type TrendRange = "7d" | "30d" | "90d";

export const useOpsTrends = (range: TrendRange = "30d") => {
  return useQuery({
    queryKey: ["ops-trends", range],
    queryFn: async () => {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const daysBack = range === "7d" ? 7 : range === "30d" ? 30 : 90;
      const fromDate = new Date(today);
      fromDate.setDate(fromDate.getDate() - daysBack);
      const fromStr = fromDate.toISOString().split("T")[0];

      const [trendResult, perfResult] = await Promise.all([
        supabase.rpc("get_ops_daily_trend" as any, {
          from_date: fromStr,
          to_date: todayStr,
        }),
        // Get daily despatch performance by iterating
        supabase.rpc("get_despatch_performance" as any, {
          from_date: fromStr,
          to_date: todayStr,
        }),
      ]);

      const rawTrend = ((trendResult.data as any[]) || []).map((d: any) => ({
        day: d.day,
        new_orders: Number(d.new_orders) || 0,
        despatched: Number(d.despatched) || 0,
        backorders: Number(d.backorders) || 0,
        awaiting_picking: Number(d.awaiting_picking) || 0,
        net_flow: (Number(d.despatched) || 0) - (Number(d.new_orders) || 0),
      }));

      // Calculate rolling averages
      const rolling7d = rawTrend.map((d, i) => {
        const window = rawTrend.slice(Math.max(0, i - 6), i + 1);
        return {
          day: d.day,
          avg_new: window.reduce((s, w) => s + w.new_orders, 0) / window.length,
          avg_despatched: window.reduce((s, w) => s + w.despatched, 0) / window.length,
          avg_net_flow: window.reduce((s, w) => s + w.net_flow, 0) / window.length,
        };
      });

      // Overall performance for the period
      const perf = (perfResult.data as any)?.[0] || {};
      const totalDesp = Number(perf.total_despatched) || 0;

      return {
        daily: rawTrend,
        rolling7d,
        periodPerformance: {
          pct24h: totalDesp > 0 ? (Number(perf.within_24h) / totalDesp) * 100 : 0,
          pct48h: totalDesp > 0 ? (Number(perf.within_48h) / totalDesp) * 100 : 0,
          pct72h: totalDesp > 0 ? (Number(perf.within_72h) / totalDesp) * 100 : 0,
          totalDespatched: totalDesp,
        },
      };
    },
  });
};
