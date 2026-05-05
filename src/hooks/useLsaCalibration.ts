import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LsaCalibrationRow {
  sku: string;
  product_name: string | null;
  brand_id: string | null;
  brand_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  current_stock: number;
  current_lsa: number;
  weekly_velocity: number;
  base_multiplier: number;
  target_lsa: number;
  status: "critical" | "low" | "target" | "high" | "excess";
}

export const useLsaCalibration = (brandId?: string | null) => {
  return useQuery({
    queryKey: ["lsa-calibration", brandId ?? null],
    queryFn: async () => {
      const sb = supabase as any;
      const { data, error } = await sb
        .rpc("get_lsa_calibration", { p_brand_id: brandId ?? null })
        .range(0, 49999);
      if (error) throw error;
      return (data || []) as LsaCalibrationRow[];
    },
    staleTime: 30_000,
  });
};
