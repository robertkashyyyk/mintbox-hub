import { useNavigate } from "react-router-dom";
import { Settings, Shield, AlertTriangle, ArrowLeft, Package, Clock, Gauge, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAppSetting, useUpdateAppSetting } from "@/hooks/useAppSettings";
import { useToast } from "@/hooks/use-toast";
import { AccessGate } from "@/components/AccessGate";
import { useEffect, useState } from "react";

interface ToleranceBands {
  critical: number;
  low: number;
  high: number;
  excess: number;
}

const SystemSettings = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const { data: rbacEnabled, isLoading } = useAppSetting<boolean>('use_rbac_navigation');
  const { data: lsaMinThreshold, isLoading: lsaMinLoading } = useAppSetting<number>('lsa.min_threshold');
  const { data: poSuppHours, isLoading: poSuppLoading } = useAppSetting<number>('buying.po_suppression_hours');
  const { data: globalMult, isLoading: globalMultLoading } = useAppSetting<number>('lsa.global_base_multiplier');
  const { data: tolerance, isLoading: tolLoading } = useAppSetting<ToleranceBands>('lsa.tolerance');
  const updateSetting = useUpdateAppSetting();

  const [lsaMinInput, setLsaMinInput] = useState<string>("");
  const [poSuppInput, setPoSuppInput] = useState<string>("");
  const [globalMultInput, setGlobalMultInput] = useState<string>("");
  const [tolInput, setTolInput] = useState<{ critical: string; low: string; high: string; excess: string }>({
    critical: "", low: "", high: "", excess: ""
  });

  useEffect(() => {
    if (lsaMinThreshold !== null && lsaMinThreshold !== undefined) setLsaMinInput(String(lsaMinThreshold));
  }, [lsaMinThreshold]);
  useEffect(() => {
    if (poSuppHours !== null && poSuppHours !== undefined) setPoSuppInput(String(poSuppHours));
  }, [poSuppHours]);
  useEffect(() => {
    if (globalMult !== null && globalMult !== undefined) setGlobalMultInput(String(globalMult));
  }, [globalMult]);
  useEffect(() => {
    if (tolerance) setTolInput({
      critical: String(tolerance.critical),
      low: String(tolerance.low),
      high: String(tolerance.high),
      excess: String(tolerance.excess),
    });
  }, [tolerance]);

  const handleLsaMinSave = async () => {
    const n = Number(lsaMinInput);
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      toast({ title: "Invalid value", description: "Enter a non-negative integer.", variant: "destructive" });
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: 'lsa.min_threshold', value: n });
      toast({ title: "LSA min threshold updated", description: `SKUs with LSA ≤ ${n} are now excluded from ingestion, LSA Calibration & Buy Recommendations.` });
    } catch {
      toast({ title: "Error", description: "Failed to save threshold.", variant: "destructive" });
    }
  };

  const handlePoSuppSave = async () => {
    const n = Number(poSuppInput);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      toast({ title: "Invalid value", description: "Enter a positive integer (hours).", variant: "destructive" });
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: 'buying.po_suppression_hours', value: n });
      toast({ title: "PO suppression window updated", description: `Suppliers with a sent PO are hidden for ${n} hours.` });
    } catch {
      toast({ title: "Error", description: "Failed to save setting.", variant: "destructive" });
    }
  };

  const handleGlobalMultSave = async () => {
    const n = Number(globalMultInput);
    if (!Number.isFinite(n) || n <= 0) {
      toast({ title: "Invalid value", description: "Enter a positive number (weeks of cover).", variant: "destructive" });
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: 'lsa.global_base_multiplier', value: n });
      toast({ title: "Global base multiplier updated", description: `Brands without a custom multiplier will use ${n} weeks of cover.` });
    } catch {
      toast({ title: "Error", description: "Failed to save setting.", variant: "destructive" });
    }
  };

  const handleToleranceSave = async () => {
    const c = Number(tolInput.critical), l = Number(tolInput.low), h = Number(tolInput.high), e = Number(tolInput.excess);
    if (![c, l, h, e].every(Number.isFinite) || !(c > 0 && c < l && l < 1 && h > 1 && h < e)) {
      toast({ title: "Invalid bands", description: "Required: 0 < critical < low < 1 < high < excess.", variant: "destructive" });
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: 'lsa.tolerance', value: { critical: c, low: l, high: h, excess: e } as any });
      toast({ title: "Tolerance bands updated", description: `Critical ${c}, Low ${l}, High ${h}, Excess ${e}.` });
    } catch {
      toast({ title: "Error", description: "Failed to save bands.", variant: "destructive" });
    }
  };

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

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-pd-accent" />
                <CardTitle>LSA Minimum Threshold</CardTitle>
              </div>
              <CardDescription>
                The single source of truth for what counts as a "meaningful" LSA. Mintsoft uses LSA = 1 as the "not set" sentinel, so SKUs at or below this value are skipped during the daily SFTP ingest <strong>and</strong> excluded from LSA Calibration / Buy Recommendations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="lsa-min-threshold" className="text-base font-medium">
                  LSA min threshold
                </Label>
                <p className="text-sm text-muted-foreground">
                  Default is <strong>1</strong>. Only SKUs with LSA <strong>&gt; this value</strong> are considered to have a real LSA configured.
                </p>
                <div className="flex gap-2">
                  <Input
                    id="lsa-min-threshold"
                    type="number"
                    min={0}
                    step={1}
                    value={lsaMinInput}
                    onChange={(e) => setLsaMinInput(e.target.value)}
                    disabled={lsaMinLoading || updateSetting.isPending}
                  />
                  <Button onClick={handleLsaMinSave} disabled={lsaMinLoading || updateSetting.isPending}>
                    Save
                  </Button>
                </div>
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Applied consistently across SFTP ingest, LSA Calibration, and Buy Recommendations. Back-orders are still considered for buying regardless of LSA.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-pd-accent" />
                <CardTitle>PO Suppression Window</CardTitle>
              </div>
              <CardDescription>
                After a Draft PO is marked as <strong>Sent</strong> to Mintsoft, hide that supplier from the Buy Recommendations summary for this many hours, to avoid double-ordering while waiting for ASN conversion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="po-supp-hours" className="text-base font-medium">
                  Suppression window (hours)
                </Label>
                <p className="text-sm text-muted-foreground">
                  Default is <strong>22</strong>. If no ASN is detected within this window, the supplier reappears with a "PO Pending — No ASN Yet" warning.
                </p>
                <div className="flex gap-2">
                  <Input
                    id="po-supp-hours"
                    type="number"
                    min={1}
                    step={1}
                    value={poSuppInput}
                    onChange={(e) => setPoSuppInput(e.target.value)}
                    disabled={poSuppLoading || updateSetting.isPending}
                  />
                  <Button onClick={handlePoSuppSave} disabled={poSuppLoading || updateSetting.isPending}>
                    Save
                  </Button>
                </div>
              </div>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Once Mintsoft converts the PO to an ASN, suppression lifts immediately regardless of this window — ordering math then naturally accounts for OnOrder.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-pd-accent" />
                <CardTitle>LSA Global Base Multiplier</CardTitle>
              </div>
              <CardDescription>
                Default weeks-of-cover used when computing Target LSA for any brand that has no <strong>base_multiplier</strong> set on its brand record. Target LSA = weekly velocity × multiplier.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="global-mult" className="text-base font-medium">Weeks of cover</Label>
                <p className="text-sm text-muted-foreground">Default is <strong>4</strong>. Per-brand values on the Brands page override this.</p>
                <div className="flex gap-2">
                  <Input
                    id="global-mult"
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={globalMultInput}
                    onChange={(e) => setGlobalMultInput(e.target.value)}
                    disabled={globalMultLoading || updateSetting.isPending}
                  />
                  <Button onClick={handleGlobalMultSave} disabled={globalMultLoading || updateSetting.isPending}>
                    Save
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5 text-pd-accent" />
                <CardTitle>LSA Tolerance Bands</CardTitle>
              </div>
              <CardDescription>
                Ratios of <em>current LSA</em> vs <em>target LSA</em> used to classify each SKU on LSA Calibration. Must satisfy: <code>0 &lt; critical &lt; low &lt; 1 &lt; high &lt; excess</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="tol-critical">Critical (&lt;)</Label>
                  <Input id="tol-critical" type="number" step={0.05} min={0} value={tolInput.critical}
                    onChange={(e) => setTolInput({ ...tolInput, critical: e.target.value })}
                    disabled={tolLoading || updateSetting.isPending} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tol-low">Low (&lt;)</Label>
                  <Input id="tol-low" type="number" step={0.05} min={0} value={tolInput.low}
                    onChange={(e) => setTolInput({ ...tolInput, low: e.target.value })}
                    disabled={tolLoading || updateSetting.isPending} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tol-high">High (≤)</Label>
                  <Input id="tol-high" type="number" step={0.05} min={1} value={tolInput.high}
                    onChange={(e) => setTolInput({ ...tolInput, high: e.target.value })}
                    disabled={tolLoading || updateSetting.isPending} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tol-excess">Excess (≤)</Label>
                  <Input id="tol-excess" type="number" step={0.05} min={1} value={tolInput.excess}
                    onChange={(e) => setTolInput({ ...tolInput, excess: e.target.value })}
                    disabled={tolLoading || updateSetting.isPending} />
                </div>
              </div>
              <Button onClick={handleToleranceSave} disabled={tolLoading || updateSetting.isPending}>
                Save bands
              </Button>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Defaults: Critical 0.5, Low 0.85, High 1.15, Excess 1.5. Anything between Low and High counts as on-target.
                </AlertDescription>
              </Alert>
            </CardContent>
          </Card>
        </div>
      </div>
    </AccessGate>
  );
};

export default SystemSettings;
