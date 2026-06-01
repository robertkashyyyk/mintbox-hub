import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ModuleHeader from "@/components/ModuleHeader";
import { Card } from "@/components/ui/card";
import { PageLoader } from "@/components/ui/PageLoader";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Download, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const LsaUnmatchedSkus = () => {
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["lsa-unmatched-skus"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lsa_unmatched_skus")
        .select("sku, lsa, first_seen_at, last_seen_at, seen_count, source_file")
        .order("sku", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Array<{
        sku: string;
        lsa: number;
        first_seen_at: string;
        last_seen_at: string;
        seen_count: number;
        source_file: string | null;
      }>;
    },
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return data ?? [];
    return (data ?? []).filter((r) => r.sku.toLowerCase().includes(term));
  }, [data, q]);

  const downloadCsv = () => {
    const rows = filtered;
    const header = "sku,lsa,first_seen_at,last_seen_at,source_file";
    const body = rows
      .map((r) =>
        [r.sku, r.lsa, r.first_seen_at, r.last_seen_at, r.source_file ?? ""]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([header + "\n" + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lsa-unmatched-skus-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <ModuleHeader
        title="LSA Unmatched SKUs"
        description="SKUs present in Mintsoft's Low Stock Alert SFTP file but missing from our product cache — likely never discovered via orders or catalogue sync."
        icon={AlertTriangle}
      />

      <Card className="p-4 bg-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by SKU…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
              {filtered.length.toLocaleString()} shown
            </Badge>
            <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!filtered.length}>
              <Download className="h-4 w-4 mr-2" /> CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card className="bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">SKU</th>
              <th className="text-right px-4 py-2 font-medium">LSA</th>
              <th className="text-left px-4 py-2 font-medium">First seen</th>
              <th className="text-left px-4 py-2 font-medium">Last seen</th>
              <th className="text-left px-4 py-2 font-medium">Source file</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="p-0 border-0">
                <PageLoader rows={8} columns={[140, 80, 120, 120, 120]} label="Loading LSA unmatched SKUs" />
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No unmatched SKUs recorded yet. Trigger an LSA sync to populate.
                </td>
              </tr>
            ) : (
              filtered.map((r, i) => (
                <tr key={r.sku} className={i % 2 ? "bg-muted/10" : ""}>
                  <td className="px-4 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-4 py-2 text-right">{r.lsa}</td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(r.first_seen_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(r.last_seen_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground text-xs truncate max-w-xs">
                    {r.source_file ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
};

export default LsaUnmatchedSkus;
