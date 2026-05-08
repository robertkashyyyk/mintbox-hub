import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon, Bell, Palette, Monitor, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { AutoLsaScheduleCard } from "@/components/settings/AutoLsaScheduleCard";

const Settings = () => {
  const { toast } = useToast();
  const [ftpRunning, setFtpRunning] = useState(false);
  const [ftpResult, setFtpResult] = useState<Record<string, unknown> | null>(null);

  const runFtpPull = async () => {
    setFtpRunning(true);
    setFtpResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("pull-mintsoft-stock-ftp");
      if (error) throw error;
      setFtpResult(data as Record<string, unknown>);
      toast({
        title: "FTP pull complete",
        description: `Updated ${(data as { updated?: number })?.updated ?? 0} SKUs`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ title: "FTP pull failed", description: msg, variant: "destructive" });
      setFtpResult({ error: msg });
    } finally {
      setFtpRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-foreground/60">Manage your application preferences</p>
      </div>

      <div className="grid gap-6">
        <AutoLsaScheduleCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Mintsoft Stock FTP Pull (Test)
            </CardTitle>
            <CardDescription>
              Pulls <code>ColeraineLIVEStockLevelsforHub15.csv</code> from <code>138.68.139.54/pdochub-7</code> and updates stock figures in products_cache.
              Mintsoft drops the file at 15:30 UK daily.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button onClick={runFtpPull} disabled={ftpRunning}>
              {ftpRunning ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Pulling…</> : "Run FTP pull now"}
            </Button>
            {ftpResult && (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-96">
                {JSON.stringify(ftpResult, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Notifications
            </CardTitle>
            <CardDescription>Configure how you receive notifications</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="email-notifications">Email notifications</Label>
              <Switch id="email-notifications" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="low-stock-alerts">Low stock alerts</Label>
              <Switch id="low-stock-alerts" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="order-alerts">Order status alerts</Label>
              <Switch id="order-alerts" defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Appearance
            </CardTitle>
            <CardDescription>Customize the look and feel</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="theme">Theme</Label>
              <Select defaultValue="system">
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="compact-mode">Compact mode</Label>
              <Switch id="compact-mode" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Display
            </CardTitle>
            <CardDescription>Data display preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="rows-per-page">Default rows per page</Label>
              <Select defaultValue="25">
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Rows per page" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-refresh">Auto-refresh data</Label>
              <Switch id="auto-refresh" defaultChecked />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Settings;
