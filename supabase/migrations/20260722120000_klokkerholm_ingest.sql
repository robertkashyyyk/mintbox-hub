-- Klokkerholm Gmail ingest wiring: message dedupe table, run settings, daily cron.
-- The edge fn is DRY-RUN until ordering.klokkerholm_live=true, so scheduling is safe.

-- Dedupe: which Gmail message-IDs have been fully processed for a supplier.
CREATE TABLE IF NOT EXISTS public.supplier_feed_processed_messages (
  supplier     text NOT NULL,
  message_id   text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  summary      jsonb,
  PRIMARY KEY (supplier, message_id)
);
ALTER TABLE public.supplier_feed_processed_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sfpm_read ON public.supplier_feed_processed_messages;
CREATE POLICY sfpm_read ON public.supplier_feed_processed_messages FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.supplier_feed_processed_messages TO authenticated;
GRANT ALL ON public.supplier_feed_processed_messages TO service_role;

-- Run settings (dry-run default + write cap matching the proven 527-batch headroom).
INSERT INTO public.app_settings (key, value, description) VALUES
  ('ordering.klokkerholm_live', 'false'::jsonb, 'Klokkerholm ingest applies to Mintsoft when true; dry-run (plan only) when false'),
  ('ordering.klokkerholm_max_writes_per_run', '600'::jsonb, 'Halt the Klokkerholm run if in-scope changed SKUs exceed this (runaway guard)')
ON CONFLICT (key) DO NOTHING;

-- Daily poll at 06:00 UTC (Klokkerholm sends ~04:30; twice-weekly, idempotent via
-- message-ID dedupe so a daily check is safe and cheap). Pattern B: net.http_post
-- with anon bearer+apikey; fn is verify_jwt=false.
SELECT cron.schedule('klokkerholm-ingest-daily', '0 6 * * *', $job$
  SELECT net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/klokkerholm-ingest',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjZmJlZ2pwa3Z4a3FwcHR5eG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NjY4NjcsImV4cCI6MjA5NTU0Mjg2N30.rBlMQ15LJ2faybn2_wb3XC7s017C4qSjKQRs7PjIcMY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
$job$);
