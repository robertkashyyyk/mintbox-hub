import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Maximize2, RefreshCw, Package, Clock, Target, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import { useState, useEffect } from "react";

const PackingAreaDisplay = () => {
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Simulated data - will be replaced with real data
  const metrics = {
    readyToPack: 47,
    packedToday: 312,
    packedThisHour: 28,
    targetPerHour: 40,
    avgPackTime: "2m 34s",
  };

  const hourlyProgress = (metrics.packedThisHour / metrics.targetPerHour) * 100;

  useEffect(() => {
    const interval = setInterval(() => {
      setLastUpdated(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Packing Area</h1>
          <p className="text-muted-foreground">Live packing station metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Updated: {format(lastUpdated, "HH:mm:ss")}
          </Badge>
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Maximize2 className="h-4 w-4 mr-2" />
            Fullscreen
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Package className="h-4 w-4" />
              Ready to Pack
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-amber-500">{metrics.readyToPack}</div>
            <p className="text-sm text-muted-foreground mt-2">Orders in queue</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Packed Today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold text-green-500">{metrics.packedToday}</div>
            <p className="text-sm text-muted-foreground mt-2">Since 7:00 AM</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Target className="h-4 w-4" />
              This Hour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold">{metrics.packedThisHour}</div>
            <div className="mt-2">
              <Progress value={hourlyProgress} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                Target: {metrics.targetPerHour}/hr
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Avg Pack Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-5xl font-bold">{metrics.avgPackTime}</div>
            <p className="text-sm text-muted-foreground mt-2">Per order</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hourly Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <p>Hourly packing chart will appear here</p>
            <p className="text-sm mt-2">Data sourced from order dispatch timestamps</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PackingAreaDisplay;
