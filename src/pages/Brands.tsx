import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { Pencil, Trash2, Plus, Loader2, Zap, Tag, Send, CalendarClock } from "lucide-react";
import ModuleHeader from "@/components/ModuleHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageLoader } from "@/components/ui/PageLoader";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { logActivity, LOG_ACTIONS } from "@/lib/activityLog";

// ---- Order-reminder schedule helpers -------------------------------------
// day_of_week uses JS/Postgres getDay()/extract(dow): 0=Sun .. 6=Sat.
const DOW = [
  { v: 1, label: "Monday" }, { v: 2, label: "Tuesday" }, { v: 3, label: "Wednesday" },
  { v: 4, label: "Thursday" }, { v: 5, label: "Friday" }, { v: 6, label: "Saturday" }, { v: 0, label: "Sunday" },
];
const CADENCE_EVERY: Record<string, string> = { weekly: "week", fortnightly: "2 weeks", monthly: "month", quarterly: "quarter" };
type Cadence = "weekly" | "fortnightly" | "monthly" | "quarterly";

const clampDom = (y: number, m: number, dom: number) => {
  const last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(Math.max(dom, 1), last));
};
const nextDow = (from: Date, dow: number) => {
  const d = new Date(from);
  let add = ((dow - d.getDay()) % 7 + 7) % 7;
  if (add === 0) add = 7;
  d.setDate(d.getDate() + add);
  return d;
};
const nextDom = (from: Date, dom: number) => {
  const y = from.getFullYear(), m = from.getMonth();
  const t = clampDom(y, m, dom);
  return t > from ? t : clampDom(y, m + 1, dom);
};
// First upcoming due date for a schedule — mirrors public.seed_order_due().
const computeNextDue = (cadence: Cadence, dow: number, dom: number) => {
  const from = new Date(); from.setHours(0, 0, 0, 0);
  return cadence === "weekly" || cadence === "fortnightly" ? nextDow(from, dow) : nextDom(from, dom);
};
const toISODate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtDue = (iso: string | null) => {
  if (!iso) return "—";
  try { return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }); }
  catch { return iso; }
};

