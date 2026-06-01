/**
 * Shared types for the Task Manager & Audit Log feature.
 *
 * These mirror the schema in
 *   supabase/migrations/20260601130000_tasks_and_audit_log.sql
 * The generated Supabase types (src/integrations/supabase/types.ts) will pick
 * these tables up once the migration is applied and types are regenerated;
 * until then the hooks cast the client (see src/hooks/tasks/useTasks.ts).
 */

export type TaskType = "manual" | "system_generated";

export type TaskStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

/** 1 = Critical … 5 = Someday (spec §4.2). */
export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

export type LinkedEntityType =
  | "sku"
  | "supplier"
  | "purchase_order"
  | "brand"
  | "listing"
  | "order";

export interface Task {
  id: string;
  created_by: string;
  assigned_to: string | null;
  task_type: TaskType;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority_level: PriorityLevel;
  urgency_score: number;
  user_urgency_flag: boolean;
  due_date: string | null;
  reminder_at: string | null;
  completed_at: string | null;
  linked_entity_type: LinkedEntityType | null;
  linked_entity_id: string | null;
  linked_entity_label: string | null;
  source_module: string | null;
  source_rule: string | null;
  tags: string[];
  last_status_change_at: string;
  created_at: string;
  updated_at: string;
}

/** Row shape from the tasks_with_sort_score view (spec §8.3). */
export interface TaskWithSortScore extends Task {
  sort_score: number;
  creator_email: string | null;
  assignee_email: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_user_id: string | null;
  body: string;
  is_system_note: boolean;
  created_at: string;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  actor_user_id: string | null;
  field: string;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip_address: string | null;
  session_id: string | null;
  created_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  assigned_to?: string | null;
  priority_level?: PriorityLevel;
  user_urgency_flag?: boolean;
  due_date?: string | null;
  reminder_at?: string | null;
  linked_entity_type?: LinkedEntityType | null;
  linked_entity_id?: string | null;
  linked_entity_label?: string | null;
  tags?: string[];
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  description?: string | null;
  assigned_to?: string | null;
  status?: TaskStatus;
  priority_level?: PriorityLevel;
  user_urgency_flag?: boolean;
  due_date?: string | null;
  reminder_at?: string | null;
}

// ── Display metadata ─────────────────────────────────────────────────────────

export const PRIORITY_META: Record<
  PriorityLevel,
  { label: string; meaning: string; className: string }
> = {
  1: { label: "Critical", meaning: "Business-stopping; immediate attention",   className: "bg-red-500/15 text-red-500 border-red-500/30" },
  2: { label: "High",     meaning: "Important; should be addressed today",     className: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  3: { label: "Medium",   meaning: "Normal work; address this week",           className: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
  4: { label: "Low",      meaning: "Useful but not pressing",                  className: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  5: { label: "Someday",  meaning: "Backlog; no specific timeframe",           className: "bg-muted/40 text-muted-foreground border-border" },
};

export const STATUS_META: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  todo:        { label: "To Do",       className: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
  in_progress: { label: "In Progress", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  blocked:     { label: "Blocked",     className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  done:        { label: "Done",        className: "bg-green-500/15 text-green-500 border-green-500/30" },
  cancelled:   { label: "Cancelled",   className: "bg-muted/40 text-muted-foreground border-border" },
};

/**
 * Composite sort score (spec §4.3). Mirrors the SQL in tasks_with_sort_score so
 * it can be unit-tested and used as a client-side fallback.
 *   sort_score = (urgency × 0.6) + ((6 − priority) × 10 × 0.4)
 */
export function computeSortScore(urgencyScore: number, priorityLevel: PriorityLevel): number {
  return urgencyScore * 0.6 + (6 - priorityLevel) * 10 * 0.4;
}
