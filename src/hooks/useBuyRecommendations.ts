import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface PurchasingRequirementRow {
  sku: string;
  name: string | null;
  current_stock: number;
  lsa: number;
  back_order_qty: number;
  on_order_qty: number;
  open_asn_qty: number;
  cost_price: number | null;
  supplier_id: string | null;
  supplier_name: string | null;
  prefix: string | null;
  reorder_qty: number;
}

export interface SupplierSummaryRow {
  supplier_id: string | null;
  supplier_name: string | null;
  sku_count: number;
  total_units: number;
  estimated_cost: number;
}

export const useBuyRecommendations = () => {
  const [requirements, setRequirements] = useState<PurchasingRequirementRow[]>([]);
  const [summary, setSummary] = useState<SupplierSummaryRow[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Views aren't in generated Supabase types — cast client to any.
      const sb = supabase as any;

      const [reqRes, sumRes, syncRes] = await Promise.all([
        sb.from("purchasing_requirements").select("*").limit(10000),
        sb.from("supplier_order_summary").select("*"),
        sb
          .from("products_cache")
          .select("last_stock_sync")
          .order("last_stock_sync", { ascending: false, nullsFirst: false })
          .limit(1),
      ]);

      if (reqRes.error) throw reqRes.error;
      if (sumRes.error) throw sumRes.error;

      setRequirements((reqRes.data || []) as PurchasingRequirementRow[]);
      setSummary(((sumRes.data || []) as SupplierSummaryRow[]).sort(
        (a, b) => (b.estimated_cost || 0) - (a.estimated_cost || 0)
      ));
      setLastSynced(syncRes.data?.[0]?.last_stock_sync || null);
    } catch (error: any) {
      toast({
        title: "Error loading buy recommendations",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { requirements, summary, lastSynced, loading, refetch: fetchData };
};
