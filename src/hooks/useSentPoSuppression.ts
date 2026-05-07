import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAppSetting } from "@/hooks/useAppSettings";

export interface SentPoState {
  supplierId: string;
  sentAt: string;
  mintsoftPoId: number | null;
  poId: string;
  poNumber: string | null;
}

export interface SupplierSuppression {
  supplierId: string;
  sentAt: string;
  poId: string;
  poNumber: string | null;
  mintsoftPoId: number | null;
  /** Inside the suppression window — hide from list */
  suppressed: boolean;
  /** PO sent but window expired without ASN — show with warning badge */
  overdueNoAsn: boolean;
}

export const useSentPoSuppression = () => {
  const { data: hoursSetting } = useAppSetting<number>("buying.po_suppression_hours");
  const hours = typeof hoursSetting === "number" && hoursSetting > 0 ? hoursSetting : 22;

  const query = useQuery({
    queryKey: ["sent-po-suppression"],
    queryFn: async () => {
      const sb = supabase as any;
      // Look back 7 days to catch overdue POs too
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await sb
        .from("purchase_orders")
        .select("id, supplier_id, status, sent_at, mintsoft_po_id, po_number")
        .eq("status", "sent")
        .gte("sent_at", cutoff)
        .not("supplier_id", "is", null)
        .order("sent_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        supplier_id: string;
        status: string;
        sent_at: string;
        mintsoft_po_id: number | null;
        po_number: string | null;
      }>;
    },
    staleTime: 60_000,
  });

  const map = new Map<string, SupplierSuppression>();
  const now = Date.now();
  const windowMs = hours * 60 * 60 * 1000;
  for (const po of query.data || []) {
    if (!po.supplier_id || !po.sent_at) continue;
    const ageMs = now - new Date(po.sent_at).getTime();
    const inWindow = ageMs < windowMs;
    const hasAsn = po.mintsoft_po_id != null;
    if (hasAsn) continue; // ASN converted: ordering calc handles it via on_order
    const existing = map.get(po.supplier_id);
    // Keep the most recent PO per supplier (already ordered desc)
    if (existing) continue;
    map.set(po.supplier_id, {
      supplierId: po.supplier_id,
      sentAt: po.sent_at,
      poId: po.id,
      poNumber: po.po_number,
      mintsoftPoId: po.mintsoft_po_id,
      suppressed: inWindow,
      overdueNoAsn: !inWindow,
    });
  }

  return { suppressionMap: map, hours, isLoading: query.isLoading };
};
