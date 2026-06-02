/**
 * Audit Log viewer (spec §5) — read-only window onto the append-only ledger.
 * Renders inside the task environment (teal). Governance surface: who did what,
 * to which entity, with before/after values. No edit or delete affordances by
 * design — immutability is the whole point.
 */
import { useState } from "react";
import { format } from "date-fns";
import { Loader2, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuditLog, useAuditActionTypes } from "@/hooks/tasks/useAuditLog";

const AuditLog = () => {
  const [search, setSearch] = useState("");
  const [actionType, setActionType] = useState("all");
  const { data: entries = [], isLoading } = useAuditLog({
    search: search || undefined,
    actionType,
  });
  const { data: actionTypes = [] } = useAuditActionTypes();

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-teal-300" />
        <div>
          <h1 className="text-2xl font-semibold text-teal-50">Audit Log</h1>
          <p className="mt-0.5 text-sm text-teal-200/60">
            Append-only record of sensitive changes across the system.
          </p>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-200/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actor, action, entity…"
            className="border-teal-400/20 bg-[hsl(185,55%,12%)] pl-8 text-teal-50 placeholder:text-teal-200/30"
          />
        </div>
        <Select value={actionType} onValueChange={setActionType}>
          <SelectTrigger className="w-[200px] border-teal-400/20 bg-[hsl(185,55%,12%)] text-teal-50">
            <SelectValue placeholder="Action type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {actionTypes.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border border-teal-400/15 bg-[hsl(185,55%,12%)] py-16 text-center">
          <p className="text-sm font-medium text-teal-50">No audit entries.</p>
          <p className="mt-1 text-xs text-teal-200/50">
            Sensitive actions will appear here as they happen.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-teal-400/15">
          <table className="w-full text-left text-sm">
            <thead className="bg-[hsl(185,55%,12%)] text-[11px] uppercase tracking-wide text-teal-200/50">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Entity</th>
                <th className="px-3 py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-teal-400/10">
              {entries.map((e) => (
                <tr key={e.id} className="bg-[hsl(185,55%,10%)] align-top hover:bg-[hsl(185,55%,12%)]">
                  <td className="whitespace-nowrap px-3 py-2 text-[11px] text-teal-200/60">
                    {format(new Date(e.created_at), "d MMM HH:mm:ss")}
                  </td>
                  <td className="px-3 py-2 text-teal-100">{e.actor_display_name || "—"}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="border-teal-400/30 bg-teal-500/10 text-[10px] text-teal-200">
                      {e.action_type}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-teal-100/80">
                    <span className="text-teal-200/50">{e.entity_type}</span>
                    {e.entity_label ? ` · ${e.entity_label}` : ""}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-teal-200/60">
                    {e.old_value || e.new_value ? (
                      <span className="font-mono">
                        {e.old_value ? JSON.stringify(e.old_value) : "∅"}
                        {" → "}
                        {e.new_value ? JSON.stringify(e.new_value) : "∅"}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AuditLog;
