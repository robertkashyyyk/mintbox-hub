/**
 * Task Manager data layer — all task queries and mutations (spec §10).
 *
 * The tasks tables are not yet in the generated Supabase types (the migration
 * 20260601130000_tasks_and_audit_log.sql must be applied and types regenerated).
 * Until then we cast the client to `any` at the call boundary and return the
 * strongly-typed domain shapes from src/types/tasks.ts, so the rest of the app
 * stays fully typed.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { logAuditEvent, AuditActions } from "@/lib/auditLog";
import type {
  Task,
  TaskWithSortScore,
  TaskComment,
  TaskActivity,
  CreateTaskInput,
  UpdateTaskInput,
} from "@/types/tasks";

// Loosely-typed client for the not-yet-generated tables.
const sb = supabase as any;

const OPEN_STATUSES = ["todo", "in_progress", "blocked"];

export const taskKeys = {
  all: ["tasks"] as const,
  today: () => [...taskKeys.all, "today"] as const,
  my: (filters?: unknown) => [...taskKeys.all, "my", filters] as const,
  team: () => [...taskKeys.all, "team"] as const,
  detail: (id: string) => [...taskKeys.all, "detail", id] as const,
  comments: (id: string) => [...taskKeys.all, "comments", id] as const,
  activity: (id: string) => [...taskKeys.all, "activity", id] as const,
  openCount: () => [...taskKeys.all, "open-count"] as const,
};

async function getUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return user.id;
}

// ── Queries ──────────────────────────────────────────────────────────────────

/** Today view source set (spec §6) via the get_today_tasks() RPC. */
export function useTodayTasks() {
  return useQuery({
    queryKey: taskKeys.today(),
    queryFn: async (): Promise<TaskWithSortScore[]> => {
      const userId = await getUserId();
      const { data, error } = await sb.rpc("get_today_tasks", { p_user_id: userId });
      if (error) throw error;
      return (data ?? []) as TaskWithSortScore[];
    },
  });
}

/** Full personal queue — created by OR assigned to the current user. */
export function useMyTasks(opts?: { search?: string; status?: string; priority?: number }) {
  return useQuery({
    queryKey: taskKeys.my(opts),
    queryFn: async (): Promise<TaskWithSortScore[]> => {
      const userId = await getUserId();
      let query = sb
        .from("tasks_with_sort_score")
        .select("*")
        .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
        .order("sort_score", { ascending: false });

      if (opts?.status) query = query.eq("status", opts.status);
      if (opts?.priority) query = query.eq("priority_level", opts.priority);

      const { data, error } = await query;
      if (error) throw error;

      let rows = (data ?? []) as TaskWithSortScore[];
      if (opts?.search) {
        const s = opts.search.toLowerCase();
        rows = rows.filter(
          (t) =>
            t.title.toLowerCase().includes(s) ||
            (t.description ?? "").toLowerCase().includes(s),
        );
      }
      return rows;
    },
  });
}

/** All tasks across the team (super-user view). */
export function useAllTasks() {
  return useQuery({
    queryKey: taskKeys.team(),
    queryFn: async (): Promise<TaskWithSortScore[]> => {
      const { data, error } = await sb
        .from("tasks_with_sort_score")
        .select("*")
        .order("sort_score", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaskWithSortScore[];
    },
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? ""),
    enabled: !!id,
    queryFn: async (): Promise<TaskWithSortScore> => {
      const { data, error } = await sb
        .from("tasks_with_sort_score")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as TaskWithSortScore;
    },
  });
}

export function useTaskComments(taskId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.comments(taskId ?? ""),
    enabled: !!taskId,
    queryFn: async (): Promise<TaskComment[]> => {
      const { data, error } = await sb
        .from("task_comments")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TaskComment[];
    },
  });
}

export function useTaskActivity(taskId: string | undefined) {
  return useQuery({
    queryKey: taskKeys.activity(taskId ?? ""),
    enabled: !!taskId,
    queryFn: async (): Promise<TaskActivity[]> => {
      const { data, error } = await sb
        .from("task_activity_log")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as TaskActivity[];
    },
  });
}

