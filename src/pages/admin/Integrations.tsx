import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plug, CheckCircle2, XCircle, AlertCircle, Loader2, RefreshCw, ExternalLink, Settings2, Link2
} from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import { format } from "date-fns";
import type { Json } from "@/integrations/supabase/types";

interface Integration {
  id: string; name: string; display_name: string; enabled: boolean; base_url: string | null;
  config: Json; last_connected_at: string | null; connection_status: string; error_message: string | null;
  created_at: string; updated_at: string;
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case "connected": return <Badge variant="default" className="bg-green-500 hover:bg-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Connected</Badge>;
    case "error": return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Error</Badge>;
    case "testing": return <Badge variant="secondary"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Testing...</Badge>;
    default: return <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />Not Configured</Badge>;
  }
};

const getSecretKeyName = (integrationName: string): string => {
  switch (integrationName) {
    case "mintsoft": return "MINTSOFT_API_KEY";
    case "3dsellers": return "THREEDS_API_KEY";
    default: return `${integrationName.toUpperCase()}_API_KEY`;
  }
};

const IntegrationCard = ({ integration, onUpdate, onTestConnection, isUpdating, isTesting }: { 
  integration: Integration; onUpdate: (id: string, updates: Partial<Integration>) => void;
  onTestConnection: (name: string) => void; isUpdating: boolean; isTesting: boolean;
}) => {
  const [baseUrl, setBaseUrl] = useState(integration.base_url || "");
  const [hasChanges, setHasChanges] = useState(false);
  const [enabled, setEnabled] = useState(integration.enabled);

  const handleBaseUrlChange = (value: string) => { setBaseUrl(value); setHasChanges(value !== (integration.base_url || "")); };
  const handleEnabledChange = (value: boolean) => { setEnabled(value); onUpdate(integration.id, { enabled: value }); };
  const handleSaveBaseUrl = () => { onUpdate(integration.id, { base_url: baseUrl || null }); setHasChanges(false); };

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg"><Plug className="h-5 w-5 text-primary" /></div>
            <div>
              <CardTitle className="text-lg">{integration.display_name}</CardTitle>
              <CardDescription className="text-xs">Secret: <code className="bg-muted px-1 rounded">{getSecretKeyName(integration.name)}</code></CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {getStatusBadge(isTesting ? "testing" : integration.connection_status)}
            <div className="flex items-center gap-2">
              <Label htmlFor={`enabled-${integration.id}`} className="text-sm text-muted-foreground">Enabled</Label>
              <Switch id={`enabled-${integration.id}`} checked={enabled} onCheckedChange={handleEnabledChange} disabled={isUpdating} />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`url-${integration.id}`}>Base URL</Label>
          <div className="flex gap-2">
            <Input id={`url-${integration.id}`} placeholder="https://api.example.com" value={baseUrl} onChange={(e) => handleBaseUrlChange(e.target.value)} className="flex-1" />
            {hasChanges && <Button size="sm" onClick={handleSaveBaseUrl} disabled={isUpdating}>{isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>}
          </div>
        </div>
        {integration.error_message && integration.connection_status === "error" && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md"><p className="text-sm text-destructive">{integration.error_message}</p></div>
        )}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="text-xs text-muted-foreground">
            {integration.last_connected_at ? <span>Last connected: {format(new Date(integration.last_connected_at), "PPp")}</span> : <span>Never connected</span>}
          </div>
          <Button variant="outline" size="sm" onClick={() => onTestConnection(integration.name)} disabled={isTesting || !baseUrl}>
            {isTesting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}Test Connection
          </Button>
        </div>
        {integration.name === "mintsoft" && integration.config && typeof integration.config === 'object' && !Array.isArray(integration.config) && (
          <div className="pt-2 border-t">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Settings2 className="h-3 w-3" />
              <span>Dispatched Status IDs: {'dispatched_status_ids' in integration.config && Array.isArray(integration.config.dispatched_status_ids) ? (integration.config.dispatched_status_ids as (string | number)[]).join(", ") : "Not set"}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const Integrations = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testingIntegration, setTestingIntegration] = useState<string | null>(null);

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: async () => {
      const { data, error } = await supabase.from("integrations").select("*").order("display_name");
      if (error) throw error;
      return data as Integration[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Integration> }) => {
      const { error } = await supabase.from("integrations").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["integrations"] }); toast({ title: "Integration updated", description: "Changes saved successfully." }); },
    onError: (error) => { toast({ title: "Update failed", description: error.message, variant: "destructive" }); },
  });

  const testConnectionMutation = useMutation({
    mutationFn: async (integrationName: string) => {
      setTestingIntegration(integrationName);
      const { data, error } = await supabase.functions.invoke("test-integration-connection", { body: { integration: integrationName } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => { queryClient.invalidateQueries({ queryKey: ["integrations"] }); toast({ title: data.success ? "Connection successful" : "Connection failed", description: data.message, variant: data.success ? "default" : "destructive" }); },
    onError: (error) => { toast({ title: "Connection test failed", description: error.message, variant: "destructive" }); },
    onSettled: () => { setTestingIntegration(null); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light mb-2" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Administration
          </Button>
          <ModuleHeader
            title="Integrations"
            description="Manage connections to external services."
            icon={Link2}
          />
        </div>
        <div className="flex-shrink-0 pt-1">
          <Button variant="outlineDark" size="sm" asChild>
            <a href="https://docs.lovable.dev/features/security" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" />Managing Secrets
            </a>
          </Button>
        </div>
      </div>

      <div className="p-4 bg-muted/50 rounded-lg border">
        <h3 className="font-medium mb-1">How Integrations Work</h3>
        <p className="text-sm text-muted-foreground">
          API keys are stored securely as backend secrets and cannot be viewed here. 
          Configure the base URL and enable/disable each integration. Use "Test Connection" to verify your credentials are working.
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-6">
          {[1, 2].map((i) => (
            <Card key={i}><CardHeader><Skeleton className="h-6 w-32" /><Skeleton className="h-4 w-48" /></CardHeader><CardContent><Skeleton className="h-10 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-6">
          {integrations?.map((integration) => (
            <IntegrationCard key={integration.id} integration={integration} onUpdate={(id, updates) => updateMutation.mutate({ id, updates })} onTestConnection={(name) => testConnectionMutation.mutate(name)} isUpdating={updateMutation.isPending} isTesting={testingIntegration === integration.name} />
          ))}
        </div>
      )}
    </div>
  );
};

export default Integrations;
