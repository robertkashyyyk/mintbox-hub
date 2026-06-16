import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LsaBrandSummaryRow {
  brand_id: string | null;
  brand_name: string | null;
  total: number;
  critical: number;
  low: number;
  target: number;
  high: number;
  excess: number;
  dormant: number;        // no demand + at the LSA floor — informational, excluded from POT
  active_total: number;   // total − dormant (the POT denominator)
  refreshed_at: string;
}

export const useLsaBrandSummary = () =>
  useQuery({
    queryKey: ["lsa-brand-summary"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lsa_brand_summary")
        .select("*")
        .order("brand_name", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data || []) as LsaBrandSummaryRow[];
    },
    staleTime: 5 * 60_000,
  });
