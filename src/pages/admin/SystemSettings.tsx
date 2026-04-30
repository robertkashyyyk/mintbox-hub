import { useNavigate } from "react-router-dom";
import { Settings, Shield, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppSetting, useUpdateAppSetting } from "@/hooks/useAppSettings";
import { useToast } from "@/hooks/use-toast";
import { AccessGate } from "@/components/AccessGate";

const SystemSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const { data: rbacEnabled, isLoading } = useAppSetting<boolean>('use_rbac_navigation');
  const updateSetting = useUpdateAppSetting();

  const handleRbacToggle = async (checked: boolean) => {
    try {
      await updateSetting.mutateAsync({ key: 'use_rbac_navigation', value: checked });
      toast({
        title: checked ? "RBAC Navigation Enabled" : "RBAC Navigation Disabled",
        description: checked ? "Sidebar now uses role-based permissions." : "Sidebar reverted to legacy navigation.",
      });
    } catch (error) {
      toast({ title: "Error", description: "Failed to update setting. Please try again.", variant: "destructive" });
    }
  };

  return (
    <AccessGate area="administration.settings" minCapability="admin">
      <div className="space-y-6">
        <div>
          <Button variant="ghost" size="sm" className="text-pd-accent hover:text-pd-accent-light mb-2" onClick={() => navigate("/admin")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Administration
          </Button>
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-pd-accent" />
            <div>
              <h1 className="text-2xl font-bold text-foreground">System Settings</h1>
              <p className="text-sm text-foreground/60">Application-wide configuration and feature flags</p>
            </div>
          </div>
        </div>

        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-blue-500" />
                <CardTitle>Navigation & Access Control</CardTitle>
              </div>
              <CardDescription>Configure how users navigate and access areas of the application</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label htmlFor="rbac-toggle" className="text-base font-medium">RBAC Navigation</Label>
                  <p className="text-sm text-muted-foreground">When enabled, sidebar uses role-based permissions instead of legacy roles.</p>
                </div>
                <Switch id="rbac-toggle" checked={rbacEnabled ?? false} onCheckedChange={handleRbacToggle} disabled={isLoading || updateSetting.isPending} />
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>Ensure RBAC roles are assigned to users before enabling. Users without roles will have no menu access.</AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </AccessGate>
  );
};

export default SystemSettings;
