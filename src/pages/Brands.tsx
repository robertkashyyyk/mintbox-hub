import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState } from "react";
import { Pencil, Trash2, Plus, Loader2, Zap } from "lucide-react";
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
  });
  const [runningLsaBrandId, setRunningLsaBrandId] = useState<string | null>(null);
  const [addFormData, setAddFormData] = useState({
    name: "",
    prefix: "",
    prefix_style: "hyphen" as "hyphen" | "slash",
    family: "",
    remote_stock_feed_type: "" as any,
    base_multiplier: "",
  });

  const { data: brands, isLoading } = useQuery({
    queryKey: ["brands-with-count"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_brands_with_product_counts");
      if (error) throw error;
      return data as any[];
    },
  });

  const createBrandMutation = useMutation({
    mutationFn: async (data: any) => {
      const { error } = await supabase.from("brands").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
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
    mutationFn: async (data: { id: string; updates: any }) => {
      const { error } = await supabase
        .from("brands")
        .update(data.updates)
        .eq("id", data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
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
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("brands").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["brands-with-count"] });
      await queryClient.refetchQueries({ queryKey: ["brands-with-count"] });
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

  const handleEdit = (brand: any) => {
    setEditingBrand(brand);
    setEditFormData({
      name: brand.name || "",
      prefix: brand.prefix || "",
      prefix_style: brand.prefix_style || "hyphen",
      family: brand.family || "",
      remote_stock_feed_type: brand.remote_stock_feed_type || "",
      base_multiplier: brand.base_multiplier?.toString() || "",
      auto_update_lsa: !!brand.auto_update_lsa,
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
    
    const updates = {
      name: editFormData.name,
      prefix: editFormData.prefix,
      prefix_style: editFormData.prefix_style,
      family: editFormData.family || null,
      remote_stock_feed_type: editFormData.remote_stock_feed_type || null,
      base_multiplier: editFormData.base_multiplier ? Number(editFormData.base_multiplier) : null,
      auto_update_lsa: editFormData.auto_update_lsa,
    };
    
    updateBrandMutation.mutate({
      id: editingBrand.id,
      updates,
    });
  };

  const handleDelete = () => {
    if (!deletingBrand) return;
    deleteBrandMutation.mutate(deletingBrand.id);
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
    });
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Brands</h1>
          <p className="text-foreground/60">
            Manage brands and view product counts
          </p>
        </div>
        <Button onClick={() => setIsAddingBrand(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Brand
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Brands ({brands?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand Name</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Prefix Style</TableHead>
                  <TableHead>Family</TableHead>
                  <TableHead>Base Multiplier</TableHead>
                  <TableHead>Auto LSA</TableHead>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Brand</DialogTitle>
            <DialogDescription>
              Enter the details for the new brand.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Brand</DialogTitle>
            <DialogDescription>
              Update the brand information below.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
