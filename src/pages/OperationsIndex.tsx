import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, Activity, RefreshCw, Truck } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import operationsBanner from "@/assets/banners/operations-banner.jpg";

const OperationsIndex = () => {
  const navigate = useNavigate();

  const options = [
    { title: "Order Telemetry", description: "Order issue detection, problem tracking and operational actions", icon: Activity, onClick: () => navigate("/operations/order-telemetry") },
    { title: "Carriers", description: "Royal Mail / courier penalties — invoices, trends, and packer remeasure queue", icon: Truck, onClick: () => navigate("/operations/carriers") },
    { title: "SKU Analysis", description: "Top problem SKUs, backorder concentration, brand breakdown", icon: RefreshCw, onClick: () => navigate("/operations/sku-analysis") },
    { title: "Reports", description: "Weekly ops reports and subscriber management", icon: FileText, onClick: () => navigate("/operations/reports") },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader title="Operations" description="Dashboard, reports, monitoring, and system health." icon={Activity} backgroundImage={operationsBanner} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {options.map((option) => (
          <Card key={option.title} className={`cursor-pointer bg-card hover:bg-card/80 hover:border-pd-accent/60 transition-colors duration-150 group ${option.primary ? 'border-primary/30' : ''}`} onClick={option.onClick}>
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
