import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Search, Truck, Package, PoundSterling } from "lucide-react";
import {
  useBuyRecommendations,
  type PurchasingRequirementRow,
} from "@/hooks/useBuyRecommendations";

const formatGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n || 0);

const formatGBPDetailed = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

const UNASSIGNED_KEY = "__unassigned__";

const getStatusBadge = (row: PurchasingRequirementRow) => {
  if (row.back_order_qty > 0 && row.current_stock < row.lsa) {
    return <Badge variant="destructive">Critical</Badge>;
  }
  if (row.back_order_qty > 0) {
    return <Badge className="bg-orange-500 hover:bg-orange-600 text-white">Backorder</Badge>;
  }
  if (row.current_stock < row.lsa) {
    return <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black">Low Stock</Badge>;
  }
  return <Badge variant="secondary">OK</Badge>;
};

const BuyRecommendations = () => {
  const { requirements, summary, lastSynced, loading } = useBuyRecommendations();
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [openItems, setOpenItems] = useState<string[]>([]);

  // Filter requirements by search
  const filteredRequirements = useMemo(() => {
    if (!search.trim()) return requirements;
    const q = search.toLowerCase();
    return requirements.filter(
      (r) =>
        r.sku.toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q)
    );
  }, [requirements, search]);

  // Group by supplier
  const bySupplier = useMemo(() => {
    const map = new Map<string, PurchasingRequirementRow[]>();
    for (const r of filteredRequirements) {
      const key = r.supplier_id || UNASSIGNED_KEY;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [filteredRequirements]);

  // Build supplier sections (recompute summary from filtered data so search affects it)
  const supplierSections = useMemo(() => {
    const sections = Array.from(bySupplier.entries()).map(([key, rows]) => {
      const skuCount = rows.length;
      const totalUnits = rows.reduce(
        (acc, r) => acc + (overrides[r.sku] ?? r.reorder_qty),
        0
      );
      const estCost = rows.reduce(
        (acc, r) =>
          acc + (overrides[r.sku] ?? r.reorder_qty) * (r.cost_price || 0),
        0
      );
      const supplierName =
        rows[0]?.supplier_name ||
        (key === UNASSIGNED_KEY ? "Unassigned (no supplier match)" : "Unknown");
      return {
        key,
        supplierId: key === UNASSIGNED_KEY ? null : key,
        supplierName,
        skuCount,
        totalUnits,
        estCost,
        rows,
      };
    });
    sections.sort((a, b) => b.estCost - a.estCost);
    return sections;
  }, [bySupplier, overrides]);

  // Top stats — use filtered data for live feedback
  const stats = useMemo(() => {
    const supplierCount = supplierSections.length;
    const totalSkus = supplierSections.reduce((a, s) => a + s.skuCount, 0);
    const totalSpend = supplierSections.reduce((a, s) => a + s.estCost, 0);
    return { supplierCount, totalSkus, totalSpend };
  }, [supplierSections]);

  const allKeys = supplierSections.map((s) => s.key);
  const allOpen = openItems.length === allKeys.length && allKeys.length > 0;

  const toggleAll = () => {
    setOpenItems(allOpen ? [] : allKeys);
  };

  const handleQtyChange = (sku: string, value: string) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setOverrides((prev) => ({ ...prev, [sku]: n }));
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-white">
              Buy Recommendations
            </h2>
            <p className="text-white/60">
              Suggested purchase orders grouped by supplier. Advisory only.
            </p>
          </div>
          {lastSynced && (
            <p className="text-sm text-muted-foreground">
              Stock last synced:{" "}
              <span className="text-white/80">
                {new Date(lastSynced).toLocaleString("en-GB")}
              </span>
            </p>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Suppliers to order from
              </CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.supplierCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total SKUs</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.totalSkus.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Estimated spend
              </CardTitle>
              <PoundSterling className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatGBP(stats.totalSpend)}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search SKU or product name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" onClick={toggleAll} disabled={allKeys.length === 0}>
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>

        {/* Supplier accordion */}
        {loading ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Loading recommendations...
            </CardContent>
          </Card>
        ) : supplierSections.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No purchase recommendations right now.
            </CardContent>
          </Card>
        ) : (
          <Accordion
            type="multiple"
            value={openItems}
            onValueChange={setOpenItems}
            className="space-y-3"
          >
            {supplierSections.map((section) => (
              <AccordionItem
                key={section.key}
                value={section.key}
                className="border rounded-lg bg-card px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between gap-4 w-full pr-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-base font-semibold text-left">
                        {section.supplierName}
                      </span>
                      <Badge variant="secondary">
                        {section.skuCount} SKU{section.skuCount === 1 ? "" : "s"}
                      </Badge>
                      <Badge variant="outline">
                        {section.totalUnits.toLocaleString()} units
                      </Badge>
                    </div>
                    <span className="text-base font-semibold whitespace-nowrap">
                      {formatGBP(section.estCost)}
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pb-2">
                    <div className="rounded-md border overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>SKU</TableHead>
                            <TableHead>Product Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Stock</TableHead>
                            <TableHead className="text-right">LSA</TableHead>
                            <TableHead className="text-right">Backorders</TableHead>
                            <TableHead className="text-right">On Order</TableHead>
                            <TableHead className="text-right">In Transit</TableHead>
                            <TableHead className="text-right">Suggest Qty</TableHead>
                            <TableHead className="text-right">Est. Cost</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {section.rows.map((row) => {
                            const qty = overrides[row.sku] ?? row.reorder_qty;
                            const lineCost = qty * (row.cost_price || 0);
                            return (
                              <TableRow key={row.sku}>
                                <TableCell>
                                  <Link
                                    to={`/discovery/products/${row.sku}`}
                                    className="text-primary hover:underline font-mono text-xs"
                                  >
                                    {row.sku}
                                  </Link>
                                </TableCell>
                                <TableCell className="max-w-xs truncate">
                                  {row.name || "—"}
                                </TableCell>
                                <TableCell>{getStatusBadge(row)}</TableCell>
                                <TableCell className="text-right">
                                  {row.current_stock}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {row.lsa}
                                </TableCell>
                                <TableCell className="text-right">
                                  {row.back_order_qty > 0 ? (
                                    <span className="text-orange-400 font-medium">
                                      {row.back_order_qty}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">0</span>
                                  )}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {row.on_order_qty || 0}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground">
                                  {row.open_asn_qty || 0}
                                </TableCell>
                                <TableCell className="text-right">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={qty}
                                    onChange={(e) =>
                                      handleQtyChange(row.sku, e.target.value)
                                    }
                                    className="h-8 w-20 ml-auto text-right"
                                  />
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {formatGBPDetailed(lineCost)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="flex justify-end">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0}>
                            <Button disabled variant="outline">
                              Create Draft PO
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Coming soon</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </TooltipProvider>
  );
};

export default BuyRecommendations;
