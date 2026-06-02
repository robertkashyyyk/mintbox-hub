/**
 * All Tasks — team-wide queue (super/senior oversight, spec §6.4). Groups by
 * assignee so leads can see where work sits. RLS already restricts who can read
 * the full set; this page is also gated to super users by the layout nav.
 */
import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { TaskCard } from "@/components/tasks/TaskCard";
import { useAllTasks, useCompleteTask } from "@/hooks/tasks/useTasks";
import type { TaskWithSortScore } from "@/types/tasks";

const TasksAll = () => {
  const { data: tasks = [], isLoading } = useAllTasks();
  const complete = useCompleteTask();

  const groups = useMemo(() => {
    const map = new Map<string, TaskWithSortScore[]>();
    for (const t of tasks) {
      const key = t.assignee_email || t.creator_email || "Unassigned";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [tasks]);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-teal-50">All Tasks</h1>
        <p className="mt-1 text-sm text-teal-200/60">
          Team-wide view, grouped by who's carrying the work.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-teal-400/15 bg-[hsl(185,55%,12%)] py-16 text-center">
          <p className="text-sm font-medium text-teal-50">No tasks yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(([owner, ownerTasks]) => (
            <section key={owner}>
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold text-teal-100/80">{owner}</h2>
                <span className="text-xs text-teal-200/40">{ownerTasks.length}</span>
              </div>
              <div className="space-y-2">
                {ownerTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onComplete={complete} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksAll;
