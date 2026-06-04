import { useNavigate } from "react-router-dom";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ruler, Images, PoundSterling, Type, Package, Globe } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import discoveryBanner from "@/assets/banners/discovery-banner.jpg";

type Tool = {
  title: string;
  description: string;
  icon: typeof Ruler;
  onClick?: () => void;
  comingSoon?: boolean;
};

const WebSearcherIndex = () => {
  const navigate = useNavigate();

  const tools: Tool[] = [
    {
      title: "Dims & Weights",
      description:
        "Find missing product dimensions & weights from the web by barcode or brand + part number. Reviewed before saving.",
      icon: Ruler,
      onClick: () => navigate("/discovery/web-searcher/dims-weights"),
    },
    { title: "Images", description: "Source missing product images from the web.", icon: Images, comingSoon: true },
    { title: "Prices", description: "Look up competitor and market prices.", icon: PoundSterling, comingSoon: true },
    { title: "Titles", description: "Generate and improve product titles.", icon: Type, comingSoon: true },
    { title: "Products", description: "Discover new products to add to the catalogue.", icon: Package, comingSoon: true },
  ];

  return (
    <div className="space-y-2">
      <ModuleHeader
        title="Web Searcher"
        description="Agents that enrich the catalogue from the open web — every result is reviewed before anything is saved."
        icon={Globe}
        backgroundImage={discoveryBanner}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tools.map((t) => (
          <Card
            key={t.title}
            className={
              t.comingSoon
                ? "bg-card opacity-60 cursor-not-allowed"
                : "cursor-pointer bg-card hover:bg-card/80 hover:border-pd-accent/60 transition-colors duration-150 group"
            }
            onClick={t.comingSoon ? undefined : t.onClick}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <t.icon className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-base flex items-center gap-2">
                  {t.title}
                  {t.comingSoon && (
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      Coming soon
                    </Badge>
                  )}
                </CardTitle>
              </div>
              <CardDescription className="text-xs">{t.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default WebSearcherIndex;
