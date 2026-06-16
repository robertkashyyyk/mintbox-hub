import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface BuyRecommendationRow {
  sku: string;
  product_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  current_stock: number;
  on_order: number;
  back_orders: number;
  low_stock_alert: number;
  unit_cost: number | null;
  required_qty: number;
  raw_required_qty: number;
  box_quantity: number;
  pending_po_qty: number;
  pending_po_id: string | null;
  sales_4w: number;
  status: "needs_order" | "po_sent_pending" | string;
}

export const useBuyRecommendationsRpc = (opts?: {
  supplierId?: string | null;
  brandId?: string | null;
  includePending?: boolean;
}) => {
  return useQuery({
    queryKey: ["buy-recs-rpc", opts?.supplierId, opts?.brandId, opts?.includePending],
    queryFn: async () => {
      const sb = supabase as any;
      // PostgREST caps RPC results at 1000 rows even with .range() — paginate manually.
      const PAGE = 1000;
      const all: BuyRecommendationRow[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await sb
          .rpc("get_buy_recommendations", {
            p_supplier_id: opts?.supplierId ?? null,
            p_brand_id: opts?.brandId ?? null,
            p_include_pending: !!opts?.includePending,
          })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data || []) as BuyRecommendationRow[];
        all.push(...rows);
        if (rows.length < PAGE) break; // last page
        from += PAGE;
      }
      return all;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => prev,
  });
};

export interface BuyRecommendationsSummary {
  recommended_count: number;
  pending_po_count: number;
  total_required_qty: number;
  total_required_cost: number;
  missing_cost_count: number;
}

export const useBuyRecommendationsSummary = () => {
  return useQuery({
    queryKey: ["buy-recs-summary"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb.rpc("get_buy_recommendations_summary");
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return (row || {
        recommended_count: 0,
        pending_po_count: 0,
        total_required_qty: 0,
        total_required_cost: 0,
        missing_cost_count: 0,
      }) as BuyRecommendationsSummary;
    },
    staleTime: 30_000,
  });
};
