/**
 * Create Task form with the deprioritisation warning dialog (spec §4.4).
 * Used by /tasks/new and the drawer's Quick Add tab (compact mode).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Loader2 } from "lucide-react";
import {
  useCreateTask,
  useAssignableUsers,
  useDeprioritisationCheck,
} from "@/hooks/tasks/useTasks";
import { PRIORITY_META, type PriorityLevel, type CreateTaskInput } from "@/types/tasks";

interface CreateTaskFormProps {
  compact?: boolean;
  onCreated?: () => void;
}

const PRIORITY_LEVELS: PriorityLevel[] = [1, 2, 3, 4, 5];

export function CreateTaskForm({ compact = false, onCreated }: CreateTaskFormProps) {
  const createTask = useCreateTask();
  const { data: users } = useAssignableUsers();
  const { check } = useDeprioritisationCheck();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState<string>("self");
  const [priority, setPriority] = useState<PriorityLevel>(3);
  const [urgent, setUrgent] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [displaced, setDisplaced] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function buildInput(): CreateTaskInput {
    return {
      title: title.trim(),
      description: description.trim() || null,
      assigned_to: assignedTo === "self" ? null : assignedTo,
      priority_level: priority,
      user_urgency_flag: urgent,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
    };
  }

  function reset() {
    setTitle("");
    setDescription("");
    setAssignedTo("self");
    setPriority(3);
    setUrgent(false);
    setDueDate("");
  }

  async function doCreate() {
    await createTask.mutateAsync(buildInput());
    reset();
    onCreated?.();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    // Deprioritisation warning for high-priority tasks (spec §4.4).
    if (priority <= 2) {
      const urgencyEstimate = urgent ? 10 : 0;
      const willDisplace = await check(priority, urgencyEstimate);
      if (willDisplace.length > 0) {
        setDisplaced(willDisplace);
        setConfirmOpen(true);
        return;
      }
    }
    await doCreate();
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="task-title">Title</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs doing?"
            required
            autoFocus
          />
        </div>

        {!compact && (
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional detail…"
              rows={3}
            />
          </div>
        )}

        <div className={compact ? "space-y-3" : "grid grid-cols-2 gap-3"}>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={String(priority)} onValueChange={(v) => setPriority(Number(v) as PriorityLevel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_LEVELS.map((lvl) => (
                  <SelectItem key={lvl} value={String(lvl)}>
                    {lvl} · {PRIORITY_META[lvl].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-due">Due date</Label>
            <Input
              id="task-due"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        {!compact && (
          <div className="space-y-1.5">
            <Label>Assign to</Label>
            <Select value={assignedTo} onValueChange={setAssignedTo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="self">Myself</SelectItem>
                {(users ?? []).map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.full_name || u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div>
            <Label htmlFor="task-urgent" className="cursor-pointer">
              Flag as urgent
            </Label>
            <p className="text-[11px] text-muted-foreground">Feeds the urgency score (+10)</p>
          </div>
          <Switch id="task-urgent" checked={urgent} onCheckedChange={setUrgent} />
        </div>

        <Button type="submit" className="w-full" disabled={createTask.isPending}>
          {createTask.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Create task
        </Button>
      </form>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This will deprioritise other tasks</AlertDialogTitle>
            <AlertDialogDescription>
              Creating this task at {PRIORITY_META[priority].label} priority will push{" "}
              {displaced.length} existing task{displaced.length === 1 ? "" : "s"} down your queue:
              <span className="mt-2 block space-y-1">
                {displaced.map((t) => (
                  <span key={t} className="block text-foreground">
                    • {t}
                  </span>
                ))}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Adjust</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmOpen(false);
                await doCreate();
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
