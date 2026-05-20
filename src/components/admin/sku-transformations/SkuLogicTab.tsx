import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pencil, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { useSkuLogicList, type SkuLogicRow, type SkuType } from "@/hooks/useSkuTransformations";
import { SkuTypeBadge } from "./SkuTypeBadge";
import { SkuEditSheet } from "./SkuEditSheet";

const LEGEND: { type: SkuType; meaning: string }[] = [
  { type: "BASE", meaning: "Warehouse truth — the real stock unit" },
  { type: "PROCUREMENT_PACK", meaning: "Supplier ordering / receipt only, transient stock" },
  { type: "MULTIPLIER", meaning: "Sellable SKU that resolves to N × base" },
  { type: "BUNDLE", meaning: "Multiple different base SKUs sold together" },
  { type: "ALT", meaning: "Alias / legacy mapping to a base" },
];

export function SkuLogicTab() {
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState<SkuType | "ALL">("ALL");
  const [editing, setEditing] = useState<SkuLogicRow | null>(null);

  const { data, isLoading } = useSkuLogicList({ search, page, typeFilter });
  const totalPages = data ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="grid grid-cols-1 gap-2 p-4 md:grid-cols-5">
          {LEGEND.map((l) => (
            <div key={l.type} className="flex items-start gap-2">
              <SkuTypeBadge type={l.type} />
              <p className="text-[11px] text-muted-foreground leading-snug">{l.meaning}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex flex-1 items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setSearch(pendingSearch.trim()); setPage(0); }}
        >
          <Input
            placeholder="Search SKU, name, or brand…"
            value={pendingSearch}
            onChange={(e) => setPendingSearch(e.target.value)}
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" size="sm">
            <Search className="h-4 w-4 mr-1" />Search
          </Button>
        </form>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as SkuType | "ALL"); setPage(0); }}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="BASE">BASE</SelectItem>
            <SelectItem value="PROCUREMENT_PACK">PROCUREMENT_PACK</SelectItem>
            <SelectItem value="MULTIPLIER">MULTIPLIER</SelectItem>
            <SelectItem value="BUNDLE">BUNDLE</SelectItem>
            <SelectItem value="ALT">ALT</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Brand</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Base SKU</TableHead>
              <TableHead>Multiplier / Pack</TableHead>
              <TableHead>Supplier order</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Loading…</TableCell></TableRow>
            )}
            {!isLoading && (data?.rows.length ?? 0) === 0 && (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">No SKUs.</TableCell></TableRow>
            )}
            {data?.rows.map((r) => (
              <TableRow key={r.sku} className="hover:bg-muted/30">
                <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                <TableCell className="max-w-[260px] truncate">{r.name ?? "—"}</TableCell>
                <TableCell>{r.brand ?? "—"}</TableCell>
                <TableCell><SkuTypeBadge type={r.sku_type} /></TableCell>
                <TableCell className="font-mono text-xs">{r.base_sku ?? (r.sku_type === "BASE" ? "—" : <span className="text-warning">unset</span>)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.sku_type === "PROCUREMENT_PACK" ? (r.conversion_multiplier ?? "—")
                    : r.sku_type === "BASE" ? (r.procurement_pack_size ?? "—")
                    : "—"}
                </TableCell>
                <TableCell className="font-mono text-xs">{r.supplier_order_sku ?? "—"}</TableCell>
                <TableCell>
                  <FlagDots row={r} />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => setEditing(r)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {data ? `${data.count} SKUs · page ${page + 1} of ${totalPages}` : ""}
        </p>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <SkuEditSheet open={!!editing} onClose={() => setEditing(null)} row={editing} />
    </div>
  );
}

function FlagDots({ row }: { row: SkuLogicRow }) {
  const flags = [
    { on: row.allow_marketplace_sale, label: "M", title: "Allow marketplace sale" },
    { on: row.allow_picking, label: "P", title: "Allow picking" },
    { on: row.allow_stock_holding, label: "S", title: "Allow stock holding" },
    { on: row.auto_convert_on_receipt, label: "A", title: "Auto-convert on receipt" },
  ];
  return (
    <div className="flex gap-1">
      {flags.map((f) => (
        <span
          key={f.label}
          title={`${f.title}: ${f.on ? "on" : "off"}`}
          className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-mono ${
            f.on ? "bg-pd-accent/20 text-pd-accent" : "bg-muted/40 text-muted-foreground"
          }`}
        >
          {f.label}
        </span>
      ))}
    </div>
  );
}
