import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2 } from "lucide-react";

interface ImportRule {
  id: string;
  pattern: string;
  rule_type: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export function ImportRulesManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newRule, setNewRule] = useState({
    pattern: "",
    description: "",
    enabled: true,
  });

  const { data: rules, isLoading } = useQuery({
    queryKey: ["import-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_rules" as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as ImportRule[];
    },
  });

  const createRuleMutation = useMutation({
    mutationFn: async (rule: typeof newRule) => {
      const { error } = await supabase.from("import_rules" as any).insert({
        pattern: rule.pattern,
        rule_type: "exclude_pattern",
        description: rule.description,
        enabled: rule.enabled,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-rules"] });
      toast({
        title: "Rule created",
        description: "The import rule has been created successfully.",
      });
      setNewRule({ pattern: "", description: "", enabled: true });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create import rule.",
        variant: "destructive",
      });
    },
  });

  const toggleRuleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("import_rules" as any)
        .update({ enabled })
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-rules"] });
      toast({
        title: "Rule updated",
        description: "The import rule has been updated successfully.",
      });
    },
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("import_rules" as any).delete().eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["import-rules"] });
      toast({
        title: "Rule deleted",
        description: "The import rule has been deleted successfully.",
      });
    },
  });

  const handleCreateRule = () => {
    if (!newRule.pattern || !newRule.description) {
      toast({
        title: "Validation error",
        description: "Please fill in all fields.",
        variant: "destructive",
      });
      return;
    }
    createRuleMutation.mutate(newRule);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add New Import Rule</CardTitle>
          <CardDescription>
            Define patterns to exclude specific SKUs during import. Use standard patterns like -QXX for quantity packs or -BXX for bundle kits.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pattern">Pattern</Label>
            <Input
              id="pattern"
              placeholder="e.g., -Q, -B, -KIT"
              value={newRule.pattern}
              onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe what this rule does..."
              value={newRule.description}
              onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
              rows={3}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Switch
              id="enabled"
              checked={newRule.enabled}
              onCheckedChange={(checked) => setNewRule({ ...newRule, enabled: checked })}
            />
            <Label htmlFor="enabled">Enable this rule</Label>
          </div>
          <Button onClick={handleCreateRule} disabled={createRuleMutation.isPending}>
            <Plus className="mr-2 h-4 w-4" />
            Add Rule
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Import Rules</CardTitle>
          <CardDescription>
            Manage your SKU exclusion patterns. Disabled rules will not be applied during import.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading rules...</p>
          ) : !rules || rules.length === 0 ? (
            <p className="text-muted-foreground">No import rules defined yet.</p>
          ) : (
            <div className="space-y-4">
              {rules.map((rule) => (
                <Card key={rule.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <code className="px-2 py-1 bg-muted rounded text-sm font-mono">
                            {rule.pattern}
                          </code>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={(checked) =>
                              toggleRuleMutation.mutate({ id: rule.id, enabled: checked })
                            }
                          />
                        </div>
                        <p className="text-sm text-muted-foreground">{rule.description}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteRuleMutation.mutate(rule.id)}
                        disabled={deleteRuleMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
