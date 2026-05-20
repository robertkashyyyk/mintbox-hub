import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SkuLogicTab } from "@/components/admin/sku-transformations/SkuLogicTab";
import { RulesTab } from "@/components/admin/sku-transformations/RulesTab";

const SkuTransformations = () => {
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SKU Transformations</h1>
          <p className="text-sm text-muted-foreground">
            Classify SKUs and define how procurement packs and multiplier SKUs map to base stock units.
            Phase 2: admin/classification only — no operational behaviour changes yet.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin")} className="text-pd-accent">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
        </Button>
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
