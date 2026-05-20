import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type SkuType = Database["public"]["Enums"]["sku_type"];

export interface SkuMasterRow {
  sku: string;
  sku_type: SkuType;
  base_sku: string | null;
  supplier_order_sku: string | null;
  internal_alias_sku: string | null;
  allow_marketplace_sale: boolean;
  allow_picking: boolean;
  allow_stock_holding: boolean;
  auto_convert_on_receipt: boolean;
  conversion_multiplier: number | null;
  procurement_pack_size: number | null;
  notes: string | null;
}

export interface SkuLogicRow extends SkuMasterRow {
  name: string | null;
  brand: string | null;
  brand_id: string | null;
}

export interface ConversionRule {
  id: string;
  procurement_sku: string;
  base_sku: string;
  conversion_multiplier: number;
  auto_convert_on_receipt: boolean;
  is_active: boolean;
  notes: string | null;
}

export interface MultiplierRule {
  id: string;
  multiplier_sku: string;
  base_sku: string;
  multiplier_qty: number;
  is_active: boolean;
  notes: string | null;
}

const PAGE_SIZE = 50;

export function useSkuLogicList(params: { search: string; page: number; typeFilter: SkuType | "ALL" }) {
  const { search, page, typeFilter } = params;
  return useQuery({
    queryKey: ["sku-transformations", "logic", search, page, typeFilter],
    queryFn: async () => {
      // Query products_cache page first (it has name/brand), then join sku_master client-side.
      let q = supabase
        .from("products_cache")
        .select("sku, name, brand", { count: "exact" })
        .order("sku", { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (search) {
        const term = `%${search}%`;
        q = q.or(`sku.ilike.${term},name.ilike.${term},brand.ilike.${term}`);
      }

      const { data: products, count, error } = await q;
      if (error) throw error;

      const skus = (products ?? []).map((p) => p.sku).filter(Boolean);
      let masterMap = new Map<string, SkuMasterRow>();
      if (skus.length > 0) {
        let mq = supabase.from("sku_master").select("*").in("sku", skus);
        if (typeFilter !== "ALL") mq = mq.eq("sku_type", typeFilter);
        const { data: masters, error: mErr } = await mq;
        if (mErr) throw mErr;
        masterMap = new Map((masters ?? []).map((m) => [m.sku, m as SkuMasterRow]));
      }

      const rows: SkuLogicRow[] = (products ?? [])
        .filter((p) => (typeFilter === "ALL" ? true : masterMap.has(p.sku)))
        .map((p) => {
          const m = masterMap.get(p.sku);
          return {
            sku: p.sku,
            name: p.name ?? null,
            brand: p.brand ?? null,
            sku_type: (m?.sku_type ?? "BASE") as SkuType,
            base_sku: m?.base_sku ?? null,
            supplier_order_sku: m?.supplier_order_sku ?? null,
            internal_alias_sku: m?.internal_alias_sku ?? null,
            allow_marketplace_sale: m?.allow_marketplace_sale ?? true,
            allow_picking: m?.allow_picking ?? true,
            allow_stock_holding: m?.allow_stock_holding ?? true,
            auto_convert_on_receipt: m?.auto_convert_on_receipt ?? false,
            conversion_multiplier: m?.conversion_multiplier ?? null,
            procurement_pack_size: m?.procurement_pack_size ?? null,
            notes: m?.notes ?? null,
          };
        });

      return { rows, count: count ?? 0, pageSize: PAGE_SIZE };
    },
  });
}

export function useUpsertSkuMaster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: SkuMasterRow) => {
      const { error } = await supabase
        .from("sku_master")
        .upsert(row, { onConflict: "sku" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sku-transformations"] });
    },
  });
}

export function useConversionRules() {
  return useQuery({
    queryKey: ["sku-transformations", "conversion-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku_conversion_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ConversionRule[];
    },
  });
}

export function useMultiplierRules() {
  return useQuery({
    queryKey: ["sku-transformations", "multiplier-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku_multiplier_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as MultiplierRule[];
    },
  });
}

export function useSaveConversionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<ConversionRule>) => {
      if (rule.id) {
        const { error } = await supabase
          .from("sku_conversion_rules")
          .update({
            procurement_sku: rule.procurement_sku,
            base_sku: rule.base_sku,
            conversion_multiplier: rule.conversion_multiplier,
            auto_convert_on_receipt: rule.auto_convert_on_receipt,
            is_active: rule.is_active,
            notes: rule.notes,
          })
          .eq("id", rule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sku_conversion_rules").insert({
          procurement_sku: rule.procurement_sku!,
          base_sku: rule.base_sku!,
          conversion_multiplier: rule.conversion_multiplier!,
          auto_convert_on_receipt: rule.auto_convert_on_receipt ?? true,
          is_active: rule.is_active ?? true,
          notes: rule.notes ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sku-transformations"] }),
  });
}

