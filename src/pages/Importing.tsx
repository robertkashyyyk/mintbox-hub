import { ImportRulesManager } from "@/components/importing/ImportRulesManager";
import { ProductCacheUpload } from "@/components/importing/ProductCacheUpload";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Importing = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Importing SKUs</h2>
        <p className="text-muted-foreground">
          Upload product data and configure import rules to control which SKUs are included during synchronization.
        </p>
      </div>

      <Tabs defaultValue="upload" className="space-y-6">
        <TabsList>
          <TabsTrigger value="upload">Product Upload</TabsTrigger>
          <TabsTrigger value="rules">Import Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="space-y-6">
          <ProductCacheUpload />
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <ImportRulesManager />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Importing;
