/**
 * Read access to the append-only audit ledger (spec §5). Super/senior only at
 * the RLS layer; the page is also gated in the task layout nav. Supports a free-
 * text filter on action_type / entity, applied client-side over a recent window.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AuditLogEntry } from "@/types/tasks";

const sb = supabase as any;

export function useAuditLog(opts?: { search?: string; actionType?: string; limit?: number }) {
  return useQuery({
    queryKey: ["audit-log", opts],
    queryFn: async (): Promise<AuditLogEntry[]> => {
      let query = sb
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(opts?.limit ?? 200);

      if (opts?.actionType && opts.actionType !== "all") {
        query = query.eq("action_type", opts.actionType);
      }

      const { data, error } = await query;
      if (error) throw error;

      let rows = (data ?? []) as AuditLogEntry[];
      if (opts?.search) {
        const s = opts.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.action_type.toLowerCase().includes(s) ||
            r.entity_type.toLowerCase().includes(s) ||
            (r.entity_label ?? "").toLowerCase().includes(s) ||
            (r.actor_display_name ?? "").toLowerCase().includes(s),
        );
      }
      return rows;
    },
  });
}

/** Distinct action types present in the ledger — drives the filter dropdown. */
export function useAuditActionTypes() {
  return useQuery({
    queryKey: ["audit-log-action-types"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await sb
        .from("audit_log")
        .select("action_type")
        .order("action_type");
      if (error) throw error;
      const set = new Set<string>((data ?? []).map((r: { action_type: string }) => r.action_type));
      return Array.from(set).sort();
    },
  });
}
