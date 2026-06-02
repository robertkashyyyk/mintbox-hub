-- ============================================================================
-- Task Manager + Audit Log — Phase 1 schema (PartsDoc task-manager spec)
--
-- Design pillars baked into this migration:
--   • Priority (human, 1–5) and Urgency (machine, 0–100) are SEPARATE axes.
--     A composite sort_score = urgency*0.6 + (6-priority)*10*0.4 ranks the queue.
--   • urgency_score is derived, never hand-edited. It is recomputed on every
--     write (BEFORE trigger) AND on a 15-minute pg_cron sweep, because several
--     of its inputs are TIME-BASED (overdue, due-proximity, stalled) and so do
--     not fire on any field change.
--   • audit_log is APPEND-ONLY: enforced by the absence of UPDATE/DELETE RLS
--     policies and reinforced by GRANTs. (A DB-trigger backstop on the highest-
--     sensitivity tables is a separate follow-up migration — see project memory.)
--   • Linked entities are POLYMORPHIC (type + id + label), no FK, so a task can
--     point at a SKU / PO / listing / anything without coupling schemas.
--
-- Safe to re-run: guarded with IF NOT EXISTS / OR REPLACE / DO blocks.
-- ============================================================================

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.task_status AS ENUM
    ('todo', 'in_progress', 'blocked', 'done', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.task_type AS ENUM ('user_created', 'system_generated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── tasks ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  task_type              public.task_type NOT NULL DEFAULT 'user_created',
  title                  text NOT NULL CHECK (length(btrim(title)) > 0),
  description            text,
  status                 public.task_status NOT NULL DEFAULT 'todo',
  -- Human priority: 1 = highest, 5 = lowest.
  priority_level         int  NOT NULL DEFAULT 3 CHECK (priority_level BETWEEN 1 AND 5),
  -- Machine urgency: 0–100, derived (see compute_urgency_score).
  urgency_score          int  NOT NULL DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 100),
  -- Human "this is urgent" flag — one INPUT to urgency, not the score itself.
  user_urgency_flag      boolean NOT NULL DEFAULT false,
  due_date               timestamptz,
  reminder_at            timestamptz,
  completed_at           timestamptz,
  -- Timestamp of the last STATUS change — immune to urgency churn, so the
  -- "stalled in_progress" signal stays stable across recalc sweeps.
  last_status_change_at  timestamptz NOT NULL DEFAULT now(),
  -- Polymorphic link (no FK by design).
  linked_entity_type     text,
  linked_entity_id       text,
  linked_entity_label    text,
  source_module          text,
  source_rule            text,
  tags                   text[] NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by   ON public.tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to  ON public.tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status       ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_linked       ON public.tasks(linked_entity_type, linked_entity_id);

-- ── task_comments ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  is_system_note  boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments(task_id);

-- ── task_activity_log (per-task history; written by trigger) ──────────────────
CREATE TABLE IF NOT EXISTS public.task_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action       text NOT NULL,
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON public.task_activity_log(task_id);

-- ── audit_log (append-only, app-wide ledger) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_display_name text,
  action_type        text NOT NULL,
  entity_type        text NOT NULL,
  entity_id          text,
  entity_label       text,
  old_value          jsonb,
  new_value          jsonb,
  session_id         text,
  ip_address         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON public.audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity  ON public.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON public.audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);

-- ============================================================================
-- Urgency engine
-- ============================================================================

-- Pure function: urgency is fully determined by its inputs + the supplied "now",
-- which is why it can be IMMUTABLE (callers pass now() explicitly). Keeping it
-- pure means the same row always scores identically for a given instant — handy
-- for testing and for the scheduled sweep.
CREATE OR REPLACE FUNCTION public.compute_urgency_score(
  p_priority_level        int,
  p_due_date              timestamptz,
  p_status                public.task_status,
  p_user_urgency_flag     boolean,
  p_task_type             public.task_type,
  p_last_status_change_at timestamptz,
  p_now                   timestamptz
) RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  score int := 0;
  hours_to_due numeric;
BEGIN
  -- Finished work carries no urgency.
  IF p_status IN ('done', 'cancelled') THEN
    RETURN 0;
  END IF;

  -- Time-to-due band (the dominant time-based signal).
  IF p_due_date IS NOT NULL THEN
    hours_to_due := EXTRACT(EPOCH FROM (p_due_date - p_now)) / 3600.0;
    IF hours_to_due < 0 THEN
      score := score + 35;                 -- overdue
    ELSIF hours_to_due <= 24 THEN
      score := score + 30;
    ELSIF hours_to_due <= 48 THEN
      score := score + 20;
    ELSIF hours_to_due <= 72 THEN
      score := score + 10;
    END IF;
  END IF;

  -- Stalled: in progress and untouched for > 3 days.
  IF p_status = 'in_progress'
     AND p_last_status_change_at IS NOT NULL
     AND p_last_status_change_at < (p_now - interval '3 days') THEN
    score := score + 15;
  END IF;

  -- Human urgency flag.
  IF p_user_urgency_flag THEN
    score := score + 10;
  END IF;

  -- System-generated tasks get a small floor so they surface.
  IF p_task_type = 'system_generated' THEN
    score := score + 10;
  END IF;

  -- Low-priority damping (priority is the human axis; this only nudges urgency).
  IF p_priority_level = 4 THEN
    score := score - 10;
  ELSIF p_priority_level = 5 THEN
    score := score - 20;
  END IF;

  -- Clamp to [0, 100].
  RETURN GREATEST(0, LEAST(100, score));
