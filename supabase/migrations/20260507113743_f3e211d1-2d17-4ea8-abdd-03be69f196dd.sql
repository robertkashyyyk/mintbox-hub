-- Cron: every 5 minutes pop one queued image scout job
SELECT cron.schedule(
  'image-scout-worker-5min',
  '*/5 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://zadsuqxcchpnegcynflb.supabase.co/functions/v1/image-scout-process',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"pick":true}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);