import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Ruler,
} from "lucide-react";

type Task = {
  id: string;
  penalty_id: string | null;
  sku: string;
  mintsoft_order_id: number | null;
  status: string;
  assigned_to: string | null;
  old_dimensions: any | null;
  new_dimensions: any | null;
  notes: string | null;
  created_at: string;
  completed_at: string | null;
  carrier_penalties?: {
    tracking_number: string | null;
    penalty_amount: number;
    reason_code: string | null;
    declared_format: string | null;
    actual_format: string | null;
  } | null;
};

const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "packer_issue", label: "Packer issue" },
  { value: "blocked", label: "Blocked" },
];

const STATUS_VARIANTS: Record<string, string> = {
  todo: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  in_progress: "bg-blue-500/15 text-blue-300 border border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  packer_issue: "bg-destructive/15 text-destructive border border-destructive/30",
  blocked: "bg-muted text-muted-foreground",
};

const CarrierRemeasure = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [newSku, setNewSku] = useState("");
  const [newOrderId, setNewOrderId] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  async function createTask() {
    if (!newSku.trim()) {
      toast.error("SKU is required");
      return;
    }
    setSavingNew(true);
    const { error } = await supabase.from("carrier_remeasure_tasks").insert({
      sku: newSku.trim().toUpperCase(),
      mintsoft_order_id: newOrderId ? parseInt(newOrderId, 10) || null : null,
      assigned_to: newAssignee.trim() || null,
      notes: newNotes.trim() || null,
      status: "todo",
    });
    setSavingNew(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Remeasure task added");
    setCreating(false);
    setNewSku(""); setNewOrderId(""); setNewAssignee(""); setNewNotes("");
    await load();
  }

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("carrier_remeasure_tasks")
      .select("id, penalty_id, sku, mintsoft_order_id, status, assigned_to, old_dimensions, new_dimensions, notes, created_at, completed_at, carrier_penalties(tracking_number, penalty_amount, reason_code, declared_format, actual_format)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) toast.error(error.message);
    setTasks((data as Task[]) ?? []);
    setLoading(false);
  }

  async function resolveUnresolved() {
    setResolving(true);
    try {
      // Pull penalties needing resolution
      const { data: pending } = await supabase
        .from("carrier_penalties")
        .select("id")
        .eq("resolution_status", "unresolved")
        .not("tracking_number", "is", null)
        .limit(200);
      const ids = (pending ?? []).map((p) => p.id);
      if (ids.length === 0) {
        toast.info("Nothing to resolve");
        return;
      }
      const { data, error } = await supabase.functions.invoke("resolve-penalty-tracking", {
        body: { penalty_ids: ids },
      });
      if (error) throw error;
      toast.success(`Resolved ${data?.resolved ?? 0} of ${ids.length} (${data?.unresolved ?? 0} still pending)`);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Resolution failed");
    } finally {
      setResolving(false);
    }
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (statusFilter === "open") list = list.filter((t) => !["completed"].includes(t.status));
    else if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.sku.toLowerCase().includes(q) ||
          t.carrier_penalties?.tracking_number?.toLowerCase().includes(q) ||
          (t.assigned_to ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [tasks, statusFilter, search]);

  // Group by SKU for the worklist
  const skuGroups = useMemo(() => {
    const map = new Map<string, Task[]>();
    filtered.forEach((t) => {
      const arr = map.get(t.sku) ?? [];
      arr.push(t);
      map.set(t.sku, arr);
    });
    return Array.from(map.entries())
      .map(([sku, items]) => ({
        sku,
        items,
        totalCost: items.reduce((a, t) => a + Number(t.carrier_penalties?.penalty_amount || 0), 0),
        openCount: items.filter((t) => t.status !== "completed").length,
      }))
      .sort((a, b) => b.openCount - a.openCount || b.totalCost - a.totalCost);
  }, [filtered]);

  const stats = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "completed").length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const issues = tasks.filter((t) => t.status === "packer_issue").length;
    const skus = new Set(tasks.filter((t) => t.status !== "completed").map((t) => t.sku)).size;
    return { open, completed, issues, skus };
  }, [tasks]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Remeasure Queue</h1>
          <p className="text-muted-foreground mt-1">
            Packer worklist — re-measure SKUs flagged by carrier penalties and update Mintsoft.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreating(true)} variant="default">
            <Ruler className="h-4 w-4 mr-2" />
            New remeasure task
          </Button>
          <Button onClick={resolveUnresolved} disabled={resolving} variant="secondary">
            {resolving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Search className="h-4 w-4 mr-2" />}
            Resolve unresolved penalties
          </Button>
          <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Open tasks" value={stats.open} />
        <Stat label="Distinct SKUs" value={stats.skus} />
        <Stat label="Completed" value={stats.completed} className="text-emerald-400" />
        <Stat label="Packer issues" value={stats.issues} className="text-destructive" />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input placeholder="Search SKU, tracking or assignee" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="all">All</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Worklist by SKU */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
            <CardTitle>Worklist — grouped by SKU</CardTitle>
          </div>
          <CardDescription>SKUs with the most open hits show first.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                  <TableHead className="text-right">Total cost</TableHead>
                  <TableHead>Latest reason</TableHead>
                  <TableHead>Declared → Actual</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skuGroups.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                      No remeasure tasks yet. Click "New remeasure task" to add one manually, or use "Resolve unresolved penalties" to auto-link from carrier penalty tracking numbers.
                    </TableCell>
                  </TableRow>
                )}
                {skuGroups.map((g) => {
                  const first = g.items[0];
                  return (
                    <TableRow key={g.sku}>
                      <TableCell className="font-mono text-xs">{g.sku}</TableCell>
                      <TableCell className="text-right">
                        <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30" variant="outline">
                          {g.openCount}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">£{g.totalCost.toFixed(2)}</TableCell>
                      <TableCell className="text-sm">{first.carrier_penalties?.reason_code ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {first.carrier_penalties?.declared_format ?? "?"} → {first.carrier_penalties?.actual_format ?? "?"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(first)}>
                          <Ruler className="h-4 w-4 mr-1" /> Open
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Detailed task table */}
      <Card>
        <CardHeader>
          <CardTitle>All tasks</CardTitle>
          <CardDescription>Individual penalty-linked tasks.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead className="text-right">Penalty</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      Nothing matches your filters.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.slice(0, 100).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs">{t.sku}</TableCell>
                    <TableCell className="font-mono text-xs">{t.mintsoft_order_id ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{t.carrier_penalties?.tracking_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_VARIANTS[t.status] ?? "bg-muted"} variant="outline">
                        {STATUS_OPTIONS.find((s) => s.value === t.status)?.label ?? t.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{t.assigned_to ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">
                      £{Number(t.carrier_penalties?.penalty_amount ?? 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TaskDialog
        task={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

      {/* Create new task */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New remeasure task</DialogTitle>
            <DialogDescription>
              Add a SKU to the packer worklist for re-measuring. Order ID is optional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="rm-sku">SKU *</Label>
              <Input
                id="rm-sku"
                placeholder="e.g. ABC-12345"
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rm-order">Mintsoft order ID</Label>
                <Input
                  id="rm-order"
                  placeholder="optional"
                  value={newOrderId}
                  onChange={(e) => setNewOrderId(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rm-assignee">Assigned to</Label>
                <Input
                  id="rm-assignee"
                  placeholder="packer name"
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rm-notes">Notes</Label>
              <Textarea
                id="rm-notes"
                placeholder="What needs checking?"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={createTask} disabled={savingNew || !newSku.trim()}>
              {savingNew ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Ruler className="h-4 w-4 mr-2" />}
              Add task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Stat = ({ label, value, className = "" }: { label: string; value: number | string; className?: string }) => (
  <Card>
    <CardContent className="pt-6">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${className}`}>{value}</div>
    </CardContent>
  </Card>
);

const TaskDialog = ({
  task,
  onClose,
  onSaved,
}: {
  task: Task | null;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const [status, setStatus] = useState("todo");
  const [assignedTo, setAssignedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!task) return;
    setStatus(task.status);
    setAssignedTo(task.assigned_to ?? "");
    setNotes(task.notes ?? "");
    const dims = task.new_dimensions ?? task.old_dimensions ?? {};
    setLength(dims.length?.toString() ?? "");
    setWidth(dims.width?.toString() ?? "");
    setHeight(dims.height?.toString() ?? "");
    setWeight(dims.weight?.toString() ?? "");
  }, [task]);

  if (!task) return null;

  async function save() {
    if (!task) return;
    setSaving(true);
    try {
      const new_dimensions: Record<string, number> = {};
      if (length) new_dimensions.length = Number(length);
      if (width) new_dimensions.width = Number(width);
      if (height) new_dimensions.height = Number(height);
      if (weight) new_dimensions.weight = Number(weight);

      const updates: Record<string, unknown> = {
        status,
        assigned_to: assignedTo || null,
        notes: notes || null,
      };
      if (Object.keys(new_dimensions).length > 0) updates.new_dimensions = new_dimensions;
      if (status === "completed") updates.completed_at = new Date().toISOString();

      const { error } = await supabase
        .from("carrier_remeasure_tasks")
        .update(updates)
        .eq("id", task.id);
      if (error) throw error;

      // Roll the linked penalty status forward
      if (task.penalty_id) {
        const penaltyStatus =
          status === "completed"
            ? "remeasured"
            : status === "packer_issue"
              ? "packer_issue"
              : "remeasure_pending";
        await supabase
          .from("carrier_penalties")
          .update({
            resolution_status: penaltyStatus,
            resolved_at: status === "completed" ? new Date().toISOString() : null,
          })
          .eq("id", task.penalty_id);
      }

      toast.success("Task saved");
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">{task.sku}</DialogTitle>
          <DialogDescription>
            Order #{task.mintsoft_order_id ?? "—"} · Tracking{" "}
            <span className="font-mono">{task.carrier_penalties?.tracking_number ?? "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded border border-border/50 bg-muted/30 p-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reason</span>
              <span>{task.carrier_penalties?.reason_code ?? "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Declared → Actual</span>
              <span>
                {task.carrier_penalties?.declared_format ?? "?"} → {task.carrier_penalties?.actual_format ?? "?"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Penalty</span>
              <span className="font-mono">£{Number(task.carrier_penalties?.penalty_amount ?? 0).toFixed(2)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned to</Label>
              <Input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="Packer name" />
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">New measurements</Label>
            <div className="grid grid-cols-4 gap-2">
              <Input placeholder="L (cm)" value={length} onChange={(e) => setLength(e.target.value)} />
              <Input placeholder="W (cm)" value={width} onChange={(e) => setWidth(e.target.value)} />
              <Input placeholder="H (cm)" value={height} onChange={(e) => setHeight(e.target.value)} />
              <Input placeholder="Weight (g)" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Update Mintsoft directly with these values. This page just records what was set.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Already correct in Mintsoft → spoke to packer Mike"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CarrierRemeasure;
