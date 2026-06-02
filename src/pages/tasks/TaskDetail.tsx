/**
 * Task detail (spec §7): full record, inline status/priority controls, the
 * urgency-vs-priority breakdown, a comment thread (with system notes) and the
 * activity timeline. All writes flow through the audited mutation hooks.
 */
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { format } from "date-fns";
import {
  ArrowLeft,
  Loader2,
  Flame,
  Link2,
  Send,
  Gauge,
  Flag,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  useTask,
  useTaskComments,
  useTaskActivity,
  useUpdateTask,
  useAddComment,
} from "@/hooks/tasks/useTasks";
import {
  PRIORITY_META,
  STATUS_META,
  type PriorityLevel,
  type TaskStatus,
} from "@/types/tasks";

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "done", "cancelled"];
const PRIORITIES: PriorityLevel[] = [1, 2, 3, 4, 5];

const TaskDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { data: task, isLoading } = useTask(id);
  const { data: comments = [] } = useTaskComments(id);
  const { data: activity = [] } = useTaskActivity(id);
  const update = useUpdateTask();
  const addComment = useAddComment();
  const [draft, setDraft] = useState("");

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-teal-300" />
      </div>
    );
  }
  if (!task) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-teal-50">Task not found.</p>
        <Button asChild variant="ghost" className="mt-3 text-teal-300">
          <Link to="/tasks">Back to Today</Link>
        </Button>
      </div>
    );
  }

  const priority = PRIORITY_META[task.priority_level as PriorityLevel];
  const status = STATUS_META[task.status];

  function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || !id) return;
    addComment.mutate({ taskId: id, body: draft.trim() }, { onSuccess: () => setDraft("") });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Button asChild variant="ghost" size="sm" className="mb-4 -ml-2 text-teal-200/60 hover:text-teal-100">
        <Link to="/tasks">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
        </Link>
      </Button>

      {/* Header */}
      <div className="rounded-xl border border-teal-400/15 bg-[hsl(185,55%,12%)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-teal-50">{task.title}</h1>
            {task.description && (
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-teal-100/70">{task.description}</p>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            <div className="flex items-center gap-1 text-sm font-semibold text-teal-200" title="Urgency score">
              <Gauge className="h-3.5 w-3.5" /> {task.urgency_score}
            </div>
            <div className="text-[11px] text-teal-200/50" title="Composite sort score">
              sort {Math.round(task.sort_score)}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("text-[10px]", priority.className)}>
            <Flag className="mr-0.5 h-2.5 w-2.5" /> {priority.label}
          </Badge>
          <Badge variant="outline" className={cn("text-[10px]", status.className)}>
            {status.label}
          </Badge>
          {task.user_urgency_flag && (
            <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-400">
              <Flame className="mr-0.5 h-2.5 w-2.5" /> Urgent
            </Badge>
          )}
          {task.task_type === "system_generated" && (
            <Badge variant="outline" className="border-teal-400/30 bg-teal-500/10 text-[10px] text-teal-300">
              System
            </Badge>
          )}
          {task.linked_entity_label && (
            <Badge variant="outline" className="text-[10px] text-teal-200/60">
              <Link2 className="mr-0.5 h-2.5 w-2.5" /> {task.linked_entity_label}
            </Badge>
          )}
        </div>

        {/* Inline controls */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-teal-200/50">Status</label>
            <Select
              value={task.status}
              onValueChange={(v) => update.mutate({ id: task.id, status: v as TaskStatus })}
            >
              <SelectTrigger className="border-teal-400/20 bg-[hsl(185,50%,15%)] text-teal-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_META[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wide text-teal-200/50">Priority</label>
            <Select
              value={String(task.priority_level)}
              onValueChange={(v) =>
                update.mutate({ id: task.id, priority_level: Number(v) as PriorityLevel })
              }
            >
              <SelectTrigger className="border-teal-400/20 bg-[hsl(185,50%,15%)] text-teal-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={String(p)}>
                    {p} · {PRIORITY_META[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] text-teal-200/60">
          <div>
            <dt className="text-teal-200/40">Assigned to</dt>
            <dd className="text-teal-100">{task.assignee_email || "Unassigned"}</dd>
          </div>
          <div>
            <dt className="text-teal-200/40">Created by</dt>
            <dd className="text-teal-100">{task.creator_email || "—"}</dd>
          </div>
          <div>
            <dt className="text-teal-200/40">Due</dt>
            <dd className="text-teal-100">
              {task.due_date ? format(new Date(task.due_date), "d MMM yyyy HH:mm") : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-teal-200/40">Created</dt>
            <dd className="text-teal-100">{format(new Date(task.created_at), "d MMM yyyy HH:mm")}</dd>
          </div>
        </dl>
      </div>

      {/* Comments */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-teal-100/80">Comments</h2>
        <form onSubmit={submitComment} className="mb-3 flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            rows={2}
            className="border-teal-400/20 bg-[hsl(185,55%,12%)] text-teal-50 placeholder:text-teal-200/30"
          />
          <Button type="submit" size="icon" disabled={!draft.trim() || addComment.isPending}>
            {addComment.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </form>
        <div className="space-y-2">
          {comments.length === 0 ? (
            <p className="text-xs text-teal-200/40">No comments yet.</p>
          ) : (
            comments.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  c.is_system_note
                    ? "border-teal-400/10 bg-teal-500/5 text-teal-200/60 italic"
                    : "border-teal-400/15 bg-[hsl(185,55%,12%)] text-teal-100",
                )}
              >
                <p>{c.body}</p>
                <p className="mt-1 text-[10px] text-teal-200/40">
                  {format(new Date(c.created_at), "d MMM HH:mm")}
                </p>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Activity timeline */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-teal-100/80">Activity</h2>
        <ol className="space-y-1.5 border-l border-teal-400/15 pl-4">
          {activity.length === 0 ? (
            <p className="text-xs text-teal-200/40">No activity recorded.</p>
          ) : (
            activity.map((a) => (
              <li key={a.id} className="relative text-xs text-teal-200/60">
                <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-teal-400/50" />
                <span className="text-teal-100">{a.action.replace(/_/g, " ")}</span>{" "}
                <span className="text-teal-200/40">
                  · {format(new Date(a.created_at), "d MMM HH:mm")}
                </span>
              </li>
            ))
          )}
        </ol>
      </section>
    </div>
  );
};

export default TaskDetail;
