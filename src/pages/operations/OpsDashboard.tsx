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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light" onClick={() => navigate("/operations")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-white">Operations Dashboard</h1>
            <p className="text-sm text-white/60">
              Are we winning or losing today — and why?
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-white/60">
            Last updated: {format(lastRefresh, 'HH:mm:ss')}
          </span>
          <Button 
            variant="outlineDark" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <BackorderHealthCard />
        <OrderFlowCard />
        <OpsExceptionsCard />
        <BackorderTrendMiniChart />
      </div>
    </div>
  );
};

export default OpsDashboard;