END;
$$;

-- BEFORE trigger: maintain derived timestamps + recompute urgency on every write.
CREATE OR REPLACE FUNCTION public.tasks_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_status_change_at := COALESCE(NEW.last_status_change_at, now());
    IF NEW.status IN ('done', 'cancelled') THEN
      NEW.completed_at := COALESCE(NEW.completed_at, now());
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Track status transitions.
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_change_at := now();
      IF NEW.status IN ('done', 'cancelled') THEN
        NEW.completed_at := now();
      ELSE
        NEW.completed_at := NULL;
      END IF;
    END IF;

    -- Only bump updated_at on human-meaningful edits — NOT on urgency churn,
    -- so the scheduled recalc sweep doesn't make every task look "just edited".
    IF (NEW.title              IS DISTINCT FROM OLD.title)
       OR (NEW.description     IS DISTINCT FROM OLD.description)
       OR (NEW.status          IS DISTINCT FROM OLD.status)
       OR (NEW.priority_level  IS DISTINCT FROM OLD.priority_level)
       OR (NEW.assigned_to     IS DISTINCT FROM OLD.assigned_to)
       OR (NEW.due_date        IS DISTINCT FROM OLD.due_date)
       OR (NEW.reminder_at     IS DISTINCT FROM OLD.reminder_at)
       OR (NEW.user_urgency_flag IS DISTINCT FROM OLD.user_urgency_flag)
       OR (NEW.tags            IS DISTINCT FROM OLD.tags)
       OR (NEW.linked_entity_id IS DISTINCT FROM OLD.linked_entity_id) THEN
      NEW.updated_at := now();
    END IF;
  END IF;

  -- Always re-derive urgency from the (possibly updated) inputs.
  NEW.urgency_score := public.compute_urgency_score(
    NEW.priority_level, NEW.due_date, NEW.status, NEW.user_urgency_flag,
    NEW.task_type, NEW.last_status_change_at, now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_before_write ON public.tasks;
CREATE TRIGGER trg_tasks_before_write
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_before_write();

-- AFTER trigger: write per-task activity + system-note comments. SECURITY DEFINER
-- so the history is recorded even when the actor lacks INSERT on the log tables.
CREATE OR REPLACE FUNCTION public.tasks_after_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_activity_log(task_id, actor_user_id, action, detail)
    VALUES (NEW.id, NEW.created_by, 'created',
            jsonb_build_object('status', NEW.status, 'priority_level', NEW.priority_level));
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      INSERT INTO public.task_activity_log(task_id, actor_user_id, action, detail)
      VALUES (NEW.id, auth.uid(), 'status_changed',
              jsonb_build_object('from', OLD.status, 'to', NEW.status));
      INSERT INTO public.task_comments(task_id, author_user_id, body, is_system_note)
      VALUES (NEW.id, auth.uid(),
              format('Status changed from %s to %s', OLD.status, NEW.status), true);
    END IF;
    IF NEW.priority_level IS DISTINCT FROM OLD.priority_level THEN
      INSERT INTO public.task_activity_log(task_id, actor_user_id, action, detail)
      VALUES (NEW.id, auth.uid(), 'priority_changed',
              jsonb_build_object('from', OLD.priority_level, 'to', NEW.priority_level));
    END IF;
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      INSERT INTO public.task_activity_log(task_id, actor_user_id, action, detail)
      VALUES (NEW.id, auth.uid(), 'reassigned',
              jsonb_build_object('from', OLD.assigned_to, 'to', NEW.assigned_to));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_after_write ON public.tasks;
CREATE TRIGGER trg_tasks_after_write
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_after_write();

-- Recalc helpers (used by the scheduled sweep and ad-hoc calls).
CREATE OR REPLACE FUNCTION public.recalculate_urgency_score(p_task_id uuid)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.tasks
     SET urgency_score = public.compute_urgency_score(
           priority_level, due_date, status, user_urgency_flag,
           task_type, last_status_change_at, now())
   WHERE id = p_task_id;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_all_open_urgency()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer;
BEGIN
  UPDATE public.tasks
     SET urgency_score = public.compute_urgency_score(
           priority_level, due_date, status, user_urgency_flag,
           task_type, last_status_change_at, now())
   WHERE status NOT IN ('done', 'cancelled');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ============================================================================
-- Composite-score view (the queue's canonical read model)
-- ============================================================================
CREATE OR REPLACE VIEW public.tasks_with_sort_score
WITH (security_invoker = on) AS
  SELECT
    t.*,
    -- Composite ranking: urgency (machine) weighted with inverted priority (human).
    (t.urgency_score * 0.6) + ((6 - t.priority_level) * 10 * 0.4) AS sort_score,
    cp.email AS creator_email,
    ap.email AS assignee_email
  FROM public.tasks t
  LEFT JOIN public.profiles cp ON cp.id = t.created_by
  LEFT JOIN public.profiles ap ON ap.id = t.assigned_to;

-- Today view source set (overdue / due-today / up-next / done-today).
-- Returns the user's open tasks plus anything they completed today; the client
-- slots them into the four Today sections by inspecting due_date / status.
CREATE OR REPLACE FUNCTION public.get_today_tasks(p_user_id uuid)
RETURNS SETOF public.tasks_with_sort_score
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM public.tasks_with_sort_score v
  WHERE (v.created_by = p_user_id OR v.assigned_to = p_user_id)
    AND (
      v.status IN ('todo', 'in_progress', 'blocked')
      OR (v.status = 'done' AND v.completed_at >= date_trunc('day', now()))
    )
  ORDER BY v.sort_score DESC, v.due_date NULLS LAST;
$$;

-- ============================================================================
-- Row-Level Security
-- ============================================================================
ALTER TABLE public.tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log         ENABLE ROW LEVEL SECURITY;

-- tasks: owner/assignee see & edit their own; super/senior see & edit all.
DROP POLICY IF EXISTS "tasks_select" ON public.tasks;
CREATE POLICY "tasks_select" ON public.tasks FOR SELECT
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[])
  );

