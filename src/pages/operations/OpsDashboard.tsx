import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { BackorderHealthCard } from "@/components/operations/BackorderHealthCard";
import { OrderFlowCard } from "@/components/operations/OrderFlowCard";
import { OpsExceptionsCard } from "@/components/operations/OpsExceptionsCard";
import { BackorderTrendMiniChart } from "@/components/operations/BackorderTrendMiniChart";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";

const OpsDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['ops-backorder-delta'] });
    await queryClient.invalidateQueries({ queryKey: ['ops-order-flow'] });
    await queryClient.invalidateQueries({ queryKey: ['ops-exceptions'] });
    await queryClient.invalidateQueries({ queryKey: ['ops-backorder-trend-7d'] });
    setLastRefresh(new Date());
    setIsRefreshing(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => navigate("/operations")}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h1 className="text-2xl font-bold">Operations Dashboard</h1>
                <p className="text-sm text-muted-foreground">
                  Are we winning or losing today — and why?
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                Last updated: {format(lastRefresh, 'HH:mm:ss')}
              </span>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Section A - Backorder Health */}
          <BackorderHealthCard />
          
          {/* Section B - Order Flow */}
          <OrderFlowCard />
          
          {/* Section C - Exceptions */}
          <OpsExceptionsCard />
          
          {/* Section D - 7-Day Trend */}
          <BackorderTrendMiniChart />
        </div>
      </main>
    </div>
  );
};

export default OpsDashboard;
