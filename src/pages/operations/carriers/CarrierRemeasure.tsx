import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

const CarrierRemeasure = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Remeasure Queue</h1>
        <p className="text-muted-foreground mt-1">
          Packer worklist — SKUs flagged by penalties to re-measure and re-categorise.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <CardTitle>Coming soon</CardTitle>
          </div>
          <CardDescription>
            One row per SKU with current declared dimensions, total £ impact, and actions to record the new measurement or escalate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 4 — needs tracking-number capture wired up first.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default CarrierRemeasure;
