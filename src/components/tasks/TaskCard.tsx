/**
 * Reusable task card with one-click complete and priority/urgency indicators
 * (spec §10). Used in the Today view, My Tasks queue, and the drawer.
 */
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Flame, Link2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isPast } from "date-fns";
import {
  PRIORITY_META,
  STATUS_META,
  type TaskWithSortScore,
  type PriorityLevel,
} from "@/types/tasks";

interface TaskCardProps {
  task: TaskWithSortScore;
  onComplete?: (id: string) => void;
  compact?: boolean;
}

export function TaskCard({ task, onComplete, compact = false }: TaskCardProps) {
  const priority = PRIORITY_META[task.priority_level as PriorityLevel];
  const status = STATUS_META[task.status];
  const isDone = task.status === "done" || task.status === "cancelled";
  const overdue = task.due_date && isPast(new Date(task.due_date)) && !isDone;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3 transition-colors hover:bg-card",
        overdue && "border-red-500/40",
      )}
    >
      {onComplete && !isDone && (
        <Button
          variant="outline"
          size="icon"
          className="h-7 w-7 flex-shrink-0 rounded-full border-pd-accent/40 text-pd-accent hover:bg-pd-accent hover:text-pd-accent-foreground"
          title="Mark done"
          onClick={(e) => {
            e.preventDefault();
            onComplete(task.id);
          }}
        >
          <Check className="h-4 w-4" />
        </Button>
      )}

      <div className="min-w-0 flex-1">
        <Link to={`/tasks/${task.id}`} className="block">
          <p
            className={cn(
              "truncate text-sm font-medium text-foreground",
              isDone && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </p>
        </Link>

        {!compact && task.description && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{task.description}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn("text-[10px]", priority.className)}>
            {priority.label}
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
            <Badge variant="outline" className="border-pd-accent/30 bg-pd-accent/10 text-[10px] text-pd-accent">
              System
            </Badge>
          )}
          {task.linked_entity_label && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <Link2 className="mr-0.5 h-2.5 w-2.5" />
              {task.linked_entity_label}
            </Badge>
          )}
          {task.due_date && (
            <span
              className={cn(
                "ml-auto flex items-center gap-1 text-[10px]",
                overdue ? "text-red-400" : "text-muted-foreground",
              )}
            >
              <Clock className="h-2.5 w-2.5" />
              {format(new Date(task.due_date), "d MMM HH:mm")}
            </span>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 text-right">
        <div className="text-xs font-semibold text-pd-accent" title="Urgency score">
          {task.urgency_score}
        </div>
        <div className="text-[10px] text-muted-foreground" title="Composite sort score">
          {Math.round(task.sort_score)}
        </div>
      </div>
    </div>
  );
}
