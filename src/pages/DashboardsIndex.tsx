import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard, Package, BarChart3, Monitor } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import dashboardsBanner from "@/assets/banners/dashboards-banner.jpg";

const DashboardsIndex = () => {
  const navigate = useNavigate();

  const dashboards = [
    { title: "Warehouse Performance", description: "Real-time overview of warehouse operations. Ideal for wall-mounted displays.", icon: LayoutDashboard, path: "/dashboards/warehouse" },
    { title: "Packing Area Display", description: "Focused metrics for packing stations. Track pack rates and queue depth.", icon: Package, path: "/dashboards/packing" },
    { title: "Weekly Summary", description: "Week-over-week performance trends and daily comparisons.", icon: BarChart3, path: "/dashboards/weekly" },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader title="Dashboards" description="Performance displays for warehouse screens and management oversight." icon={Monitor} backgroundImage={dashboardsBanner} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {dashboards.map((dashboard) => (
          <Card key={dashboard.path} className="cursor-pointer bg-card hover:border-primary/50 transition-all hover:shadow-lg group" onClick={() => navigate(dashboard.path)}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <dashboard.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base">{dashboard.title}</CardTitle>
              </div>
              <CardDescription className="text-xs">{dashboard.description}</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Monitor className="h-3 w-3" />
                <span>Optimised for large displays</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DashboardsIndex;
