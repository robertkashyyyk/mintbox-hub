import { ImportRulesManager } from "@/components/importing/ImportRulesManager";

const Importing = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Importing SKUs</h2>
        <p className="text-muted-foreground">
          Configure import rules to control which SKUs are included during data synchronization.
        </p>
      </div>

      <ImportRulesManager />
    </div>
  );
};

export default Importing;
