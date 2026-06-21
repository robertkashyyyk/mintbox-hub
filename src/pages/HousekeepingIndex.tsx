import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, AlertTriangle, Clock, Package, Sparkles, Tag, Image as ImageIcon, HelpCircle, Link2Off } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ModuleHeader from "@/components/ModuleHeader";
import { getNavGroup } from "@/config/navigation";

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

  // Item identity (title/url/icon/description) comes from the shared nav config so this
  // board stays in sync with the sidebar; severity + live counts are page-specific.
  const meta: Record<string, { severity: "destructive" | "warning" | "info"; count?: number }> = {
    "/intelligence/missing-costs": { severity: "destructive", count: counts?.missingCosts },
    "/intelligence/dirt-skus": { severity: "warning", count: counts?.dirtRecent },
    "/housekeeping/dirt-listings": { severity: "warning", count: counts?.dirtListings },
    "/housekeeping/missing-barcodes": { severity: "info", count: counts?.missingBarcodes },
    "/operations/carriers/remeasure": { severity: "info" },
    "/housekeeping/orphan-skus": { severity: "destructive", count: counts?.orphans },
    "/housekeeping/lsa-unmatched": { severity: "warning", count: counts?.lsaUnmatched },
  };

  const tiles = [
    ...(getNavGroup("Housekeeping")?.items ?? []).map((it) => ({
      title: it.title,
      description: it.description ?? "",
      icon: it.icon,
      severity: meta[it.url]?.severity ?? ("info" as const),
      count: meta[it.url]?.count,
      path: it.url,
    })),
    // Cross-section to-dos surfaced here as data-quality tasks (these live in the
    // Discovery nav group, not Housekeeping):
    { title: "Pending Images", description: "Bulk-uploaded images waiting to be matched to a SKU.", icon: ImageIcon, severity: "warning" as const, count: counts?.pendingImages, path: "/discovery/pending-images" },
    { title: "Discovery Queue", description: "New SKUs found in orders awaiting enrichment.", icon: Sparkles, severity: "info" as const, count: counts?.discoveryQ, path: "/discovery/discovery-queue" },
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
