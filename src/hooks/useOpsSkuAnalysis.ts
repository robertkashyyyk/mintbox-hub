import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SkuIssueRow {
  sku: string;
  brand_id: string | null;
  brand_name?: string;
  total_issues: number;
  critical_count: number;
  problem_types: string[];
  latest_issue: string;
}

export interface BackorderSkuRow {
  sku: string;
  brand_name?: string;
  order_count: number;
  total_qty: number;
  oldest_order_date: string;
  avg_age_days: number;
}

export interface BrandConcentration {
  brand_name: string;
  issue_count: number;
  critical_count: number;
}

export interface ChannelConcentration {
  channel: string;
  issue_count: number;
}

export const useOpsSkuAnalysis = () => {
  return useQuery({
    queryKey: ["ops-sku-analysis"],
    queryFn: async () => {
      const [skuIssues, backorderSkus, brandConc, channelConc] = await Promise.all([
        // Top problem SKUs
        supabase.rpc("get_ops_sku_issues" as any, { lim: 20 }),

        // Top backorder SKUs
        supabase
          .from("order_lines")
          .select("sku, mintsoft_order_id, qty, order_date, brand_id")
          .eq("order_status", "ONBACKORDER")
          .gt("last_seen_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
          .gte("order_date", "2026-01-01"),

        // Brand issue concentration
        supabase
          .from("order_issues")
          .select("brand_id, severity")
          .not("issue_status", "in", "(resolved,ignored,auto_resolved)")
          .eq("is_suppressed", false),

        // Channel issue concentration
        supabase
          .from("order_lines")
          .select("channel, mintsoft_order_id")
          .not("order_status", "in", "(DESPATCHED,CANCELLED)")
          .gt("last_seen_at", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
          .gte("order_date", "2026-01-01"),
      ]);

      // Fetch brand names for enrichment
      const { data: brands } = await supabase.from("brands").select("id, name");
      const brandMap = new Map((brands || []).map((b: any) => [b.id, b.name]));

      // Process SKU issues
      const skuIssueRows: SkuIssueRow[] = ((skuIssues.data as any[]) || []).map((r: any) => ({
        sku: r.sku,
        brand_id: r.brand_id,
        brand_name: brandMap.get(r.brand_id) || "Unknown",
        total_issues: Number(r.total_issues),
        critical_count: Number(r.critical_count),
        problem_types: r.problem_types || [],
        latest_issue: r.latest_issue,
      }));

      // Aggregate backorder SKUs
      const boMap = new Map<string, { count: Set<number>; qty: number; oldest: string; brand: string }>();
      ((backorderSkus.data as any[]) || []).forEach((r: any) => {
        const existing = boMap.get(r.sku) || {
          count: new Set(),
          qty: 0,
          oldest: r.order_date,
          brand: brandMap.get(r.brand_id) || "Unknown",
        };
        existing.count.add(r.mintsoft_order_id);
        existing.qty += r.qty || 1;
        if (r.order_date < existing.oldest) existing.oldest = r.order_date;
        boMap.set(r.sku, existing);
      });

      const backorderSkuRows: BackorderSkuRow[] = Array.from(boMap.entries())
        .map(([sku, data]) => ({
          sku,
          brand_name: data.brand,
          order_count: data.count.size,
          total_qty: data.qty,
          oldest_order_date: data.oldest,
          avg_age_days: Math.round(
            (Date.now() - new Date(data.oldest).getTime()) / (1000 * 60 * 60 * 24)
          ),
        }))
        .sort((a, b) => b.order_count - a.order_count)
        .slice(0, 20);

      // Brand concentration
      const brandConcMap = new Map<string, { count: number; critical: number }>();
      ((brandConc.data as any[]) || []).forEach((r: any) => {
        const name = brandMap.get(r.brand_id) || "Unknown";
        const existing = brandConcMap.get(name) || { count: 0, critical: 0 };
        existing.count++;
        if (r.severity === "critical") existing.critical++;
        brandConcMap.set(name, existing);
      });

      const brandConcentration: BrandConcentration[] = Array.from(brandConcMap.entries())
        .map(([name, data]) => ({
          brand_name: name,
          issue_count: data.count,
          critical_count: data.critical,
        }))
        .sort((a, b) => b.issue_count - a.issue_count)
        .slice(0, 15);

      // Channel concentration
      const chanMap = new Map<string, Set<number>>();
      ((channelConc.data as any[]) || []).forEach((r: any) => {
        const ch = r.channel || "Unknown";
        if (!chanMap.has(ch)) chanMap.set(ch, new Set());
        chanMap.get(ch)!.add(r.mintsoft_order_id);
      });

      const channelConcentration: ChannelConcentration[] = Array.from(chanMap.entries())
        .map(([channel, orders]) => ({
          channel,
          issue_count: orders.size,
        }))
        .sort((a, b) => b.issue_count - a.issue_count);

      return {
        skuIssues: skuIssueRows,
        backorderSkus: backorderSkuRows,
        brandConcentration,
        channelConcentration,
      };
    },
  });
};
