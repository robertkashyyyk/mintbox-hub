-- ============================================================================
-- Task Manager & Audit Log — Phase 1 foundation
-- Spec: PartsDocHub Task Manager & Audit Log build doc (June 2026)
--   §4 urgency engine, §4.3 composite sort, §5 audit log, §6 Today view, §8 schema
--
-- Idempotent, additive migration. Uses CREATE TABLE IF NOT EXISTS and guards so
-- it can be applied to a Supabase branch/staging project first (see spec §12).
-- It does NOT touch any existing operational tables.
-- ============================================================================

-- ── tasks ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_to            uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- NULL = self-to-self
  task_type              text NOT NULL DEFAULT 'manual'
                           CHECK (task_type IN ('manual','system_generated')),
  title                  text NOT NULL,
  description            text,
  status                 text NOT NULL DEFAULT 'todo'
                           CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  priority_level         integer NOT NULL DEFAULT 3 CHECK (priority_level BETWEEN 1 AND 5),
  urgency_score          integer NOT NULL DEFAULT 0 CHECK (urgency_score BETWEEN 0 AND 100),
  user_urgency_flag      boolean NOT NULL DEFAULT false,
  due_date               timestamptz,
  reminder_at            timestamptz,
  completed_at           timestamptz,
  -- Polymorphic link to an operational entity (no FK — see spec §4.7 / §8.1).
  linked_entity_type     text,
  linked_entity_id       text,
  linked_entity_label    text,
  -- System-task provenance
  source_module          text,
  source_rule            text,
  tags                   text[] NOT NULL DEFAULT '{}',
  -- Drives the "stalled in-progress" urgency signal. Only moves when status
  -- changes, so it is immune to updated_at / urgency churn (see trigger below).
  last_status_change_at  timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_created_by  ON public.tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON public.tasks (due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_linked      ON public.tasks (linked_entity_type, linked_entity_id);

-- ── audit_log (append-only ledger — see spec §5) ────────────────────────────
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
  ip_address         text,    -- personal data under UK GDPR — see retention note §5.3
  session_id         text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor   ON public.audit_log (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON public.audit_log (action_type);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.audit_log (created_at DESC);

-- ── task_comments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body           text NOT NULL,
  is_system_note boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments (task_id, created_at);

-- ── task_activity_log (immutable per-task timeline) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.task_activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  field         text NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON public.task_activity_log (task_id, created_at);

-- ============================================================================
-- Urgency engine (spec §4.2)
-- ============================================================================

-- Pure, deterministic scorer. Unit-tested at the app layer (spec §12).
CREATE OR REPLACE FUNCTION public.compute_urgency_score(
  p_due_date              timestamptz,
  p_status                text,
  p_priority_level        integer,
  p_user_urgency_flag     boolean,
  p_task_type             text,
  p_last_status_change_at timestamptz
) RETURNS integer
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  score integer := 0;
  hours_to_due numeric;
BEGIN
  -- Closed tasks have no urgency.
  IF p_status IN ('done','cancelled') THEN
    RETURN 0;
  END IF;

  IF p_due_date IS NOT NULL THEN
    hours_to_due := EXTRACT(EPOCH FROM (p_due_date - now())) / 3600.0;
    IF hours_to_due < 0 THEN
      score := score + 35;                       -- overdue
    ELSIF hours_to_due <= 24 THEN
      score := score + 30;                       -- due within 24h
    ELSIF hours_to_due <= 48 THEN
      score := score + 20;                       -- due within 48h
    ELSIF hours_to_due <= 72 THEN
      score := score + 10;                       -- due within 72h
    END IF;
  END IF;

  -- Stalled in-progress: no status movement for > 3 days.
  IF p_status = 'in_progress'
     AND p_last_status_change_at IS NOT NULL
     AND now() - p_last_status_change_at > interval '3 days' THEN
    score := score + 15;
  END IF;

  IF p_user_urgency_flag THEN score := score + 10; END IF;
  IF p_task_type = 'system_generated' THEN score := score + 10; END IF;

  -- Low-priority dampeners.
  IF p_priority_level = 4 THEN score := score - 10;
  ELSIF p_priority_level = 5 THEN score := score - 20;
  END IF;

  RETURN GREATEST(0, LEAST(100, score));
END;
$$;

-- BEFORE write: maintain last_status_change_at, completed_at, updated_at, and
-- recompute urgency_score on every relevant field change (spec §4.2 trigger).
CREATE OR REPLACE FUNCTION public.tasks_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_status_change_at := now();
    IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.last_status_change_at := now();
      IF NEW.status = 'done' THEN
        NEW.completed_at := COALESCE(NEW.completed_at, now());
      ELSIF NEW.status <> 'done' THEN
        NEW.completed_at := NULL;
      END IF;
    END IF;

    -- Only bump updated_at when a human-meaningful field changed (not on the
    -- scheduled urgency recompute), so updated_at stays a real "last edit" mark.
    IF ( NEW.title              IS DISTINCT FROM OLD.title
      OR NEW.description        IS DISTINCT FROM OLD.description
      OR NEW.status             IS DISTINCT FROM OLD.status
      OR NEW.priority_level     IS DISTINCT FROM OLD.priority_level
      OR NEW.assigned_to        IS DISTINCT FROM OLD.assigned_to
      OR NEW.due_date           IS DISTINCT FROM OLD.due_date
      OR NEW.reminder_at        IS DISTINCT FROM OLD.reminder_at
      OR NEW.user_urgency_flag  IS DISTINCT FROM OLD.user_urgency_flag
      OR NEW.linked_entity_id   IS DISTINCT FROM OLD.linked_entity_id
      OR NEW.linked_entity_type IS DISTINCT FROM OLD.linked_entity_type
      OR NEW.tags               IS DISTINCT FROM OLD.tags ) THEN
      NEW.updated_at := now();
    END IF;
  END IF;

  NEW.urgency_score := public.compute_urgency_score(
    NEW.due_date, NEW.status, NEW.priority_level,
    NEW.user_urgency_flag, NEW.task_type, NEW.last_status_change_at
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_before_write ON public.tasks;
CREATE TRIGGER trg_tasks_before_write
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_before_write();

-- AFTER write: record the immutable activity timeline + system status notes.
CREATE OR REPLACE FUNCTION public.tasks_after_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.task_activity_log (task_id, actor_user_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'created', NULL, to_jsonb(NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.task_activity_log (task_id, actor_user_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'status', to_jsonb(OLD.status), to_jsonb(NEW.status));
    INSERT INTO public.task_comments (task_id, author_user_id, body, is_system_note)
    VALUES (NEW.id, auth.uid(),
            format('Status changed from %s to %s', OLD.status, NEW.status), true);
  END IF;

  IF NEW.priority_level IS DISTINCT FROM OLD.priority_level THEN
    INSERT INTO public.task_activity_log (task_id, actor_user_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'priority_level', to_jsonb(OLD.priority_level), to_jsonb(NEW.priority_level));
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO public.task_activity_log (task_id, actor_user_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'assigned_to', to_jsonb(OLD.assigned_to), to_jsonb(NEW.assigned_to));
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO public.task_activity_log (task_id, actor_user_id, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'due_date', to_jsonb(OLD.due_date), to_jsonb(NEW.due_date));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_after_write ON public.tasks;
CREATE TRIGGER trg_tasks_after_write
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tasks_after_write();

-- Single-task recompute (spec §8.2). Fires the BEFORE trigger.
CREATE OR REPLACE FUNCTION public.recalculate_urgency_score(p_task_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.tasks
     SET urgency_score = public.compute_urgency_score(
           due_date, status, priority_level, user_urgency_flag, task_type, last_status_change_at)
   WHERE id = p_task_id;
END;
$$;

-- Scheduled bulk recompute so time-based signals stay current between edits
-- (spec §4.2 — Phase 1 requirement, not optional). Returns rows touched.
CREATE OR REPLACE FUNCTION public.recalculate_all_open_urgency()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.tasks
     SET urgency_score = public.compute_urgency_score(
           due_date, status, priority_level, user_urgency_flag, task_type, last_status_change_at)
   WHERE status IN ('todo','in_progress','blocked');
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ============================================================================
-- tasks_with_sort_score view (spec §8.3) — composite sort + joined emails.
-- security_invoker so the underlying tasks RLS still applies to callers.
-- ============================================================================
CREATE OR REPLACE VIEW public.tasks_with_sort_score
WITH (security_invoker = on) AS
  SELECT
    t.*,
    ROUND( (t.urgency_score::numeric * 0.6)
         + ((6 - t.priority_level)::numeric * 10 * 0.4), 2) AS sort_score,
    cp.email AS creator_email,
    ap.email AS assignee_email
  FROM public.tasks t
  LEFT JOIN public.profiles cp ON cp.id = t.created_by
  LEFT JOIN public.profiles ap ON ap.id = t.assigned_to;

-- Today view source set (spec §8.2): overdue + due-soon + unacked system tasks.
CREATE OR REPLACE FUNCTION public.get_today_tasks(p_user_id uuid)
RETURNS SETOF public.tasks_with_sort_score
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT *
  FROM public.tasks_with_sort_score
  WHERE (created_by = p_user_id OR assigned_to = p_user_id)
    AND status IN ('todo','in_progress','blocked')
    AND (
      due_date < now()                              -- overdue
      OR due_date <= now() + interval '24 hours'    -- due today
      OR task_type = 'system_generated'             -- unacknowledged system task
    )
  ORDER BY sort_score DESC;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE public.tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_activity_log ENABLE ROW LEVEL SECURITY;

-- tasks ----------------------------------------------------------------------
DROP POLICY IF EXISTS "tasks select own"   ON public.tasks;
CREATE POLICY "tasks select own" ON public.tasks FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid());

DROP POLICY IF EXISTS "tasks select super" ON public.tasks;
CREATE POLICY "tasks select super" ON public.tasks FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user','senior_user']::app_role[]));

DROP POLICY IF EXISTS "tasks insert own"   ON public.tasks;
CREATE POLICY "tasks insert own" ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "tasks update own"   ON public.tasks;
CREATE POLICY "tasks update own" ON public.tasks FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR assigned_to = auth.uid()
         OR public.has_role(auth.uid(),'super_user'))
  WITH CHECK (created_by = auth.uid() OR assigned_to = auth.uid()
         OR public.has_role(auth.uid(),'super_user'));

DROP POLICY IF EXISTS "tasks delete own"   ON public.tasks;
CREATE POLICY "tasks delete own" ON public.tasks FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(),'super_user'));

-- audit_log: append-only. SELECT own or super/senior, INSERT self.
-- DELIBERATELY no UPDATE or DELETE policy — nobody can mutate the ledger (§5.1).
DROP POLICY IF EXISTS "audit select own"   ON public.audit_log;
CREATE POLICY "audit select own" ON public.audit_log FOR SELECT TO authenticated
  USING (actor_user_id = auth.uid());

DROP POLICY IF EXISTS "audit select super" ON public.audit_log;
CREATE POLICY "audit select super" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_user','senior_user']::app_role[]));

DROP POLICY IF EXISTS "audit insert self"  ON public.audit_log;
CREATE POLICY "audit insert self" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

-- task_comments --------------------------------------------------------------
DROP POLICY IF EXISTS "comments select visible" ON public.task_comments;
CREATE POLICY "comments select visible" ON public.task_comments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
           OR public.has_any_role(auth.uid(), ARRAY['super_user','senior_user']::app_role[]))
  ));

