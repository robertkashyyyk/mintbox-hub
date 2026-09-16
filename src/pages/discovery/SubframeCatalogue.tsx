import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookOpen, Printer, Search, ImageOff } from "lucide-react";
import catalogueData from "@/data/subframeCatalogue.json";

interface SubframeRow {
  num: number;
  code: string;          // PD-SUB-NN (customer/trade-facing code)
  cat: string;           // category, e.g. FRONT SUBFRAME
  title: string;
  vehicle: string;
  ref: string;           // supplier / manufacturer reference
  oe: string[];
  internal_sku: string | null; // ASC-SUB-NN in Mintsoft / products_cache
  image: string | null;        // filename under /subframe-catalogue/
  supplier?: string;
  is_new?: boolean;
}

const CATALOGUE = catalogueData as SubframeRow[];

const ALL = "All";

const SubframeCatalogue = () => {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>(ALL);

  // Live stock for the internal SKUs, joined by ASC-SUB code.
  const { data: stockMap } = useQuery({
    queryKey: ["subframe-catalogue-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products_cache")
        .select("sku, current_stock")
        .ilike("sku", "ASC-SUB-%");
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: { sku: string; current_stock: number | null }) => {
        map[r.sku] = Number(r.current_stock ?? 0);
      });
      return map;
    },
  });

  const categories = useMemo(() => {
    const set = new Set(CATALOGUE.map((r) => r.cat).filter(Boolean));
    return [ALL, ...Array.from(set).sort()];
  }, []);

  const makesCount = useMemo(() => {
    const set = new Set(
      CATALOGUE.map((r) => (r.vehicle || "").split(/\s+/)[0]).filter(Boolean),
    );
    return set.size;
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CATALOGUE.filter((r) => {
      if (cat !== ALL && r.cat !== cat) return false;
      if (!needle) return true;
      const hay = [
        r.code,
        r.internal_sku ?? "",
        r.title,
        r.vehicle,
        r.ref,
        r.supplier ?? "",
        ...r.oe,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    }).sort((a, b) => a.num - b.num);
  }, [q, cat]);

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .sf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
          .sf-card { break-inside: avoid; }
          body { background: #fff !important; }
        }
      `}</style>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold text-foreground">Subframe &amp; Suspension Catalogue</h1>
            <p className="text-foreground/60">
              OE-quality subframes, rear axles, crossmembers and suspension arms · V4 · internal / trade reference
            </p>
          </div>
        </div>
        <Button variant="outline" className="no-print" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="SKUs listed" value={CATALOGUE.length} />
        <StatTile label="Part types" value={categories.length - 1} />
        <StatTile label="Vehicle makes" value={makesCount} />
        <StatTile label="New this issue" value={CATALOGUE.filter((r) => r.is_new).length} />
      </div>

      {/* Toolbar */}
      <div className="no-print flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
          <Input
            placeholder="Search vehicle, OE number, code or SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={c === cat ? "default" : "outline"}
              onClick={() => setCat(c)}
            >
              {c === ALL ? "All" : c}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-foreground/60">
        {filtered.length} of {CATALOGUE.length} shown
      </p>

      {/* Grid */}
      <div className="sf-grid grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => {
          const stock = r.internal_sku ? stockMap?.[r.internal_sku] : undefined;
          return (
            <Card key={r.code} className="sf-card overflow-hidden">
              <div className="flex aspect-[4/3] items-center justify-center border-b bg-white">
                {r.image ? (
                  <img
                    src={`/subframe-catalogue/${r.image}`}
                    alt={`${r.code} ${r.title}`}
                    className="h-full w-full object-contain p-2"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-foreground/30">
                    <ImageOff className="h-8 w-8" />
                    <span className="text-xs">Photo pending</span>
                  </div>
                )}
              </div>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{r.code}</span>
                  <div className="flex items-center gap-1">
                    {r.is_new && <Badge className="bg-emerald-600 hover:bg-emerald-600">NEW</Badge>}
                    <Badge variant="secondary" className="text-[10px]">{r.cat}</Badge>
                  </div>
                </div>
                <div>
                  <p className="font-medium leading-tight">{r.title}</p>
                  <p className="text-sm text-foreground/70">{r.vehicle}</p>
                </div>
                {r.oe.length > 0 && (
                  <p className="text-xs leading-relaxed text-foreground/55">
                    <span className="font-semibold text-foreground/70">OE: </span>
                    {r.oe.join(" · ")}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                  {r.internal_sku ? (
                    <span className="font-mono text-foreground/60">{r.internal_sku}</span>
                  ) : (
                    <span className="italic text-amber-600">not in Mintsoft yet</span>
                  )}
                  {stock !== undefined && (
                    <Badge
                      variant="outline"
                      className={stock > 0 ? "border-emerald-500 text-emerald-600" : "border-foreground/20 text-foreground/50"}
                    >
                      {stock > 0 ? `${stock} in stock` : "0 in stock"}
                    </Badge>
                  )}
                  {r.supplier && <span className="text-foreground/50">{r.supplier} {r.ref}</span>}
                  {!r.supplier && r.ref && <span className="text-foreground/40">Ref {r.ref}</span>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="py-12 text-center text-foreground/50">No parts match “{q}”.</p>
      )}
    </div>
  );
};

const StatTile = ({ label, value }: { label: string; value: number }) => (
  <Card>
    <CardContent className="p-4">
      <p className="text-2xl font-bold text-foreground">{value}</p>
      <p className="text-xs uppercase tracking-wide text-foreground/50">{label}</p>
    </CardContent>
  </Card>
);

export default SubframeCatalogue;
