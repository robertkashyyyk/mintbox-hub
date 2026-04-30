import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Plus, BookOpen, Trash2, ExternalLink, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Catalogue = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  public_visible: boolean;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
};

const slugify = (s: string) =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export default function CatalogueLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const { data: catalogues, isLoading } = useQuery({
    queryKey: ["catalogues"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalogues")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Catalogue[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const baseSlug = slugify(title) || `catalogue-${Date.now()}`;
      const { data: userData } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("catalogues")
        .insert({
          title: title.trim(),
          slug: `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`,
          description: description.trim() || null,
          status: "draft",
          public_visible: false,
          created_by: userData.user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Catalogue created" });
      setOpen(false);
      setTitle("");
      setDescription("");
      queryClient.invalidateQueries({ queryKey: ["catalogues"] });
      navigate(`/admin/catalogues/${data.id}`);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to create catalogue", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("catalogues").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Catalogue deleted" });
      queryClient.invalidateQueries({ queryKey: ["catalogues"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete", description: err.message, variant: "destructive" });
    },
  });

  const statusColor = (s: Catalogue["status"]) =>
    s === "published" ? "bg-pd-accent text-foreground" : s === "archived" ? "bg-muted" : "bg-secondary";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-1 rounded-full bg-pd-accent" />
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Catalogue Library</h1>
            <p className="text-sm text-foreground/60">
              Create and manage branded product catalogues for trade and public use.
            </p>
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> New catalogue
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create catalogue</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Spring 2026 Trade Catalogue"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Short summary shown on the cover and listing."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create & open builder
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-foreground/60">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : !catalogues?.length ? (
        <Card className="bg-card/40 border-foreground/10">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BookOpen className="h-12 w-12 text-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold text-foreground">No catalogues yet</h3>
            <p className="text-sm text-foreground/60 mt-1 mb-6 max-w-md">
              Create your first catalogue to start grouping products into a branded, shareable
              document.
            </p>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> New catalogue
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {catalogues.map((c) => (
            <Card
              key={c.id}
              className="bg-card/60 border-foreground/10 hover:border-pd-accent/50 transition-colors group"
            >
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <button
                    onClick={() => navigate(`/admin/catalogues/${c.id}`)}
                    className="text-left flex-1"
                  >
                    <h3 className="font-semibold text-foreground group-hover:text-pd-accent transition-colors">
                      {c.title}
                    </h3>
                    <p className="text-xs text-foreground/50 mt-0.5 font-mono">{c.slug}</p>
                  </button>
                  <Badge className={statusColor(c.status)}>{c.status}</Badge>
                </div>
                {c.description && (
                  <p className="text-sm text-foreground/60 line-clamp-2">{c.description}</p>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-foreground/5">
                  <span className="text-xs text-foreground/40">
                    Updated {new Date(c.updated_at).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/admin/catalogues/${c.id}`)}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete catalogue?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes "{c.title}" and all its items. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(c.id)}
                            className="bg-destructive hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
