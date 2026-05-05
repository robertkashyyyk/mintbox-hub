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
      const { data, error } = await sb.rpc("get_buy_recommendations", {
        p_supplier_id: opts?.supplierId ?? null,
        p_brand_id: opts?.brandId ?? null,
        p_include_pending: !!opts?.includePending,
      });
      if (error) throw error;
      return (data || []) as BuyRecommendationRow[];
    },
    staleTime: 30_000,
  });
};
