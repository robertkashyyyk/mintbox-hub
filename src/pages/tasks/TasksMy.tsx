/**
 * My Tasks — the full personal queue (created by OR assigned to me), ranked by
 * composite sort_score, with search + status/priority filters (spec §6.3).
 */
import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskCard } from "@/components/tasks/TaskCard";
import { useMyTasks, useCompleteTask } from "@/hooks/tasks/useTasks";
import { PRIORITY_META, STATUS_META, type PriorityLevel, type TaskStatus } from "@/types/tasks";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITIES: PriorityLevel[] = [1, 2, 3, 4, 5];

const TasksMy = () => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");

  const { data: tasks = [], isLoading } = useMyTasks({
    search: search || undefined,
    status: status === "all" ? undefined : status,
    priority: priority === "all" ? undefined : Number(priority),
  });
  const complete = useCompleteTask();

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-teal-50">My Tasks</h1>
        <p className="mt-1 text-sm text-teal-200/60">Everything you own or are assigned.</p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-teal-200/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="border-teal-400/20 bg-[hsl(185,55%,12%)] pl-8 text-teal-50 placeholder:text-teal-200/30"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px] border-teal-400/20 bg-[hsl(185,55%,12%)] text-teal-50">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-[150px] border-teal-400/20 bg-[hsl(185,55%,12%)] text-teal-50">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={String(p)}>
                {p} · {PRIORITY_META[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-teal-400/15 bg-[hsl(185,55%,12%)] py-16 text-center">
          <p className="text-sm font-medium text-teal-50">No tasks match.</p>
          <p className="mt-1 text-xs text-teal-200/50">Adjust your filters or create a new task.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onComplete={complete} />
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksMy;
