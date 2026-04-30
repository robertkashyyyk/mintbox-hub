import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingBag, Flame, TrendingDown, Package, Sparkles } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import decisionsBanner from "@/assets/banners/decisions-banner.jpg";

const DecisionsIndex = () => {
  const navigate = useNavigate();

  const options = [
    { title: "Buy Recommendations", description: "AI-driven purchase order suggestions based on velocity", icon: ShoppingBag, onClick: () => navigate("/decisions/buying") },
    { title: "Liquidation Candidates", description: "Products recommended for clearance or fire sale", icon: Flame, onClick: () => navigate("/decisions/liquidation") },
    { title: "Price Moves", description: "Suggested pricing adjustments for competitiveness", icon: TrendingDown, onClick: () => navigate("/decisions/price-moves") },
    { title: "Bundle Suggestions", description: "Product combinations for bundling opportunities", icon: Package, onClick: () => navigate("/decisions/bundles") },
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
