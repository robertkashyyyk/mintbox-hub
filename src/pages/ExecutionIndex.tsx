import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, DollarSign, RefreshCw, Copy, PlayCircle } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import executionBanner from "@/assets/banners/execution-banner.jpg";

const ExecutionIndex = () => {
  const navigate = useNavigate();

  const options = [
    { title: "Purchase Orders", description: "Create and manage purchase orders for suppliers", icon: ShoppingCart, onClick: () => navigate("/execution/purchase-orders") },
    { title: "Price Hunter", description: "eBay price checks and automated pricing updates", icon: DollarSign, onClick: () => navigate("/execution/price-hunter") },
    { title: "Remote Stock Updates", description: "Configure and manage remote stock feed types", icon: RefreshCw, onClick: () => navigate("/execution/remote-stock-updates") },
    { title: "Listing Cloner", description: "Create and manage eBay listings from templates", icon: Copy, onClick: () => navigate("/execution/listing-cloner") },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader title="Execution" description="Execute purchase, pricing and listing actions." icon={PlayCircle} backgroundImage={executionBanner} />
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

export default ExecutionIndex;