DROP POLICY IF EXISTS "tasks_insert" ON public.tasks;
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "tasks_update" ON public.tasks;
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[])
  )
  WITH CHECK (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[])
  );

DROP POLICY IF EXISTS "tasks_delete" ON public.tasks;
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE
  USING (public.has_role(auth.uid(), 'super_user'));

-- task_comments: visible to anyone who can see the parent task; author inserts.
DROP POLICY IF EXISTS "task_comments_select" ON public.task_comments;
CREATE POLICY "task_comments_select" ON public.task_comments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_comments.task_id
      AND (t.created_by = auth.uid()
           OR t.assigned_to = auth.uid()
           OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]))
  ));

DROP POLICY IF EXISTS "task_comments_insert" ON public.task_comments;
CREATE POLICY "task_comments_insert" ON public.task_comments FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_comments.task_id
        AND (t.created_by = auth.uid()
             OR t.assigned_to = auth.uid()
             OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]))
    )
  );

-- task_activity_log: read-only to clients (rows are written by the definer trigger).
DROP POLICY IF EXISTS "task_activity_select" ON public.task_activity_log;
CREATE POLICY "task_activity_select" ON public.task_activity_log FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = task_activity_log.task_id
      AND (t.created_by = auth.uid()
           OR t.assigned_to = auth.uid()
           OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[]))
  ));

-- audit_log: APPEND-ONLY. Insert if you are the actor; read your own or (super/
-- senior) all. The deliberate ABSENCE of UPDATE/DELETE policies makes the ledger
-- immutable from the client even though RLS is enabled.
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log FOR INSERT
  WITH CHECK (actor_user_id = auth.uid());

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log FOR SELECT
  USING (
    actor_user_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['super_user', 'senior_user']::app_role[])
  );

-- ── Grants ───────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks             TO authenticated;
GRANT SELECT, INSERT                 ON public.task_comments     TO authenticated;
GRANT SELECT                         ON public.task_activity_log TO authenticated;
-- No UPDATE/DELETE grant on audit_log: append-only at the privilege layer too.
GRANT SELECT, INSERT                 ON public.audit_log         TO authenticated;
GRANT SELECT                         ON public.tasks_with_sort_score TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_today_tasks(uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_urgency_score(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_all_open_urgency()         TO authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Drive the live drawer badge (spec §3.1). Guarded against re-add.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- ── Scheduled urgency recalc (pg_cron) ───────────────────────────────────────
-- Time-based urgency inputs (overdue, due-proximity, stalled) never fire a
-- field-change trigger, so a sweep is REQUIRED, not optional. Every 15 minutes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('recalc-task-urgency-15min')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recalc-task-urgency-15min');
    PERFORM cron.schedule(
      'recalc-task-urgency-15min',
      '*/15 * * * *',
      $cron$ SELECT public.recalculate_all_open_urgency(); $cron$
    );
  END IF;
END $$;
