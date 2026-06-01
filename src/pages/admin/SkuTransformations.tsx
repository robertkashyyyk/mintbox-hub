import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowLeftRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ModuleHeader from "@/components/ModuleHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkuLogicTab } from "@/components/admin/sku-transformations/SkuLogicTab";
import { RulesTab } from "@/components/admin/sku-transformations/RulesTab";

const SkuTransformations = () => {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <ModuleHeader
          title="SKU Transformations"
          description="Classify SKUs and define how procurement packs and multiplier SKUs map to base stock units."
          icon={ArrowLeftRight}
        />
        <div className="flex-shrink-0 pt-1">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="text-pd-accent">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
          </Button>
        </div>
      </div>

      <Tabs defaultValue="logic">
        <TabsList>
          <TabsTrigger value="logic">SKU Logic</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="logic" className="mt-4">
          <SkuLogicTab />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SkuTransformations;
