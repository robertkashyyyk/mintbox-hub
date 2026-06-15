import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Activity, DollarSign, Calendar, BarChart3, AlertCircle, AlertTriangle, PoundSterling, FileBarChart2 } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import intelligenceBanner from "@/assets/banners/intelligence-banner.jpg";

const IntelligenceIndex = () => {
  const navigate = useNavigate();

  const options = [
    { title: "Profit Intelligence", description: "Weekly revenue, costs, channel fees and POR.", icon: DollarSign, onClick: () => navigate("/intelligence/profit") },
    { title: "Standing Reports", description: "Recurring reports — e.g. repricing payoff, tracked over time.", icon: FileBarChart2, onClick: () => navigate("/intelligence/standing-reports") },
    { title: "Velocity & Coverage", description: "Sales velocity and inventory coverage analysis", icon: TrendingUp, onClick: () => navigate("/intelligence/velocity") },
    { title: "Stock Health", description: "Stock levels, overstock, and shortage analysis", icon: Activity, onClick: () => navigate("/intelligence/stock-health") },
    { title: "Stock Valuation", description: "Cost × on-hand by SKU, brand and health category.", icon: PoundSterling, onClick: () => navigate("/intelligence/stock-valuation") },
    { title: "Pricing Signals", description: "Market pricing trends and competitor intelligence", icon: DollarSign, onClick: () => navigate("/intelligence/pricing") },
    { title: "Seasonality", description: "Seasonal demand patterns and forecasts", icon: Calendar, onClick: () => navigate("/intelligence/seasonality") },
    { title: "Missing Costs", description: "Active SKUs without a cost price set.", icon: AlertCircle, onClick: () => navigate("/intelligence/missing-costs") },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader title="Intelligence" description="Velocity, stock health and coverage insights." icon={BarChart3} backgroundImage={intelligenceBanner} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {options.map((option) => (
          <Card key={option.title} className="cursor-pointer bg-card hover:bg-card/80 hover:border-pd-accent/60 transition-colors duration-150 group" onClick={option.onClick}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <option.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{option.title}</CardTitle>
              </div>
              <CardDescription className="text-xs">{option.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default IntelligenceIndex;