export function useDeleteConversionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sku_conversion_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sku-transformations"] }),
  });
}

export function useSaveMultiplierRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: Partial<MultiplierRule>) => {
      if (rule.id) {
        const { error } = await supabase
          .from("sku_multiplier_rules")
          .update({
            multiplier_sku: rule.multiplier_sku,
            base_sku: rule.base_sku,
            multiplier_qty: rule.multiplier_qty,
            is_active: rule.is_active,
            notes: rule.notes,
          })
          .eq("id", rule.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sku_multiplier_rules").insert({
          multiplier_sku: rule.multiplier_sku!,
          base_sku: rule.base_sku!,
          multiplier_qty: rule.multiplier_qty!,
          is_active: rule.is_active ?? true,
          notes: rule.notes ?? null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sku-transformations"] }),
  });
}

export function useDeleteMultiplierRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sku_multiplier_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sku-transformations"] }),
  });
}

/** Lookup helpers used by the autocomplete + validation. */
export async function searchBaseSkus(term: string): Promise<string[]> {
  if (!term || term.length < 1) return [];
  const { data, error } = await supabase
    .from("sku_master")
    .select("sku")
    .eq("sku_type", "BASE")
    .ilike("sku", `%${term}%`)
    .order("sku", { ascending: true })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((r) => r.sku);
}

export async function isValidBaseSku(sku: string): Promise<boolean> {
  if (!sku) return false;
  const { data, error } = await supabase
    .from("sku_master")
    .select("sku")
    .eq("sku", sku)
    .eq("sku_type", "BASE")
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/** Suggest mappings from suffix patterns. Never auto-applies. */
export interface MappingSuggestion {
  source_sku: string;
  inferred_type: "PROCUREMENT_PACK" | "MULTIPLIER";
  inferred_base_sku: string;
  multiplier: number;
  base_exists: boolean;
  pattern: string;
}

export async function fetchMappingSuggestions(limit = 500): Promise<MappingSuggestion[]> {
  // Pull a working window of SKUs from sku_master to scan.
  const { data, error } = await supabase
    .from("sku_master")
    .select("sku, sku_type")
    .limit(limit);
  if (error) throw error;

  const allSkus = new Set((data ?? []).map((r) => r.sku));
  const baseSkus = new Set(
    (data ?? []).filter((r) => r.sku_type === "BASE").map((r) => r.sku)
  );

  const suggestions: MappingSuggestion[] = [];

  for (const row of data ?? []) {
    const sku = row.sku;
    // Pattern A: .NNN suffix → procurement pack
    const dotMatch = sku.match(/^(.+)\.(\d{2,4})$/);
    if (dotMatch) {
      const base = dotMatch[1];
      const mult = parseInt(dotMatch[2], 10);
      if (mult > 1) {
        suggestions.push({
          source_sku: sku,
          inferred_type: "PROCUREMENT_PACK",
          inferred_base_sku: base,
          multiplier: mult,
          base_exists: baseSkus.has(base) || allSkus.has(base),
          pattern: `.${mult}`,
        });
        continue;
      }
    }
    // Pattern B: -PNN(N) → procurement pack
    const pMatch = sku.match(/^(.+)-P(\d{1,4})$/);
    if (pMatch) {
      const base = pMatch[1];
      const mult = parseInt(pMatch[2], 10);
      if (mult > 1) {
        suggestions.push({
          source_sku: sku,
          inferred_type: "PROCUREMENT_PACK",
          inferred_base_sku: base,
          multiplier: mult,
          base_exists: baseSkus.has(base) || allSkus.has(base),
          pattern: `-P${mult}`,
        });
        continue;
      }
    }
    // Pattern C: -MNN(N) → multiplier
    const mMatch = sku.match(/^(.+)-M(\d{1,4})$/);
    if (mMatch) {
      const base = mMatch[1];
      const mult = parseInt(mMatch[2], 10);
      if (mult > 1) {
        suggestions.push({
          source_sku: sku,
          inferred_type: "MULTIPLIER",
          inferred_base_sku: base,
          multiplier: mult,
          base_exists: baseSkus.has(base) || allSkus.has(base),
          pattern: `-M${mult}`,
        });
        continue;
      }
    }
    // Pattern D: -QNN → multiplier
    const qMatch = sku.match(/^(.+)-Q(\d{1,3})$/);
    if (qMatch) {
      const base = qMatch[1];
      const mult = parseInt(qMatch[2], 10);
      if (mult > 1) {
        suggestions.push({
          source_sku: sku,
          inferred_type: "MULTIPLIER",
          inferred_base_sku: base,
          multiplier: mult,
          base_exists: baseSkus.has(base) || allSkus.has(base),
          pattern: `-Q${qMatch[2]}`,
        });
      }
    }
  }
  return suggestions;
}
