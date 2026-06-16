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

export interface LsaCalibrationProgress {
  loaded: number;
  total?: number;
}

const CHUNK_SIZE = 800;

export const useLsaCalibration = (brandId?: string | null) => {
  return useQuery({
    queryKey: ["lsa-calibration", brandId ?? null],
    queryFn: async () => {
      const sb = supabase as any;
      const all: LsaCalibrationRow[] = [];
      let offset = 0;
      let chunk: LsaCalibrationRow[] = [];

      do {
        const { data, error } = await sb.rpc("get_lsa_calibration", {
          p_brand_id: brandId ?? null,
          p_limit: CHUNK_SIZE,
          p_offset: offset,
        });
        if (error) throw error;
        chunk = (data || []) as LsaCalibrationRow[];
        all.push(...chunk);
        offset += CHUNK_SIZE;
      } while (chunk.length === CHUNK_SIZE);

      return all;
    },
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,    // don't re-run the heavy RPC just because the tab regained focus
    placeholderData: (prev: any) => prev, // keep prior data visible while a new brand loads (no empty flash)
  });
};
