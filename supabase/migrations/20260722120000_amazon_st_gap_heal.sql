-- Weekly self-heal for amazon.sales_traffic_daily gaps.
--
-- The nightly cron (amazon-nightly-sales-traffic 02:00 + -catchup 02:05) only
-- re-pulls yesterday and the day before, so a multi-day cron/gateway outage
-- leaves permanent holes — 2026-06-25..29 went missing silently and was only
-- found during the 2026-07-22 backfill audit.
--
-- amazon_st_gap_heal() scans the trailing p_lookback_days for metric_dates with
-- no rows (excluding the most recent 2 days, which the nightly job owns and
-- Amazon may not have finalised), then re-invokes the amazon-pull-sales-traffic
-- edge function for up to p_max_days of them, oldest first, staggered 65s apart
-- to respect the SP-API createReport throttle (~1/min). net.http_post is async,
-- so the pg_sleep staggers submissions; each report generation is handled by
-- the edge function itself (polls up to ~110s, hence timeout 150000).
--
-- NOTE: applied to prod 2026-07-22 via MCP with the real service-role JWT.
-- SERVICE_ROLE_KEY_PLACEHOLDER below must be replaced when applying by hand
-- (same pattern as 20260701090000_amazon_nightly_cron_v2.sql).
create or replace function public.amazon_st_gap_heal(
  p_lookback_days int default 60,
  p_max_days int default 10,
  p_dry_run boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, amazon
as $$
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
    where not exists (
      select 1 from amazon.sales_traffic_daily s where s.metric_date = d::date
    )
    order by d
    limit p_max_days
  ) g;

  if p_dry_run or array_length(v_days, 1) is null then
    return jsonb_build_object('dry_run', p_dry_run, 'missing_days', to_jsonb(v_days));
  end if;

  foreach v_day in array v_days loop
    if not v_first then
      perform pg_sleep(65);
    end if;
    v_first := false;
    perform net.http_post(
      url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/amazon-pull-sales-traffic',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer SERVICE_ROLE_KEY_PLACEHOLDER'
      ),
      body := jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'), 'triggered_by', 'gap-heal'),
      timeout_milliseconds := 150000
    );
  end loop;

  return jsonb_build_object('dry_run', false, 'requested_days', to_jsonb(v_days));
end;
$$;

revoke all on function public.amazon_st_gap_heal(int, int, boolean) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'amazon-weekly-st-gap-heal';
select cron.schedule(
  'amazon-weekly-st-gap-heal',
  '0 4 * * 0',
  $$select public.amazon_st_gap_heal();$$
);
