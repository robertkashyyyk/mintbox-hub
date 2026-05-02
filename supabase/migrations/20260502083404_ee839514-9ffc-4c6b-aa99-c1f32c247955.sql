CREATE TABLE IF NOT EXISTS public.order_status_history (
  id BIGSERIAL PRIMARY KEY,
  mintsoft_order_id INTEGER NOT NULL,
  line_index INTEGER NOT NULL,
  from_status TEXT,
  to_status TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_osh_order ON public.order_status_history (mintsoft_order_id, line_index);
CREATE INDEX IF NOT EXISTS idx_osh_changed_at ON public.order_status_history (changed_at DESC);

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read order_status_history"
ON public.order_status_history FOR SELECT TO authenticated USING (true);

CREATE POLICY "service all order_status_history"
ON public.order_status_history FOR ALL TO service_role USING (true) WITH CHECK (true);