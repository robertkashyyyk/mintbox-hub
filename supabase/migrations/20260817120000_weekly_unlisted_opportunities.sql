-- Weekly "in stock, not listed on eBay" opportunities email.
-- Snapshot table + digest/progress RPCs + app_settings config + pg_cron schedule.
-- Edge function: supabase/functions/weekly-unlisted-opportunities-run (deployed via MCP).
-- Applied live via MCP 2026-08-17; cron switched on (jobid 111) after Robert approved the sample.

-- Weekly snapshot of the unlisted set, so we can show "what got listed since".
CREATE TABLE IF NOT EXISTS public.weekly_unlisted_snapshot(
  run_date date NOT NULL,
  sku text NOT NULL,
  capital numeric,
  PRIMARY KEY (run_date, sku)
);

-- Simple digest (totals + top 10), used for ad-hoc/preview. Materialized single pass;
-- own 120s timeout so a caller's shorter statement_timeout doesn't cancel it.
CREATE OR REPLACE FUNCTION public.get_weekly_unlisted_digest(p_min_capital numeric DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '120000'
AS $$
  WITH u AS MATERIALIZED (SELECT * FROM public.get_ebay_unlisted_skus(p_min_capital, 5000)),
  clean AS MATERIALIZED (SELECT * FROM u WHERE sku NOT LIKE 'DIRT%')
  SELECT jsonb_build_object(
    'min_capital', p_min_capital,
    'total_skus',    (SELECT count(*) FROM clean),
    'total_capital', (SELECT COALESCE(round(sum(capital_tied)),0) FROM clean),
    'high_priority', (SELECT count(*) FROM clean WHERE priority='high'),
    'sold_90d',      (SELECT count(*) FROM clean WHERE COALESCE(units_sold_90d,0)>0),
    'dirt_excluded', (SELECT count(*) FROM u WHERE sku LIKE 'DIRT%'),
    'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',sku,'name',left(COALESCE(product_name,''),52),
        'stock',current_stock,'capital',capital_tied,'sold90',COALESCE(units_sold_90d,0)) ORDER BY capital_tied DESC)
      FROM (SELECT * FROM clean ORDER BY capital_tied DESC LIMIT 10) t), '[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.get_weekly_unlisted_digest(numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_unlisted_digest(numeric) TO authenticated, service_role;

-- The runner the email uses: totals + top10 + week-over-week progress; writes today's
-- snapshot when p_write (real send). "now_listed" = last week's flagged SKUs that now
-- have an active eBay listing (genuine work done).
CREATE OR REPLACE FUNCTION public.run_weekly_unlisted(p_min_capital numeric DEFAULT 25, p_write boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' SET statement_timeout TO '120000'
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Europe/London')::date;
  v_prev  date;
  v_result jsonb;
  v_now_listed int; v_now_listed_capital numeric; v_still_open int; v_newly int;
BEGIN
  CREATE TEMP TABLE _cur ON COMMIT DROP AS
    SELECT sku, product_name, current_stock, capital_tied, units_sold_90d, priority
    FROM public.get_ebay_unlisted_skus(p_min_capital, 5000)
    WHERE sku NOT LIKE 'DIRT%';

  SELECT max(run_date) INTO v_prev FROM weekly_unlisted_snapshot WHERE run_date < v_today;

  SELECT count(*), COALESCE(round(sum(s.capital)),0) INTO v_now_listed, v_now_listed_capital
  FROM weekly_unlisted_snapshot s
  WHERE s.run_date = v_prev
    AND EXISTS (SELECT 1 FROM listing_coverage lc WHERE lc.sku=s.sku AND lc.channel='ebay' AND lc.status='Active');

  SELECT count(*) INTO v_still_open FROM weekly_unlisted_snapshot s
  WHERE s.run_date = v_prev AND EXISTS (SELECT 1 FROM _cur c WHERE c.sku=s.sku);

  SELECT count(*) INTO v_newly FROM _cur c
  WHERE v_prev IS NOT NULL AND NOT EXISTS (SELECT 1 FROM weekly_unlisted_snapshot s WHERE s.run_date=v_prev AND s.sku=c.sku);

  v_result := jsonb_build_object(
    'min_capital', p_min_capital,
    'total_skus',    (SELECT count(*) FROM _cur),
    'total_capital', (SELECT COALESCE(round(sum(capital_tied)),0) FROM _cur),
    'high_priority', (SELECT count(*) FROM _cur WHERE priority='high'),
    'sold_90d',      (SELECT count(*) FROM _cur WHERE COALESCE(units_sold_90d,0)>0),
    'top', COALESCE((SELECT jsonb_agg(jsonb_build_object('sku',sku,'name',left(COALESCE(product_name,''),52),
        'stock',current_stock,'capital',capital_tied,'sold90',COALESCE(units_sold_90d,0)) ORDER BY capital_tied DESC)
      FROM (SELECT * FROM _cur ORDER BY capital_tied DESC LIMIT 10) t), '[]'::jsonb),
    'progress', jsonb_build_object('prev_date', v_prev, 'now_listed', COALESCE(v_now_listed,0),
      'now_listed_capital', COALESCE(v_now_listed_capital,0), 'still_open', COALESCE(v_still_open,0),
      'newly_flagged', COALESCE(v_newly,0)));

  IF p_write THEN
    DELETE FROM weekly_unlisted_snapshot WHERE run_date = v_today;
    INSERT INTO weekly_unlisted_snapshot(run_date, sku, capital) SELECT v_today, sku, capital_tied FROM _cur;
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.run_weekly_unlisted(numeric, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.run_weekly_unlisted(numeric, boolean) TO authenticated, service_role;

-- Config (recipients + run window). Edit here or in the app_settings rows.
INSERT INTO public.app_settings(key, value) VALUES
 ('weekly_unlisted.recipients', '["jon@partsdoc.co.uk","clive@partsdoc.co.uk","clivejardine@me.com"]'::jsonb),
 ('weekly_unlisted.run_hour', '9'::jsonb),
 ('weekly_unlisted.min_capital', '25'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- LIVE (jobid 111): fire hourly on Tuesdays; the function self-gates to London Tuesday >= 09:00
-- and sends once per week. Uses the anon key like the other function crons.
-- SELECT cron.schedule('weekly-unlisted-opportunities', '0 * * * 2', $cron$
--   SELECT net.http_post(
--     url := 'https://vcfbegjpkvxkqpptyxni.supabase.co/functions/v1/weekly-unlisted-opportunities-run',
--     headers := jsonb_build_object('Content-Type','application/json','apikey','<ANON_KEY>','Authorization','Bearer <ANON_KEY>'),
--     body := '{}'::jsonb, timeout_milliseconds := 120000);
-- $cron$);
