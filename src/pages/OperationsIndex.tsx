import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard, FileText, Activity, RefreshCw, Gauge } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import operationsBanner from "@/assets/banners/operations-banner.jpg";

const OperationsIndex = () => {
  const navigate = useNavigate();

  const options = [
    { title: "Dashboard", description: "Operational health at a glance - backorders, throughput, exceptions", icon: LayoutDashboard, onClick: () => navigate("/operations/dashboard"), primary: true },
    { title: "Order Telemetry", description: "Order issue detection, problem tracking and operational actions", icon: Activity, onClick: () => navigate("/operations/order-telemetry") },
    { title: "Reports", description: "Weekly ops reports and subscriber management", icon: FileText, onClick: () => navigate("/operations/reports") },
    { title: "Monitoring", description: "Track order status snapshots and daily progress", icon: Activity, onClick: () => navigate("/operations/monitoring") },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader title="Operations" description="Dashboard, reports, monitoring, and system health." icon={Activity} backgroundImage={operationsBanner} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {options.map((option) => (
          <Card key={option.title} className={`cursor-pointer bg-card hover:border-primary/50 transition-all hover:shadow-lg group ${option.primary ? 'border-primary/30' : ''}`} onClick={option.onClick}>
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

export default OperationsIndex;
