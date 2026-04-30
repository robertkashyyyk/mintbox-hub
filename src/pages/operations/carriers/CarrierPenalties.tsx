import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

const CarrierPenalties = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Penalties Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Anchor the weekly penalty cost and track reduction over time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <CardTitle>Coming soon</CardTitle>
          </div>
          <CardDescription>
            This-week / last-week / 4-week / 6-week averages, weekly chart, and breakdowns by reason code and SKU.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Phase 3 — built once documents are flowing in.</p>
        </CardContent>
      </Card>
    </div>
  );
};

export default CarrierPenalties;
