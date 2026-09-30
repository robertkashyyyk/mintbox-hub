-- Weekly Friday ops-checklist reminder to Steven (ODR log / response-times log / 3D import).
-- Edge fn: supabase/functions/weekly-friday-ops-reminder (deployed via MCP).
-- Config + pg_cron applied live via MCP 2026-08-17 (cron jobid 115).

INSERT INTO public.app_settings(key, value) VALUES
 ('weekly_friday_ops.recipients', '["steven@partsdoc.co.uk"]'::jsonb),
 ('weekly_friday_ops.run_hour', '11'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- LIVE (jobid 115): fire hourly on Fridays; the function self-gates to London Friday >= 11:00
-- and sends once per week. 3D-import cadence: smaller weekly, larger every 4 weeks
-- (anchor Mon 5 Jan 2026 in the function — shift the anchor to move which week is "large").
-- SELECT cron.schedule('weekly-friday-ops-reminder', '0 * * * 5', $cron$
--   SELECT net.http_post(
--     url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/weekly-friday-ops-reminder',
--     headers := jsonb_build_object('Content-Type','application/json','apikey','<ANON_KEY>','Authorization','Bearer <ANON_KEY>'),
--     body := '{}'::jsonb, timeout_milliseconds := 60000);
-- $cron$);
