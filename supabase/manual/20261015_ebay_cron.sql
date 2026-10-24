-- 2026-10-15: daily eBay credential-expiry check (ebay-token-health), applied in prod as
-- cron job 'ebay-token-health-daily' at 08:05 UTC. Goes through public.cron_http_post so the
-- job-health guard sees real outcomes. The bearer is copied server-side from an existing job.
select cron.schedule('ebay-token-health-daily', '5 8 * * *',
  format($cmd$SELECT public.cron_http_post('ebay-token-health-daily',
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/ebay-token-health',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
    body := jsonb_build_object('triggered_by','cron'));$cmd$,
    'Bearer ' || (select substring(command from 'Bearer ([A-Za-z0-9._\-]+)') from cron.job where jobid = 78)));
