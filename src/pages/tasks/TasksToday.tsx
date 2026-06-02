/**
 * Today view — the default landing of the task environment (spec §6).
 * Four sections derived client-side from get_today_tasks(): Overdue, Due Today,
 * Up Next, Done Today. Empty state when nothing is pressing (spec §6.2).
 */
import { useMemo } from "react";
import { Loader2, AlertTriangle, Sun, ArrowDownWideNarrow, CheckCircle2 } from "lucide-react";
import { isPast, isToday } from "date-fns";
import { TaskCard } from "@/components/tasks/TaskCard";
import { useTodayTasks, useCompleteTask } from "@/hooks/tasks/useTasks";
import type { TaskWithSortScore } from "@/types/tasks";

interface Section {
  key: string;
  label: string;
  icon: typeof Sun;
  accent: string;
  tasks: TaskWithSortScore[];
}

const TasksToday = () => {
  const { data: tasks = [], isLoading } = useTodayTasks();
  const complete = useCompleteTask();

  const sections = useMemo<Section[]>(() => {
    const open = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
    const overdue: TaskWithSortScore[] = [];
    const dueToday: TaskWithSortScore[] = [];
    const upNext: TaskWithSortScore[] = [];

    for (const t of open) {
      if (t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date))) {
        overdue.push(t);
      } else if (t.due_date && isToday(new Date(t.due_date))) {
        dueToday.push(t);
      } else {
        upNext.push(t);
      }
    }

    const doneToday = tasks.filter((t) => t.status === "done");

    return [
      { key: "overdue", label: "Overdue", icon: AlertTriangle, accent: "text-red-400", tasks: overdue },
      { key: "due", label: "Due Today", icon: Sun, accent: "text-amber-300", tasks: dueToday },
      { key: "next", label: "Up Next", icon: ArrowDownWideNarrow, accent: "text-teal-300", tasks: upNext },
      { key: "done", label: "Done Today", icon: CheckCircle2, accent: "text-emerald-400", tasks: doneToday },
    ];
  }, [tasks]);

  const nothingPressing =
    !isLoading && sections.filter((s) => s.key !== "done").every((s) => s.tasks.length === 0);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-teal-50">Today</h1>
        <p className="mt-1 text-sm text-teal-200/60">
          Your focus right now — ranked by urgency and priority.
        </p>
      </header>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
        </div>
      ) : nothingPressing ? (
        <div className="rounded-xl border border-teal-400/15 bg-[hsl(185,55%,12%)] py-16 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
          <p className="mt-3 text-base font-medium text-teal-50">You're all caught up.</p>
          <p className="mt-1 text-sm text-teal-200/50">
            Nothing overdue or due today. Use “New Task” to capture what's next.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {sections.map((section) =>
            section.tasks.length === 0 ? null : (
              <section key={section.key}>
                <div className="mb-2 flex items-center gap-2">
                  <section.icon className={`h-4 w-4 ${section.accent}`} />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-teal-100/80">
                    {section.label}
                  </h2>
                  <span className="text-xs text-teal-200/40">{section.tasks.length}</span>
                </div>
                <div className="space-y-2">
                  {section.tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onComplete={section.key === "done" ? undefined : complete}
                    />
                  ))}
                </div>
              </section>
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default TasksToday;
