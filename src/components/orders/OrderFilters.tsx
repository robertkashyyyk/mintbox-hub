import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import type { TelemetryFilters } from "@/hooks/useOrderTelemetry";

interface Props {
  filters: TelemetryFilters;
  setFilters: React.Dispatch<React.SetStateAction<TelemetryFilters>>;
  filterOptions: { brands: string[]; channels: string[] };
}

export default function OrderFilters({ filters, setFilters, filterOptions }: Props) {
  const update = (patch: Partial<TelemetryFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  const hasFilters = filters.search || filters.brand || filters.channel;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[220px] max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by order, SKU, customer ref or product…"
          className="pl-8"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
        />
      </div>

      <Select value={filters.brand || "__all__"} onValueChange={(v) => update({ brand: v === "__all__" ? "" : v })}>
        <SelectTrigger className="w-[180px]"><SelectValue placeholder="All brands" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All brands</SelectItem>
          {filterOptions.brands.map((b) => (
            <SelectItem key={b} value={b}>{b}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.channel || "__all__"} onValueChange={(v) => update({ channel: v === "__all__" ? "" : v })}>
        <SelectTrigger className="w-[180px]"><SelectValue placeholder="All channels" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All channels</SelectItem>
          {filterOptions.channels.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => update({ search: "", brand: "", channel: "" })}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
