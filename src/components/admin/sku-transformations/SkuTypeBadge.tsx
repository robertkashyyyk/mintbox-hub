import { Badge } from "@/components/ui/badge";
import type { SkuType } from "@/hooks/useSkuTransformations";
import { cn } from "@/lib/utils";

const styles: Record<SkuType, string> = {
  BASE: "border-pd-accent/40 bg-pd-accent/15 text-pd-accent",
  PROCUREMENT_PACK: "border-warning/40 bg-warning/15 text-warning",
  MULTIPLIER: "border-primary/40 bg-primary/15 text-primary",
  BUNDLE: "border-muted-foreground/40 bg-muted/30 text-foreground",
  ALT: "border-muted-foreground/30 bg-muted/20 text-muted-foreground",
};

const labels: Record<SkuType, string> = {
  BASE: "BASE",
  PROCUREMENT_PACK: "PROCUREMENT",
  MULTIPLIER: "MULTIPLIER",
  BUNDLE: "BUNDLE",
  ALT: "ALT",
};

export function SkuTypeBadge({ type }: { type: SkuType }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[10px]", styles[type])}>
      {labels[type]}
    </Badge>
  );
}
