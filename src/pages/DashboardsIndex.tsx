import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, BarChart3, Monitor } from "lucide-react";

const DashboardsIndex = () => {
  const navigate = useNavigate();

  const dashboards = [
    {
      title: "Warehouse Performance",
      description: "Real-time overview of warehouse operations. Ideal for wall-mounted displays.",
      icon: LayoutDashboard,
      path: "/dashboards/warehouse",
      color: "bg-blue-500/10 text-blue-500",
    },
    {
      title: "Packing Area Display",
      description: "Focused metrics for packing stations. Track pack rates and queue depth.",
      icon: Package,
      path: "/dashboards/packing",
      color: "bg-green-500/10 text-green-500",
    },
    {
      title: "Weekly Summary",
      description: "Week-over-week performance trends and daily comparisons.",
      icon: BarChart3,
      path: "/dashboards/weekly",
      color: "bg-purple-500/10 text-purple-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboards</h1>
        <p className="text-muted-foreground">
          Performance displays for warehouse screens and management oversight
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {dashboards.map((dashboard) => (
          <Card 
            key={dashboard.path}
            className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02]"
            onClick={() => navigate(dashboard.path)}
          >
            <CardHeader>
              <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${dashboard.color} mb-2`}>
                <dashboard.icon className="h-6 w-6" />
              </div>
              <CardTitle>{dashboard.title}</CardTitle>
              <CardDescription>{dashboard.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Monitor className="h-4 w-4" />
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
