import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, AlertTriangle, Clock, Package, Sparkles, Tag, Image as ImageIcon, HelpCircle, Link2Off } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ModuleHeader from "@/components/ModuleHeader";

const HousekeepingIndex = () => {
  const navigate = useNavigate();

  const { data: counts, isLoading } = useQuery({
    queryKey: ["housekeeping-counts"],
    queryFn: async () => {
      const since = new Date(Date.now() - 28 * 86400000).toISOString();
      const [missingCosts, dirtRecent, pendingImages, discoveryQ, missingBarcodes, lsaUnmatched, orphans, dirtListings] = await Promise.all([
        supabase.from("products_cache").select("id", { count: "exact", head: true })
          .is("cost_price", null).eq("discontinued", false).eq("quarantined", false),
        supabase.from("order_line_economics").select("sku", { count: "exact", head: true })
          .eq("good_dirt", "Dirt").gte("order_date", since),
        supabase.from("pending_images").select("id", { count: "exact", head: true }).is("reviewed_at", null),
        supabase.from("products_cache").select("id", { count: "exact", head: true })
          .eq("discovery_source", "order").eq("discontinued", false),
        supabase.from("products_cache").select("id", { count: "exact", head: true })
          .is("barcode", null).eq("discontinued", false).eq("quarantined", false),
        (supabase as any).from("lsa_unmatched_skus").select("sku", { count: "exact", head: true }),
        (supabase as any).from("vw_orphan_skus").select("id", { count: "exact", head: true }).eq("is_true_sku", true),
        (supabase as any).from("threeds_sku_aliases").select("dirt_sku", { count: "exact", head: true }),
      ]);
      return {
        missingCosts: missingCosts.count ?? 0,
        dirtRecent: dirtRecent.count ?? 0,
        pendingImages: pendingImages.count ?? 0,
        discoveryQ: discoveryQ.count ?? 0,
        missingBarcodes: missingBarcodes.count ?? 0,
        lsaUnmatched: lsaUnmatched.count ?? 0,
        orphans: orphans.count ?? 0,
        dirtListings: dirtListings.count ?? 0,
      };
    },
  });

  const tiles = [
    {
      title: "Missing Costs",
      description: "Active SKUs without a cost_price set — blocks profit calculation.",
      icon: AlertCircle,
      severity: "destructive" as const,
      count: counts?.missingCosts,
      path: "/intelligence/missing-costs",
    },
    {
      title: "Dirt SKUs",
      description: "SKUs sold recently that don't match any brand prefix style.",
      icon: AlertTriangle,
      severity: "warning" as const,
      count: counts?.dirtRecent,
      path: "/intelligence/dirt-skus",
    },
    {
      title: "Pending Images",
      description: "Bulk-uploaded images waiting to be matched to a SKU.",
      icon: ImageIcon,
      severity: "warning" as const,
      count: counts?.pendingImages,
      path: "/discovery/pending-images",
    },
    {
      title: "Discovery Queue",
      description: "New SKUs found in orders awaiting enrichment.",
      icon: Sparkles,
      severity: "info" as const,
      count: counts?.discoveryQ,
      path: "/discovery/discovery-queue",
    },
    {
      title: "Missing Barcodes",
      description: "Active products without a UPC/EAN barcode set.",
      icon: Tag,
      severity: "info" as const,
      count: counts?.missingBarcodes,
      path: "/housekeeping/missing-barcodes",
    },
    {
      title: "Dirt SKUs on eBay",
      description: "Live eBay listings with an old dirt label that Mintsoft maps to a true SKU — needs updating at source.",
      icon: AlertTriangle,
      severity: "warning" as const,
      count: counts?.dirtListings,
      path: "/housekeeping/dirt-listings",
    },
    {
      title: "Carrier Remeasure",
      description: "Items flagged by carriers as wrong dimensions/weight.",
      icon: Package,
      severity: "info" as const,
      count: undefined,
      path: "/operations/carriers/remeasure",
    },
    {
      title: "Orphan SKUs",
      description: "Catalogue SKUs not linked to a Mintsoft Product ID — blocks cost/stock/LSA pushes.",
      icon: Link2Off,
      severity: "destructive" as const,
      count: counts?.orphans,
      path: "/housekeeping/orphan-skus",
    },
    {
      title: "LSA Unmatched SKUs",
      description: "SKUs in Mintsoft's Low Stock Alert file that don't exist in our cache yet.",
      icon: HelpCircle,
      severity: "warning" as const,
      count: counts?.lsaUnmatched,
      path: "/housekeeping/lsa-unmatched",
    },
  ];

  const sevColor = (s: "destructive" | "warning" | "info") =>
    s === "destructive" ? "border-destructive/40" : s === "warning" ? "border-warning/40" : "border-pd-accent/30";

  const badgeColor = (s: "destructive" | "warning" | "info", n?: number) => {
    if (!n || n === 0) return "bg-card text-foreground/50 border-border";
    if (s === "destructive") return "bg-destructive/15 text-destructive border-destructive/30";
    if (s === "warning") return "bg-warning/15 text-warning border-warning/30";
    return "bg-pd-accent/15 text-pd-accent border-pd-accent/30";
  };

  return (
    <div className="space-y-2">
      <ModuleHeader
        title="Housekeeping"
        description="The to-do board for fixing data quality issues across the catalogue and operations."
        icon={Clock}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tiles.map((t) => (
          <Card
            key={t.title}
            className={`cursor-pointer bg-card hover:bg-card/80 transition-colors duration-150 group ${sevColor(t.severity)}`}
            onClick={() => navigate(t.path)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <t.icon className="h-5 w-5 text-primary" />
                  </div>
                  <CardTitle className="text-base">{t.title}</CardTitle>
                </div>
                {isLoading ? (
                  <Skeleton className="h-6 w-12" />
                ) : (
                  <Badge variant="outline" className={badgeColor(t.severity, t.count)}>
                    {t.count ?? "—"}
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs mt-2">{t.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default HousekeepingIndex;
