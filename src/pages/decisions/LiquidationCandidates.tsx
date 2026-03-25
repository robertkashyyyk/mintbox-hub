import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Flame } from "lucide-react";

const LiquidationCandidates = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-white">Liquidation Candidates</h2>
        <p className="text-white/60">
          Products recommended for clearance or fire sale.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Flame className="h-5 w-5 text-orange-500" />
            <CardTitle>Coming Soon</CardTitle>
          </div>
          <CardDescription>
            This module will identify slow-moving, aging, or obsolete inventory that should be 
            marked for liquidation to free up capital and warehouse space.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p><strong>Planned features:</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Slow-mover identification by days in stock</li>
              <li>Inventory aging analysis</li>
              <li>Fire sale pricing recommendations</li>
              <li>ROI calculations for liquidation scenarios</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default LiquidationCandidates;
