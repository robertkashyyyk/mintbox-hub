SELECT cron.schedule(
  'mintsoft-backorder-age-snapshot-daily',
  '30 6 * * *',
  $$SELECT net.http_post(
    url := 'https://zadsuqxcchpnegcynflb.supabase.co/functions/v1/mintsoft-backorder-age-snapshot',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphZHN1cXhjY2hwbmVnY3luZmxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3MDMzMDYsImV4cCI6MjA3ODI3OTMwNn0.BJzW4zmeHN56a1Pe98tWNQu1YoRnSpPPZjz6zfuslQU"}'::jsonb,
    body := '{"triggered_by": "cron"}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;$$
);