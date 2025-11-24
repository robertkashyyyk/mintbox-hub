import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Plus, Trash2, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

export default function ApiAccess() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState("");
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const projectUrl = import.meta.env.VITE_SUPABASE_URL;
  const baseUrl = `${projectUrl}/functions/v1`;

  // Fetch API keys
  const { data: apiKeys, isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Create API key
  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Generate a random API key
      const key = `pk_${crypto.randomUUID().replace(/-/g, '')}`;

      const { error } = await supabase.from("api_keys").insert({
        name,
        key,
        created_by: user.id,
      });
      if (error) throw error;
      return key;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      setNewKeyName("");
      toast({
        title: "API Key Created",
        description: "New API key has been generated successfully",
      });
    },
  });

  // Delete API key
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("api_keys").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast({
        title: "API Key Deleted",
        description: "API key has been removed",
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  const toggleKeyVisibility = (id: string) => {
    setShowKeys((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-6xl">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/menu/management")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Management
        </Button>
        <div>
          <h1 className="text-3xl font-bold">API Access</h1>
          <p className="text-muted-foreground">
            Manage API keys and integration endpoints
          </p>
        </div>
      </div>

      {/* API Endpoints Documentation */}
      <Card>
        <CardHeader>
          <CardTitle>API Endpoints</CardTitle>
          <CardDescription>
            Use these endpoints to integrate with external systems like n8n
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Base URL</h3>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-muted rounded text-sm">{baseUrl}</code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(baseUrl)}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="border-t pt-4">
              <h2 className="text-lg font-semibold mb-4">Price Hunter Endpoints</h2>
              
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">1. Fetch Queued Price Checks</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      GET /fetch-queued-price-checks
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "count": 1,
  "products": [
    {
      "id": "uuid",
      "sku": "NGK-BKR6E",
      "ph_search_term": "BKR6E",
      "ph_brand": "NGK"
    }
  ]
}`}</pre>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">2. Update Price Check Results</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      POST /update-price-check-results
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <code className="text-xs block">Content-Type: application/json</code>
                      <p className="text-sm font-medium mt-2">Example Request Body:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "id": "uuid",
  "ph_status": "done",
  "ph_last_checked_at": "2025-11-16T10:15:00.000Z",
  "ph_plain_best_price": 5.49,
  "ph_plain_best_seller": "car_parts_ltd",
  "ph_plain_best_item_id": "v1|123456789|0",
  "ph_brand_best_price": 5.99,
  "ph_brand_best_seller": "motorhub",
  "ph_brand_best_item_id": "v1|987654321|0",
  "ph_error_message": null
}`}</pre>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "product": { ... }
}`}</pre>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">3. Queue Selected SKUs</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      POST /price-hunter-queue-selected
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <code className="text-xs block">Content-Type: application/json</code>
                      <p className="text-sm font-medium mt-2">Example Request Body:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "product_ids": ["uuid-1", "uuid-2"],
  "source": "manual_queue"
}`}</pre>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "queued_count": 2
}`}</pre>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">4. Get Brand Automations</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      GET /price-hunter-automations
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "automations": [
    {
      "id": "uuid",
      "brand_id": "uuid",
      "brand_name": "Sealey",
      "enabled": true,
      "interval_days": 14,
      "include_only_in_stock": true,
      "include_fire_sale_only": false,
      "last_run_at": "2025-11-16T10:00:00.000Z",
      "next_run_at": "2025-11-30T10:00:00.000Z",
      "last_run_sku_count": 127
    }
  ]
}`}</pre>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">5. Create/Update Brand Automation</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      POST /price-hunter-automations
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <code className="text-xs block">Content-Type: application/json</code>
                      <p className="text-sm font-medium mt-2">Example Request Body:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "brand_id": "uuid",
  "brand_name": "Sealey",
  "interval_days": 14,
  "enabled": true,
  "include_only_in_stock": true,
  "include_fire_sale_only": false
}`}</pre>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "automation": { ... }
}`}</pre>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">6. Run Brand Automation</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      POST /price-hunter-queue-brand-run
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <code className="text-xs block">Content-Type: application/json</code>
                      <p className="text-sm font-medium mt-2">Example Request Body:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "automation_id": "uuid"
}`}</pre>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "automation_id": "uuid",
  "queued_count": 127,
  "xasks_for_this_run": 127
}`}</pre>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">7. Log Xask Usage</h3>
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      POST /log-price-hunter-xask
                    </p>
                    <div className="p-3 bg-muted rounded space-y-2">
                      <p className="text-sm font-medium">Request Headers:</p>
                      <code className="text-xs block">x-api-key: YOUR_API_KEY</code>
                      <code className="text-xs block">Content-Type: application/json</code>
                      <p className="text-sm font-medium mt-2">Example Request Body:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "product_id": "uuid",
  "sku": "NGK-BKR6E",
  "brand_id": "uuid",
  "source": "n8n_worker",
  "flowline_name": "price_hunter_main",
  "xasks_used": 1
}`}</pre>
                      <p className="text-sm font-medium mt-2">Note:</p>
                      <p className="text-xs text-muted-foreground">brand_id is optional. source and flowline_name are required.</p>
                      <p className="text-sm font-medium mt-2">Example Response:</p>
                      <pre className="text-xs overflow-x-auto">{`{
  "success": true,
  "message": "Xask usage logged successfully"
}`}</pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* API Keys Management */}
      <Card>
        <CardHeader>
          <CardTitle>API Keys</CardTitle>
          <CardDescription>
            Create and manage API keys for authentication
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create new key */}
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="key-name">Key Name</Label>
              <Input
                id="key-name"
                placeholder="e.g. n8n integration"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => createMutation.mutate(newKeyName)}
                disabled={!newKeyName || createMutation.isPending}
              >
                <Plus className="h-4 w-4 mr-2" />
                Create Key
              </Button>
            </div>
          </div>

          {/* List of keys */}
          <div className="space-y-2">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading keys...</p>
            ) : apiKeys?.length === 0 ? (
              <p className="text-sm text-muted-foreground">No API keys created yet</p>
            ) : (
              apiKeys?.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center gap-4 p-3 border rounded"
                >
                  <div className="flex-1 space-y-1">
                    <p className="font-medium">{key.name}</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {showKeys[key.id] ? key.key : '••••••••••••••••'}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleKeyVisibility(key.id)}
                      >
                        {showKeys[key.id] ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(key.key)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Created: {format(new Date(key.created_at), "MMM d, yyyy")}</span>
                      {key.last_used_at && (
                        <span>Last used: {format(new Date(key.last_used_at), "MMM d, yyyy")}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deleteMutation.mutate(key.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
