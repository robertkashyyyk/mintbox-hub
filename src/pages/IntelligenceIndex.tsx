import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Activity, DollarSign, Calendar, BarChart3, AlertCircle, AlertTriangle, PoundSterling, FileBarChart2, LayoutDashboard } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import intelligenceBanner from "@/assets/banners/intelligence-banner.jpg";
import { getNavGroup } from "@/config/navigation";

const IntelligenceIndex = () => {
  const navigate = useNavigate();

  const options = (getNavGroup("Intelligence")?.items ?? []).map((it) => ({
    title: it.title,
    description: it.description,
    icon: it.icon,
    onClick: () => navigate(it.url),
  }));

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
