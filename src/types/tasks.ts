/**
 * Task Manager shared domain types + display metadata (task-manager spec §10).
 *
 * These mirror the tasks / task_comments / task_activity_log / audit_log tables
 * created in 20260601150000_tasks_and_audit_log.sql. They are hand-written
 * because the generated Supabase types won't include the new tables until the
 * migration is applied and `supabase gen types` is re-run; the data layer casts
 * the client to `any` and returns these shapes so the UI stays fully typed.
 */

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskType = "user_created" | "system_generated";
export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

/** Polymorphic link target — no FK, just a typed pointer + display label. */
export type LinkedEntityType =
  | "sku"
  | "purchase_order"
  | "listing"
  | "brand"
  | "supplier"
  | "stock_count"
  | "user"
  | "other";

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
  last_status_change_at: string;
  linked_entity_type: LinkedEntityType | string | null;
  linked_entity_id: string | null;
  linked_entity_label: string | null;
  source_module: string | null;
  source_rule: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

/** Row shape returned by the tasks_with_sort_score view. */
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
  action: string;
  detail: Record<string, unknown> | null;
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
  session_id: string | null;
  ip_address: string | null;
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
  linked_entity_type?: LinkedEntityType | string | null;
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
  tags?: string[];
}

// ── Display metadata ──────────────────────────────────────────────────────────

interface PriorityMeta {
  label: string;
  className: string;
}

/** Human priority axis (1 = highest). Colour goes cool → warm as priority rises. */
export const PRIORITY_META: Record<PriorityLevel, PriorityMeta> = {
  1: { label: "Critical", className: "border-red-500/40 bg-red-500/10 text-red-400" },
  2: { label: "High", className: "border-orange-500/40 bg-orange-500/10 text-orange-400" },
  3: { label: "Normal", className: "border-border bg-muted/40 text-muted-foreground" },
  4: { label: "Low", className: "border-sky-500/30 bg-sky-500/10 text-sky-400" },
  5: { label: "Lowest", className: "border-slate-500/30 bg-slate-500/10 text-slate-400" },
};

interface StatusMeta {
  label: string;
  className: string;
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  todo: { label: "To do", className: "border-border bg-muted/40 text-muted-foreground" },
  in_progress: { label: "In progress", className: "border-pd-accent/40 bg-pd-accent/10 text-pd-accent" },
  blocked: { label: "Blocked", className: "border-amber-500/40 bg-amber-500/10 text-amber-400" },
  done: { label: "Done", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  cancelled: { label: "Cancelled", className: "border-border bg-muted/30 text-muted-foreground" },
};

/**
 * Composite ranking used across the queue. Mirrors the SQL in
 * tasks_with_sort_score: urgency (machine, weighted 0.6) blended with the
 * inverted human priority (weighted 0.4). Higher sorts first.
 */
export function computeSortScore(urgencyScore: number, priorityLevel: PriorityLevel): number {
  return urgencyScore * 0.6 + (6 - priorityLevel) * 10 * 0.4;
}
