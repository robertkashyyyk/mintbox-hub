-- Activity log table for user and system audit trail
-- New entries only — not backfilled from historical data

CREATE TABLE public.activity_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now() NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'system')),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  entity_label text,
  detail jsonb,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome IN ('success', 'failure', 'info')),
  error_message text
);

-- Indexes for fast time-ordered queries and common filters
CREATE INDEX activity_log_created_at_idx ON public.activity_log (created_at DESC);
CREATE INDEX activity_log_action_idx ON public.activity_log (action);
CREATE INDEX activity_log_actor_id_idx ON public.activity_log (actor_id);

-- RLS: users see their own entries, super users see all
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own activity"
  ON public.activity_log
  FOR SELECT
  USING (actor_id = auth.uid());

CREATE POLICY "Super users can view all activity"
  ON public.activity_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'super_user'
    )
  );

CREATE POLICY "Authenticated users can insert activity"
  ON public.activity_log
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.activity_log IS 'Audit log of user and system actions. New entries only — not backfilled.';
