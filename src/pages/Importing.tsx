import { ImportRulesManager } from "@/components/importing/ImportRulesManager";
import { ProductCacheUpload } from "@/components/importing/ProductCacheUpload";
import { MintsoftProductPull } from "@/components/importing/MintsoftProductPull";
import { ImportHistory } from "@/components/importing/ImportHistory";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Importing = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Feed Imports</h2>
        <p className="text-muted-foreground">
          Import product data via manual upload (PUSH) or directly from Mintsoft (PULL). Configure import rules to control which SKUs are included.
        </p>
      </div>

      <Tabs defaultValue="push" className="space-y-6">
        <TabsList>
          <TabsTrigger value="push">Product PUSH</TabsTrigger>
          <TabsTrigger value="pull">Product PULL</TabsTrigger>
          <TabsTrigger value="rules">Import Rules</TabsTrigger>
          <TabsTrigger value="history">Import History</TabsTrigger>
        </TabsList>

        <TabsContent value="push" className="space-y-6">
          <ProductCacheUpload />
        </TabsContent>

        <TabsContent value="pull" className="space-y-6">
          <MintsoftProductPull />
        </TabsContent>

        <TabsContent value="rules" className="space-y-6">
          <ImportRulesManager />
        </TabsContent>

        <TabsContent value="history" className="space-y-6">
          <ImportHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default Importing;