/** Open task count for the current user — drives the drawer badge (spec §3.1). */
export function useOpenTaskCount() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: taskKeys.openCount(),
    queryFn: async (): Promise<number> => {
      const userId = await getUserId();
      const { count, error } = await sb
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
        .in("status", OPEN_STATUSES);
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Realtime: refresh the badge whenever any task row changes (spec §3.1).
  useEffect(() => {
    const channel = supabase
      .channel("tasks-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
        queryClient.invalidateQueries({ queryKey: taskKeys.all });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return query;
}

/** Profiles list for the assignee picker. */
export function useAssignableUsers() {
  return useQuery({
    queryKey: ["assignable-users"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("profiles")
        .select("id, email, full_name")
        .order("email");
      if (error) throw error;
      return (data ?? []) as { id: string; email: string | null; full_name: string | null }[];
    },
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTaskInput): Promise<Task> => {
      const userId = await getUserId();
      const { data, error } = await sb
        .from("tasks")
        .insert({
          created_by: userId,
          assigned_to: input.assigned_to ?? null,
          title: input.title,
          description: input.description ?? null,
          priority_level: input.priority_level ?? 3,
          user_urgency_flag: input.user_urgency_flag ?? false,
          due_date: input.due_date ?? null,
          reminder_at: input.reminder_at ?? null,
          linked_entity_type: input.linked_entity_type ?? null,
          linked_entity_id: input.linked_entity_id ?? null,
          linked_entity_label: input.linked_entity_label ?? null,
          tags: input.tags ?? [],
        })
        .select()
        .single();
      if (error) throw error;

      const task = data as Task;
      await logAuditEvent({
        action_type: AuditActions.TASK_CREATED,
        entity_type: "task",
        entity_id: task.id,
        entity_label: task.title,
        new_value: { status: task.status, priority_level: task.priority_level },
      });
      if (input.assigned_to && input.assigned_to !== userId) {
        await logAuditEvent({
          action_type: AuditActions.TASK_ASSIGNED,
          entity_type: "task",
          entity_id: task.id,
          entity_label: task.title,
          new_value: { assigned_to: input.assigned_to },
        });
      }
      return task;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      toast({ title: "Task created" });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't create task", description: err.message, variant: "destructive" });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateTaskInput): Promise<Task> => {
      const { id, ...patch } = input;

      // Read prior state so we can write meaningful audit entries.
      const { data: prior } = await sb.from("tasks").select("*").eq("id", id).single();

      const { data, error } = await sb.from("tasks").update(patch).eq("id", id).select().single();
      if (error) throw error;
      const task = data as Task;

      if (prior && patch.status && patch.status !== prior.status) {
        await logAuditEvent({
          action_type:
            patch.status === "done" ? AuditActions.TASK_COMPLETED : AuditActions.TASK_STATUS_CHANGED,
          entity_type: "task",
          entity_id: id,
          entity_label: task.title,
          old_value: { status: prior.status },
          new_value: { status: patch.status },
        });
      }
      if (prior && patch.priority_level && patch.priority_level !== prior.priority_level) {
        await logAuditEvent({
          action_type: AuditActions.TASK_PRIORITY_CHANGED,
          entity_type: "task",
          entity_id: id,
          entity_label: task.title,
          old_value: { priority_level: prior.priority_level },
          new_value: { priority_level: patch.priority_level },
        });
      }
      if (prior && patch.assigned_to !== undefined && patch.assigned_to !== prior.assigned_to) {
        await logAuditEvent({
          action_type: AuditActions.TASK_ASSIGNED,
          entity_type: "task",
          entity_id: id,
          entity_label: task.title,
          old_value: { assigned_to: prior.assigned_to },
          new_value: { assigned_to: patch.assigned_to },
        });
      }
      return task;
    },
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(task.id) });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't update task", description: err.message, variant: "destructive" });
    },
  });
}

/** One-click complete (spec §10 TaskCard). */
export function useCompleteTask() {
  const update = useUpdateTask();
  return (id: string) => update.mutate({ id, status: "done" });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, body }: { taskId: string; body: string }) => {
      const userId = await getUserId();
      const { error } = await sb
        .from("task_comments")
        .insert({ task_id: taskId, author_user_id: userId, body, is_system_note: false });
      if (error) throw error;
    },
    onSuccess: (_d, { taskId }) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(taskId) });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't add comment", description: err.message, variant: "destructive" });
    },
  });
}

/** Deprioritisation check (spec §4.4): would a new high-priority task displace
 *  any task currently in the user's top five? Returns the titles that would drop. */
export function useDeprioritisationCheck() {
  const [topTitles, setTopTitles] = useState<string[]>([]);

  async function check(newPriority: number, newUrgencyEstimate = 0): Promise<string[]> {
    const userId = await getUserId();
    const { data } = await sb
      .from("tasks_with_sort_score")
      .select("title, sort_score")
      .or(`created_by.eq.${userId},assigned_to.eq.${userId}`)
      .in("status", OPEN_STATUSES)
      .order("sort_score", { ascending: false })
      .limit(5);

    const top = (data ?? []) as { title: string; sort_score: number }[];
    // Estimate the new task's score from priority alone (urgency unknown pre-save).
    const newScore = newUrgencyEstimate * 0.6 + (6 - newPriority) * 10 * 0.4;
    const displaced = top.filter((t) => t.sort_score < newScore).map((t) => t.title);
    setTopTitles(displaced);
    return displaced;
  }

  return { check, topTitles };
}
