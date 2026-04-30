import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, Edit2, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";

const EbayAdmin = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");

  const { data: sellers, isLoading } = useQuery({
    queryKey: ["ebay-sellers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ebay_seller_usernames")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const { mutate: addSeller, isPending: isAdding } = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("ebay_seller_usernames")
        .insert({
          username: newUsername.trim(),
          notes: newDisplayName.trim() || null,
          active: true,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ebay-sellers"] });
      setNewUsername("");
      setNewDisplayName("");
      toast({
        title: "Seller Added",
        description: "eBay seller account has been added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Add Seller",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { mutate: updateSeller } = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: any }) => {
      const { error } = await supabase
        .from("ebay_seller_usernames")
        .update(updates)
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ebay-sellers"] });
      setEditingId(null);
      toast({
        title: "Seller Updated",
        description: "eBay seller account has been updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Seller",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { mutate: deleteSeller } = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("ebay_seller_usernames")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ebay-sellers"] });
      toast({
        title: "Seller Deleted",
        description: "eBay seller account has been removed",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Delete Seller",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddSeller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter a username",
        variant: "destructive",
      });
      return;
    }
    addSeller();
  };

  const startEdit = (seller: any) => {
    setEditingId(seller.id);
    setEditUsername(seller.username);
    setEditDisplayName(seller.notes || "");
  };

  const saveEdit = () => {
    if (!editUsername.trim()) {
      toast({
        title: "Missing Information",
        description: "Username cannot be empty",
        variant: "destructive",
      });
      return;
    }
    updateSeller({
      id: editingId!,
      updates: {
        username: editUsername.trim(),
        notes: editDisplayName.trim() || null,
      },
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditUsername("");
    setEditDisplayName("");
  };

  const toggleActive = (id: string, currentActive: boolean) => {
    updateSeller({
      id,
      updates: { active: !currentActive },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">eBay Admin</h1>
        <p className="text-foreground/60 mt-2">
          Manage your eBay seller accounts for price comparison
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add New Seller Account</CardTitle>
          <CardDescription>
            Enter the eBay username and display name for your seller account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddSeller} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="username">eBay Username</Label>
                <Input
                  id="username"
                  placeholder="e.g., asc_group"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  disabled={isAdding}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayName">Display Name (Optional)</Label>
                <Input
                  id="displayName"
                  placeholder="e.g., ASC GROUP"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  disabled={isAdding}
                />
              </div>
            </div>
            <Button type="submit" disabled={isAdding}>
              <Plus className="mr-2 h-4 w-4" />
              {isAdding ? "Adding..." : "Add Seller Account"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your eBay Seller Accounts</CardTitle>
          <CardDescription>
            Manage the seller accounts used for price comparison
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : sellers && sellers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>eBay Username</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sellers.map((seller) => (
                  <TableRow key={seller.id}>
                    <TableCell className="font-medium">
                      {editingId === seller.id ? (
                        <Input
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          className="max-w-xs"
                        />
                      ) : (
                        seller.username
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === seller.id ? (
                        <Input
                          value={editDisplayName}
                          onChange={(e) => setEditDisplayName(e.target.value)}
                          className="max-w-xs"
                          placeholder="Optional"
                        />
                      ) : (
                        seller.notes || "-"
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={seller.active}
                        onCheckedChange={() => toggleActive(seller.id, seller.active)}
                        disabled={editingId === seller.id}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {editingId === seller.id ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={saveEdit}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEdit(seller)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteSeller(seller.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No seller accounts added yet. Add your first account above.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EbayAdmin;