DROP POLICY IF EXISTS "comments insert author" ON public.task_comments;
CREATE POLICY "comments insert author" ON public.task_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.tasks t WHERE t.id = task_id
        AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
             OR public.has_role(auth.uid(),'super_user'))
    )
  );

-- task_activity_log: read-only to clients; rows are written by SECURITY DEFINER trigger.
DROP POLICY IF EXISTS "activity select visible" ON public.task_activity_log;
CREATE POLICY "activity select visible" ON public.task_activity_log FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tasks t WHERE t.id = task_id
      AND (t.created_by = auth.uid() OR t.assigned_to = auth.uid()
           OR public.has_any_role(auth.uid(), ARRAY['super_user','senior_user']::app_role[]))
  ));

-- ============================================================================
-- Grants
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks             TO authenticated;
GRANT SELECT, INSERT                 ON public.audit_log          TO authenticated;
GRANT SELECT, INSERT                 ON public.task_comments      TO authenticated;
GRANT SELECT                         ON public.task_activity_log  TO authenticated;
GRANT SELECT                         ON public.tasks_with_sort_score TO authenticated;
GRANT ALL ON public.tasks, public.audit_log, public.task_comments, public.task_activity_log TO service_role;

GRANT EXECUTE ON FUNCTION public.compute_urgency_score(timestamptz,text,integer,boolean,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_urgency_score(uuid)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_all_open_urgency()       TO service_role;
GRANT EXECUTE ON FUNCTION public.get_today_tasks(uuid)                TO authenticated;

-- Realtime: drawer badge subscribes to task changes (spec §3.1).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ============================================================================
-- Scheduled urgency recompute every 15 minutes (spec §4.2). Guarded so the
-- migration still applies on projects without pg_cron (e.g. a fresh branch).
-- ============================================================================
DO $$ BEGIN
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