const Brands = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingBrand, setEditingBrand] = useState<any>(null);
  const [deletingBrand, setDeletingBrand] = useState<any>(null);
  const [isAddingBrand, setIsAddingBrand] = useState(false);
  const [editFormData, setEditFormData] = useState({
    name: "",
    prefix: "",
    prefix_style: "hyphen" as "hyphen" | "slash",
    family: "",
    remote_stock_feed_type: "" as any,
    base_multiplier: "",
    auto_update_lsa: false,
    stock_sync_interval_hours: "24",
    is_own_brand: false,
  });
  const [runningLsaBrandId, setRunningLsaBrandId] = useState<string | null>(null);
  const [addFormData, setAddFormData] = useState({
    name: "",
    prefix: "",
    prefix_style: "hyphen" as "hyphen" | "slash",
    family: "",
    remote_stock_feed_type: "" as any,
    base_multiplier: "",
    stock_sync_interval_hours: "24",
    is_own_brand: false,
  });

  const [scheduleForm, setScheduleForm] = useState({
    enabled: false,
    cadence: "weekly" as Cadence,
    day_of_week: 1,
    day_of_month: 1,
  });
  const [sendingTestBrandId, setSendingTestBrandId] = useState<string | null>(null);

  const { data: brands, isLoading } = useQuery({
    queryKey: ["brands-with-count"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_brands_with_product_counts");
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: schedules } = useQuery({
    queryKey: ["brand-order-schedules"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("brand_order_schedule")
        .select("brand_id, cadence, day_of_week, day_of_month, next_due_date, enabled, last_sent_at");
      if (error) throw error;
      return data as any[];
    },
  });
  const scheduleMap = useMemo(() => {
    const m = new Map<string, any>();
    (schedules ?? []).forEach((s) => m.set(s.brand_id, s));
    return m;
  }, [schedules]);

  const createBrandMutation = useMutation({
    mutationFn: async (data: any) => {
      const { error } = await supabase.from("brands").insert(data);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
      logActivity({ action: LOG_ACTIONS.BRAND_CREATE, entityType: "brand", entityLabel: variables.name });
      toast({
        title: "Success",
        description: "Brand created successfully",
      });
      setIsAddingBrand(false);
      setAddFormData({
        name: "",
        prefix: "",
        prefix_style: "hyphen",
        family: "",
        remote_stock_feed_type: "",
        base_multiplier: "",
        stock_sync_interval_hours: "24",
        is_own_brand: false,
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to create brand: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const updateBrandMutation = useMutation({
    mutationFn: async (data: { id: string; updates: any; prevAutoLsa?: boolean }) => {
      const { error } = await supabase
        .from("brands")
        .update(data.updates)
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
      // Log auto_lsa toggle separately so it's easy to find in the audit trail
      if (variables.prevAutoLsa !== undefined && variables.prevAutoLsa !== variables.updates.auto_update_lsa) {
        logActivity({
          action: LOG_ACTIONS.LSA_TOGGLE_AUTO,
          entityType: "brand",
          entityId: variables.id,
          entityLabel: variables.updates.name,
          detail: { field: "auto_update_lsa", old: variables.prevAutoLsa, new: variables.updates.auto_update_lsa },
        });
      } else {
        logActivity({
          action: LOG_ACTIONS.BRAND_UPDATE,
          entityType: "brand",
          entityId: variables.id,
          entityLabel: variables.updates.name,
        });
      }
      toast({
        title: "Success",
        description: "Brand updated successfully",
      });
      setEditingBrand(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to update brand: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const deleteBrandMutation = useMutation({
    mutationFn: async (data: { id: string; name: string }) => {
      const { error } = await supabase.from("brands").delete().eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
      await queryClient.refetchQueries({ queryKey: ["brands-with-count"] });
      logActivity({ action: LOG_ACTIONS.BRAND_DELETE, entityType: "brand", entityId: variables.id, entityLabel: variables.name });
      toast({
        title: "Success",
        description: "Brand deleted successfully",
      });
      setDeletingBrand(null);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `Failed to delete brand: ${error.message}`,
        variant: "destructive",
      });
    },
  });

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload: { brand_id: string }) => {
      const existing = scheduleMap.get(payload.brand_id);
      // Nothing to persist if there was never a schedule and the user left it off.
      if (!scheduleForm.enabled && !existing) return;
      const isWeekly = scheduleForm.cadence === "weekly" || scheduleForm.cadence === "fortnightly";
      const next_due_date = toISODate(
        computeNextDue(scheduleForm.cadence, scheduleForm.day_of_week, scheduleForm.day_of_month),
      );
      const row = {
        brand_id: payload.brand_id,
        cadence: scheduleForm.cadence,
        day_of_week: isWeekly ? scheduleForm.day_of_week : null,
        day_of_month: isWeekly ? null : scheduleForm.day_of_month,
        next_due_date,
        enabled: scheduleForm.enabled,
        updated_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("brand_order_schedule")
        .upsert(row, { onConflict: "brand_id" });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["brand-order-schedules"] }),
    onError: (error: any) =>
      toast({ title: "Schedule not saved", description: error.message, variant: "destructive" }),
  });

  const sendScheduleTest = async (brandId: string) => {
    setSendingTestBrandId(brandId);
    const { data, error } = await supabase.functions.invoke("brand-order-due-email", {
      body: { test: true, brand_id: brandId },
    });
    setSendingTestBrandId(null);
    if (error) {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
      return;
    }
    const r = (data as any)?.results?.[0];
    toast(
      r
        ? { title: `Test sent — ${r.rows} SKU${r.rows === 1 ? "" : "s"}`, description: `${r.brand}: ${r.total_units} units. Sent to you only.` }
        : { title: "Save the schedule first", description: "There's no saved schedule for this brand yet — hit Save Changes, then send a test." },
    );
  };

  const handleEdit = (brand: any) => {
    setEditingBrand(brand);
    const sched = scheduleMap.get(brand.id);
    setScheduleForm(
      sched
        ? {
            enabled: !!sched.enabled,
            cadence: (sched.cadence ?? "weekly") as Cadence,
            day_of_week: sched.day_of_week ?? 1,
            day_of_month: sched.day_of_month ?? 1,
          }
        : { enabled: false, cadence: "weekly", day_of_week: 1, day_of_month: 1 },
    );
    setEditFormData({
      name: brand.name || "",
      prefix: brand.prefix || "",
      prefix_style: brand.prefix_style || "hyphen",
      family: brand.family || "",
      remote_stock_feed_type: brand.remote_stock_feed_type || "",
      base_multiplier: brand.base_multiplier?.toString() || "",
      auto_update_lsa: !!brand.auto_update_lsa,
      stock_sync_interval_hours: (brand.stock_sync_interval_hours ?? 24).toString(),
      is_own_brand: !!brand.is_own_brand,
    });
  };

  const handleSaveEdit = () => {
    if (!editingBrand) return;
    
    // Validate base_multiplier if provided
    if (editFormData.base_multiplier && Number(editFormData.base_multiplier) <= 0) {
      toast({
        title: "Validation Error",
        description: "Base multiplier must be greater than 0",
        variant: "destructive",
      });
      return;
    }
    
    const interval = Math.max(1, Math.min(168, Number(editFormData.stock_sync_interval_hours) || 24));
    const updates = {
      name: editFormData.name,
      prefix: editFormData.prefix,
      prefix_style: editFormData.prefix_style,
      family: editFormData.family || null,
      remote_stock_feed_type: editFormData.remote_stock_feed_type || null,
      base_multiplier: editFormData.base_multiplier ? Number(editFormData.base_multiplier) : null,
      auto_update_lsa: editFormData.auto_update_lsa,
      stock_sync_interval_hours: interval,
      is_own_brand: editFormData.is_own_brand,
    };
    
    const brandId = editingBrand.id;
    updateBrandMutation.mutate({
      id: brandId,
      updates,
      prevAutoLsa: !!editingBrand.auto_update_lsa,
    });
    saveScheduleMutation.mutate({ brand_id: brandId });
  };

  const handleDelete = () => {
    if (!deletingBrand) return;
    deleteBrandMutation.mutate({ id: deletingBrand.id, name: deletingBrand.name });
  };

  const handleAddBrand = () => {
    if (!addFormData.name.trim() || !addFormData.prefix.trim()) {
      toast({
        title: "Validation Error",
        description: "Brand name and prefix are required",
        variant: "destructive",
      });
      return;
    }

    if (addFormData.base_multiplier && Number(addFormData.base_multiplier) <= 0) {
      toast({
        title: "Validation Error",
        description: "Base multiplier must be greater than 0",
        variant: "destructive",
      });
      return;
    }

    createBrandMutation.mutate({
      name: addFormData.name.trim(),
      prefix: addFormData.prefix.trim().toUpperCase(),
      prefix_style: addFormData.prefix_style,
      family: addFormData.family || null,
      remote_stock_feed_type: addFormData.remote_stock_feed_type || null,
      base_multiplier: addFormData.base_multiplier ? Number(addFormData.base_multiplier) : null,
      stock_sync_interval_hours: Math.max(1, Math.min(168, Number(addFormData.stock_sync_interval_hours) || 24)),
      is_own_brand: addFormData.is_own_brand,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <ModuleHeader
          title="Brands"
          description="Manage brands and view product counts"
          icon={Tag}
        />
        <div className="flex-shrink-0 pt-1">
          <Button onClick={() => setIsAddingBrand(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Brand
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Brands ({brands?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <PageLoader
              rows={10}
              columns={[180, 80, 100, 120, 80, 120, 80, 80, 140, 80, 100, 80]}
              label="Loading brands"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Prefix Style</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead>Own Brand</TableHead>
                  <TableHead>Base Multiplier</TableHead>
                  <TableHead>Auto LSA</TableHead>
                  <TableHead>Stock Sync</TableHead>
                  <TableHead>Order Reminder</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead className="text-right">Product Count</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {brands?.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">{brand.name}</TableCell>
                    <TableCell>{brand.prefix}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-xs">
                        {brand.prefix_style === "slash" ? "/" : "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {brand.family ? (
                        <span className="text-muted-foreground">{brand.family}</span>
                      ) : (
                        <span className="text-muted-foreground italic">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {brand.is_own_brand ? (
                        <Badge className="bg-pd-accent/15 text-pd-accent border-pd-accent/40" variant="outline">Own</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {brand.base_multiplier !== null ? (
                        <span className="font-medium">{brand.base_multiplier}</span>
                      ) : (
                        <span className="text-destructive font-bold bg-destructive/10 px-2 py-1 rounded">Missing</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {brand.auto_update_lsa ? (
                        <Badge className="bg-pd-accent/15 text-pd-accent border-pd-accent/40" variant="outline">On</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">Off</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        every {brand.stock_sync_interval_hours ?? 24}h
                      </span>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const s = scheduleMap.get(brand.id);
                        if (!s || !s.enabled) return <span className="text-muted-foreground text-xs">—</span>;
                        return (
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="capitalize">{s.cadence}</Badge>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              next {fmtDue(s.next_due_date)}
                            </span>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <div className="flex items-center gap-1.5">
                          {brand.auto_update_lsa && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-pd-accent/15 text-pd-accent border border-pd-accent/40">
                                  <Zap className="h-3.5 w-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>Assigned to Auto LSA</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {!brand.auto_update_lsa && (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </div>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {brand.product_count}
                    </TableCell>
                    <TableCell className="text-right">
                      <TooltipProvider>
                        <div className="flex justify-end gap-2">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => handleEdit(brand)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Edit brand</p>
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setDeletingBrand(brand)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Delete brand</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Brand Dialog */}
      <Dialog open={isAddingBrand} onOpenChange={setIsAddingBrand}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add New Brand</DialogTitle>
            <DialogDescription>
              Enter the details for the new brand.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div className="space-y-2">
              <Label htmlFor="add-name">Brand Name *</Label>
              <Input
                id="add-name"
                value={addFormData.name}
                onChange={(e) =>
                  setAddFormData({ ...addFormData, name: e.target.value })
                }
                placeholder="e.g. Acme Parts"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-prefix">Prefix *</Label>
              <Input
                id="add-prefix"
                value={addFormData.prefix}
                onChange={(e) =>
                  setAddFormData({ ...addFormData, prefix: e.target.value.toUpperCase() })
                }
                placeholder="e.g. ACME"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-prefix_style">Prefix Style</Label>
              <Select
                value={addFormData.prefix_style}
                onValueChange={(value: "hyphen" | "slash") =>
                  setAddFormData({ ...addFormData, prefix_style: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hyphen">- (Hyphen)</SelectItem>
                  <SelectItem value="slash">/ (Slash)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-family">Family (Optional)</Label>
              <Input
                id="add-family"
                value={addFormData.family}
                onChange={(e) =>
                  setAddFormData({ ...addFormData, family: e.target.value })
                }
                placeholder="e.g. Automotive"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-remote_stock_feed_type">Remote Stock Feed Type</Label>
              <Select
                value={addFormData.remote_stock_feed_type}
                onValueChange={(value) =>
                  setAddFormData({ ...addFormData, remote_stock_feed_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select feed type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="google_sheet">Google Sheet</SelectItem>
                  <SelectItem value="direct_upload">Direct Upload</SelectItem>
                  <SelectItem value="ftp_push">FTP Push</SelectItem>
                  <SelectItem value="ftp_pull">FTP Pull</SelectItem>
                  <SelectItem value="no_feed">No Feed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-base_multiplier">Base Stock Multiplier</Label>
              <Input
                id="add-base_multiplier"
                type="number"
                step="0.01"
                min="0"
                placeholder="Leave empty if not set"
                value={addFormData.base_multiplier}
                onChange={(e) =>
                  setAddFormData({ ...addFormData, base_multiplier: e.target.value })
                }
              />
            </div>
            </div>
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label className="text-sm font-medium">PartsDoc Own Brand</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Marks this brand as ours. Used across the Hub — e.g. Amazon buy-box tiering holds own-brand listings to a stricter standard.
                </p>
              </div>
              <Switch
                checked={addFormData.is_own_brand}
                onCheckedChange={(v) => setAddFormData({ ...addFormData, is_own_brand: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddingBrand(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAddBrand} 
              disabled={!addFormData.name.trim() || !addFormData.prefix.trim() || createBrandMutation.isPending}
            >
              {createBrandMutation.isPending ? "Creating..." : "Create Brand"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Brand Dialog */}
      <Dialog open={!!editingBrand} onOpenChange={() => setEditingBrand(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>
              Update the brand information below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div className="space-y-2">
              <Label htmlFor="name">Brand Name</Label>
              <Input
                id="name"
                value={editFormData.name}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prefix">Prefix</Label>
              <Input
                id="prefix"
                value={editFormData.prefix}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, prefix: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prefix_style">Prefix Style</Label>
              <Select
                value={editFormData.prefix_style}
                onValueChange={(value: "hyphen" | "slash") =>
                  setEditFormData({ ...editFormData, prefix_style: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hyphen">- (Hyphen)</SelectItem>
                  <SelectItem value="slash">/ (Slash)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="family">Family (Optional)</Label>
              <Input
                id="family"
                value={editFormData.family}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, family: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="remote_stock_feed_type">Remote Stock Feed Type</Label>
              <Select
                value={editFormData.remote_stock_feed_type}
                onValueChange={(value) =>
                  setEditFormData({ ...editFormData, remote_stock_feed_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select feed type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="google_sheet">Google Sheet</SelectItem>
                  <SelectItem value="direct_upload">Direct Upload</SelectItem>
                  <SelectItem value="ftp_push">FTP Push</SelectItem>
                  <SelectItem value="ftp_pull">FTP Pull</SelectItem>
                  <SelectItem value="no_feed">No Feed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="base_multiplier">Base Stock Multiplier</Label>
              <Input
                id="base_multiplier"
                type="number"
                step="0.01"
                min="0"
                placeholder="Leave empty if not set"
                value={editFormData.base_multiplier}
                onChange={(e) =>
                  setEditFormData({ ...editFormData, base_multiplier: e.target.value })
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="stock_sync_interval_hours">Stock Sync Interval (hours)</Label>
              <Select
                value={editFormData.stock_sync_interval_hours}
                onValueChange={(v) => setEditFormData({ ...editFormData, stock_sync_interval_hours: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every 1 hour (high velocity)</SelectItem>
                  <SelectItem value="2">Every 2 hours</SelectItem>
                  <SelectItem value="4">Every 4 hours</SelectItem>
                  <SelectItem value="6">Every 6 hours</SelectItem>
                  <SelectItem value="12">Every 12 hours</SelectItem>
                  <SelectItem value="24">Once a day (default)</SelectItem>
                  <SelectItem value="48">Every 2 days</SelectItem>
                  <SelectItem value="168">Once a week</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The rotator runs every 15 minutes and refreshes brands whose data is older than this interval.
              </p>
            </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div>
                <Label className="text-sm font-medium">PartsDoc Own Brand</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Marks this brand as ours. Used across the Hub — e.g. Amazon buy-box tiering holds own-brand listings to a stricter standard.
                </p>
              </div>
              <Switch
                checked={editFormData.is_own_brand}
                onCheckedChange={(v) => setEditFormData({ ...editFormData, is_own_brand: v })}
              />
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium">Auto Update LSA on Mintsoft</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    On the schedule set in System Settings, calculated Target LSA will be pushed to every SKU in this brand.
                  </p>
                </div>
                <Switch
                  checked={editFormData.auto_update_lsa}
                  onCheckedChange={(v) => setEditFormData({ ...editFormData, auto_update_lsa: v })}
                />
              </div>

              {editingBrand?.last_lsa_auto_update_at && (
                <p className="text-xs text-muted-foreground">
                  Last run: {new Date(editingBrand.last_lsa_auto_update_at).toLocaleString()}
                  {editingBrand.last_lsa_auto_update_summary
                    ? ` • Updated: ${editingBrand.last_lsa_auto_update_summary.updated ?? 0}, Failed: ${editingBrand.last_lsa_auto_update_summary.failed ?? 0}`
                    : ""}
                </p>
              )}

              {editFormData.auto_update_lsa && editingBrand && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={runningLsaBrandId === editingBrand.id}
                  onClick={async () => {
                    setRunningLsaBrandId(editingBrand.id);
                    const { data, error } = await supabase.functions.invoke("auto-update-lsa-cron", {
                      body: { brand_id: editingBrand.id },
                    });
                    setRunningLsaBrandId(null);
                    if (error) {
                      toast({ title: "Run failed", description: error.message, variant: "destructive" });
                    } else {
                      const s = (data as any)?.per_brand?.[editingBrand.name];
                      toast({
                        title: (data as any)?.dry_run ? "Dry run complete" : "Run complete",
                        description: s
                          ? `Candidates: ${s.candidates}, Updated: ${s.updated}, Failed: ${s.failed}`
                          : "See agent_runs for details",
                      });
                      queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
                    }
                  }}
                >
                  {runningLsaBrandId === editingBrand.id
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Running…</>
                    : <><Zap className="h-4 w-4 mr-2" />Run Auto LSA Update Now</>}
                </Button>
              )}
            </div>
            </div>

            <div className="rounded-md border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <CalendarClock className="h-4 w-4" /> Order Reminder
                  </Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Email Steven &amp; Clive this brand's current buy list on a recurring schedule.
                  </p>
                </div>
                <Switch
                  checked={scheduleForm.enabled}
                  onCheckedChange={(v) => setScheduleForm({ ...scheduleForm, enabled: v })}
                />
              </div>

              {scheduleForm.enabled && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Cadence</Label>
                      <Select
                        value={scheduleForm.cadence}
                        onValueChange={(v: Cadence) => setScheduleForm({ ...scheduleForm, cadence: v })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="fortnightly">Fortnightly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                          <SelectItem value="quarterly">Quarterly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      {scheduleForm.cadence === "weekly" || scheduleForm.cadence === "fortnightly" ? (
                        <>
                          <Label className="text-xs">Day of week</Label>
                          <Select
                            value={String(scheduleForm.day_of_week)}
                            onValueChange={(v) => setScheduleForm({ ...scheduleForm, day_of_week: Number(v) })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {DOW.map((d) => (
                                <SelectItem key={d.v} value={String(d.v)}>{d.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      ) : (
                        <>
                          <Label className="text-xs">Day of month</Label>
                          <Select
                            value={String(scheduleForm.day_of_month)}
                            onValueChange={(v) => setScheduleForm({ ...scheduleForm, day_of_month: Number(v) })}
                          >
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent className="max-h-64">
                              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                                <SelectItem key={d} value={String(d)}>{d}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Next due:{" "}
                    <strong>
                      {fmtDue(toISODate(computeNextDue(scheduleForm.cadence, scheduleForm.day_of_week, scheduleForm.day_of_month)))}
                    </strong>
                    , then every {CADENCE_EVERY[scheduleForm.cadence]}. Sends ~8am to steven@ &amp; clive@.
                    {(scheduleForm.cadence === "monthly" || scheduleForm.cadence === "quarterly") && scheduleForm.day_of_month > 28
                      ? " In shorter months this falls to the last day."
                      : ""}
                  </p>

                  {editingBrand && scheduleMap.get(editingBrand.id) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={sendingTestBrandId === editingBrand.id}
                      onClick={() => sendScheduleTest(editingBrand.id)}
                    >
                      {sendingTestBrandId === editingBrand.id
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Sending…</>
                        : <><Send className="h-4 w-4 mr-2" />Send test to me</>}
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">Save changes first to enable a test send.</p>
                  )}
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingBrand(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deletingBrand}
        onOpenChange={() => setDeletingBrand(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the brand "{deletingBrand?.name}".
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Brands;
