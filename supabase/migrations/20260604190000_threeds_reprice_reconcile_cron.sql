-- Nightly reconcile of the 3D repricer pending queue.
--
-- Calls threeds-reprice-reconcile once a day (23:30 UTC) to read prices back from
-- the 3D API, confirm which pending prices took (→ 'applied'), age out stale ones
-- (→ 'expired'), and rewrite each store's SFTP file to the remaining pending set.
--
-- Same conventions as the ingest cron: pg_cron + pg_net are already enabled (do
-- NOT re-run CREATE EXTENSION — it errors 2BP01). Replace <SERVICE_ROLE_KEY> with
-- the project's service_role key (kept as a placeholder so the secret isn't in git).
-- pg_cron runs in UTC.

SELECT cron.schedule(
  'threeds-reprice-reconcile-nightly',
  '30 23 * * *',
  $$
    SELECT net.http_post(
      url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/threeds-reprice-reconcile',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
      ),
      body := jsonb_build_object('triggered_by', 'cron'),
      timeout_milliseconds := 120000
    ) AS request_id;
  $$
);
