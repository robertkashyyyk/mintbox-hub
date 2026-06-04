-- Fix eBay scheduled-task functions (wrong column names) + add despatch
-- SLA breach detection. The tasks table uses: task_type, priority_level,
-- source_module, source_rule, due_date, created_by (NOT NULL), tags.
-- Steven: 1cdd089a-87ef-4d79-8617-f7e58c210c92

-- ── Fix: eBay response time reminder ─────────────────────────────
CREATE OR REPLACE FUNCTION create_ebay_response_time_task()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tasks (created_by, assigned_to, task_type, title, description,
                     priority_level, due_date, source_module, source_rule, tags)
  VALUES (
    '1cdd089a-87ef-4d79-8617-f7e58c210c92',
    '1cdd089a-87ef-4d79-8617-f7e58c210c92',
    'system_generated',
    'Log eBay response times',
    'Enter today''s 7/14/30-day open message counts from 3D Sellers into Operations → eBay Performance → Response Times.',
    2,
    (now() AT TIME ZONE 'Europe/London')::date + time '15:00',
    'ebay_performance', 'scheduled_response_times',
    ARRAY['ebay','scheduled']
  );
END;
$$;

-- ── Fix: eBay ODR reminder ───────────────────────────────────────
CREATE OR REPLACE FUNCTION create_ebay_odr_task()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tasks (created_by, assigned_to, task_type, title, description,
                     priority_level, due_date, source_module, source_rule, tags)
  VALUES (
    '1cdd089a-87ef-4d79-8617-f7e58c210c92',
    '1cdd089a-87ef-4d79-8617-f7e58c210c92',
    'system_generated',
    'Enter weekly eBay ODR data',
    'Copy this week''s ODR metrics from eBay Seller Hub (C O/S, CCWSR, LDR for all 5 accounts) into Operations → eBay Performance → ODR.',
    2,
    (now() AT TIME ZONE 'Europe/London')::date + time '10:00',
    'ebay_performance', 'scheduled_odr',
    ARRAY['ebay','scheduled']
  );
END;
$$;

-- ── New: despatch SLA breach detection (daily) ───────────────────
-- Raises ONE task per day if either:
--   (a) cumulative drift positive AND rising 3 days running, or
--   (b) rolling 7-day <72h despatch rate < 95%.
-- De-duped: skips if an open breach task already exists today.
CREATE OR REPLACE FUNCTION check_despatch_sla_breach()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_rate numeric;
  v_total integer;
  v_drift_today bigint;
  v_drift_3ago bigint;
  v_msg text := '';
  v_breach boolean := false;
BEGIN
  -- Skip if a breach task already exists today (open)
  IF EXISTS (
    SELECT 1 FROM tasks
    WHERE source_rule = 'despatch_sla_breach'
      AND status IN ('todo','in_progress')
      AND created_at::date = (now() AT TIME ZONE 'Europe/London')::date
  ) THEN
    RETURN;
  END IF;

  -- (b) Rolling 7-day <72h rate
  SELECT
    count(*)::int,
    round(100.0 * count(*) FILTER (WHERE hours <= 72) / NULLIF(count(*),0), 1)
  INTO v_total, v_rate
  FROM (
    SELECT DISTINCT ON (h.mintsoft_order_id)
      EXTRACT(EPOCH FROM (h.changed_at - ol.order_date))/3600.0 AS hours
    FROM order_status_history h
    JOIN order_lines ol ON ol.mintsoft_order_id = h.mintsoft_order_id
    WHERE h.to_status = 'DESPATCHED'
      AND ol.order_date IS NOT NULL
      AND (h.changed_at AT TIME ZONE 'Europe/London')::date
            >= (now() AT TIME ZONE 'Europe/London')::date - 7
    ORDER BY h.mintsoft_order_id, h.changed_at ASC
  ) d;

  IF v_total >= 50 AND v_rate IS NOT NULL AND v_rate < 95 THEN
    v_breach := true;
    v_msg := v_msg || format('7-day <72h despatch rate is %s%% (target 95%%, %s orders). ', v_rate, v_total);
  END IF;

  -- (a) Cumulative drift rising 3 days
  SELECT drift_cumulative INTO v_drift_today
  FROM get_queue_health_daily((now() AT TIME ZONE 'Europe/London')::date - 7,
                              (now() AT TIME ZONE 'Europe/London')::date)
  ORDER BY day DESC LIMIT 1;

  SELECT drift_cumulative INTO v_drift_3ago
  FROM get_queue_health_daily((now() AT TIME ZONE 'Europe/London')::date - 7,
                              (now() AT TIME ZONE 'Europe/London')::date)
  ORDER BY day DESC OFFSET 3 LIMIT 1;

  IF v_drift_today IS NOT NULL AND v_drift_3ago IS NOT NULL
     AND v_drift_today > 100 AND v_drift_today > v_drift_3ago THEN
    v_breach := true;
    v_msg := v_msg || format('Backlog drift is growing (cumulative +%s, up from +%s 3 days ago). ', v_drift_today, v_drift_3ago);
  END IF;

  IF v_breach THEN
    INSERT INTO tasks (created_by, assigned_to, task_type, title, description,
                       priority_level, user_urgency_flag, due_date,
                       source_module, source_rule, tags)
    VALUES (
      '1cdd089a-87ef-4d79-8617-f7e58c210c92',
      '1cdd089a-87ef-4d79-8617-f7e58c210c92',
      'system_generated',
      'Despatch SLA breach — review backlog',
      v_msg || E'\n\nReview Operations → Despatch KPIs (Queue Health + Late SKUs) and act on the worst stock-outs.',
      1, true,
      (now() AT TIME ZONE 'Europe/London')::date + time '12:00',
      'despatch_kpis', 'despatch_sla_breach',
      ARRAY['despatch','sla','breach']
    );
  END IF;
END;
$$;

-- Schedule the daily check at 07:00 UTC (after AM snapshot at 06:30)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('despatch-sla-breach-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='despatch-sla-breach-check');
    PERFORM cron.schedule('despatch-sla-breach-check', '0 7 * * *', 'SELECT check_despatch_sla_breach()');
  END IF;
END;
$$;
