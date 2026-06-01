import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag, ShoppingCart, Gauge, Plug, Sparkles } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import decisionsBanner from "@/assets/banners/decisions-banner.jpg";

const DecisionsIndex = () => {
  const navigate = useNavigate();

  const options = [
    { title: "Buy Recommendations", description: "AI-driven purchase order suggestions based on velocity", icon: ShoppingBag, onClick: () => navigate("/decisions/buying") },
    { title: "Purchase Orders", description: "Create and manage purchase orders for suppliers", icon: ShoppingCart, onClick: () => navigate("/execution/purchase-orders") },
    { title: "LSA Calibration", description: "Review and adjust listing strategy advisor settings", icon: Gauge, onClick: () => navigate("/decisions/lsa-calibration") },
    { title: "3D Reprice", description: "Trigger repricing runs via 3D Sellers integration", icon: Plug, onClick: () => navigate("/decisions/threeds-reprice") },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader title="Decisions" description="AI-driven buying, pricing and liquidation recommendations." icon={Sparkles} backgroundImage={decisionsBanner} />
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

export default DecisionsIndex;
