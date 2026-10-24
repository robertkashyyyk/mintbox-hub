-- 20261024180000_service_auth_vault.sql
--
-- Move the service-role bearer out of SQL. A single helper, private.service_auth_header(),
-- reads the token from Vault (secret 'service_role_key') and returns 'Bearer <token>'.
-- Every DB function and pg_cron command that previously hard-coded a service-role JWT to
-- call an edge function now calls the helper instead. No JWT is committed to the repo.
--
-- private is NOT a PostgREST-exposed schema, and EXECUTE on the helper is revoked from
-- PUBLIC/anon/authenticated and granted only to postgres (pg_cron + SECURITY DEFINER
-- functions run as postgres), so it is not reachable via /rest/v1/rpc.

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.service_auth_header()
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT 'Bearer ' || decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key';
$function$;

DO $grants$
BEGIN
  EXECUTE 'REVOKE ALL ON SCHEMA private FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON SCHEMA private FROM anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION private.service_auth_header() FROM PUBLIC';
  EXECUTE 'REVOKE ALL ON FUNCTION private.service_auth_header() FROM anon, authenticated';
  EXECUTE 'GRANT USAGE ON SCHEMA private TO postgres';
  EXECUTE 'GRANT EXECUTE ON FUNCTION private.service_auth_header() TO postgres';
END
$grants$;

-- Audit trail of the old (JWT-redacted) commands/defs, written at migration time.
CREATE TABLE IF NOT EXISTS private.service_auth_migration_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  obj_kind text NOT NULL,
  obj_name text NOT NULL,
  old_command_redacted text NOT NULL,
  migrated_at timestamptz NOT NULL DEFAULT now()
);

-- Functions repointed at the helper -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.amazon_st_gap_heal(p_lookback_days integer DEFAULT 60, p_max_days integer DEFAULT 10, p_dry_run boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'amazon'
AS $function$
declare
  v_days date[];
  v_day date;
  v_first boolean := true;
begin
  select coalesce(array_agg(d order by d), '{}')
  into v_days
  from (
    select d::date as d
    from generate_series(current_date - p_lookback_days, current_date - 3, interval '1 day') d
    where not exists (select 1 from amazon.sales_traffic_daily s where s.metric_date = d::date)
    order by d
    limit p_max_days
  ) g;

  if p_dry_run or array_length(v_days, 1) is null then
    return jsonb_build_object('dry_run', p_dry_run, 'missing_days', to_jsonb(v_days));
  end if;

  foreach v_day in array v_days loop
    if not v_first then perform pg_sleep(65); end if;
    v_first := false;
    perform net.http_post(
      url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-sales-traffic',
      headers := jsonb_build_object('Content-Type','application/json','Authorization', private.service_auth_header()),
      body := jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'), 'triggered_by', 'gap-heal'),
      timeout_milliseconds := 150000
    );
  end loop;

  return jsonb_build_object('dry_run', false, 'requested_days', to_jsonb(v_days));
end;
$function$;

CREATE OR REPLACE FUNCTION public.amazon_fee_estimate_sweep()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'amazon'
AS $function$
declare
  v_items jsonb;
begin
  select jsonb_agg(jsonb_build_object('asin', t.asin, 'price', t.price))
  into v_items
  from (
    select split_part(s.asins, ', ', 1) as asin,
           round(coalesce(s.fbm_price_gross, s.avg_sell_price * 1.2, (s.fbm_net_per_unit + s.unit_cost) * 1.5), 2) as price
    from amazon.fba_replenishment_snapshot s
    where (
        s.ever_fba
        or (not s.ever_fba and not coalesce(s.never_fba, false)
            and s.weekly_velocity >= 3 and coalesce(s.units_30d, 0) >= 8)
      )
      and s.asins is not null
      and coalesce(s.fbm_price_gross, s.avg_sell_price, s.fbm_net_per_unit + s.unit_cost) > 0
      and not exists (
        select 1 from amazon.fba_fee_estimate fe
        where fe.asin = split_part(s.asins, ', ', 1) and fe.status = 'Success'
          and fe.estimated_at > now() - interval '30 days'
      )
    limit 500
  ) t
  where t.price > 0;

  if v_items is null then
    return jsonb_build_object('ok', true, 'posted', 0);
  end if;

  perform net.http_post(
    url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-fee-estimates',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', private.service_auth_header()),
    body := jsonb_build_object('items', v_items),
    timeout_milliseconds := 150000);
  return jsonb_build_object('ok', true, 'posted', jsonb_array_length(v_items));
end
$function$;

-- Cron commands: swap the baked service-role Bearer literal for the helper call.
-- Idempotent (only touches a job that still has a 'Bearer eyJ...' literal) and changes
-- only the Authorization header value — schedules and bodies are untouched. The old
-- command (JWT redacted) is written to private.service_auth_migration_log first.
DO $crons$
DECLARE j record; newcmd text;
BEGIN
  FOR j IN
    SELECT jobid, jobname, command FROM cron.job
    WHERE jobname IN ('ebay-token-health-daily','esagu-costfloor-daily','esagu-sync-mirror-hourly',
      'esagu-fba-guard-daily','esagu-margin-guard-daily','job-health-alert-daily','amazon-cron-health-check',
      'amazon-nightly-sales-traffic','amazon-nightly-sales-traffic-catchup','amazon-nightly-orders',
      'amazon-nightly-fba-inventory','amazon-nightly-finances','amazon-nightly-inbound-shipments',
      'ingest-3ds-orders-nightly','threeds-reprice-reconcile-nightly','threeds-auto-report-hourly',
      'reprice-payoff-daily','coverage-ebay-kickoff','coverage-ebay-continue')
      AND command ~ '''Bearer eyJ'
  LOOP
    INSERT INTO private.service_auth_migration_log (obj_kind, obj_name, old_command_redacted)
    VALUES ('cron', j.jobname, regexp_replace(j.command, 'eyJ[A-Za-z0-9._-]+', '<JWT>', 'g'));
    newcmd := regexp_replace(j.command, '''Bearer eyJ[A-Za-z0-9._\-]+''', 'private.service_auth_header()', 'g');
    PERFORM cron.alter_job(j.jobid, command => newcmd);
  END LOOP;
END
$crons$;
