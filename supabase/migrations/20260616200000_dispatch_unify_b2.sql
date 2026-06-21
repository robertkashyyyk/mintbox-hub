-- Track B2 — one number everywhere + optimise. Put the dispatch consumers on the
-- canonical (label-printed) clock by reading the precomputed dispatch_performance_daily
-- table instead of live-scanning v_despatch_events / order_status_history.
-- Dispatch history starts 2026-06-15 (ratified accurate start); earlier dates return
-- nothing (the pre-15-Jun backstop was undercounting and is intentionally dropped).

-- ── Optimise get_despatch_performance: read the precomputed daily table ──
-- Was: live pairing of v_despatch_events × order_lines (timed out on wide ranges).
CREATE OR REPLACE FUNCTION public.get_despatch_performance(from_date date, to_date date)
RETURNS TABLE(within_24h bigint, within_48h bigint, within_72h bigint, total_despatched bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(sum(within_24h),0)::bigint,
         COALESCE(sum(within_48h),0)::bigint,
         COALESCE(sum(within_72h),0)::bigint,
         COALESCE(sum(total_despatched),0)::bigint
  FROM public.dispatch_performance_daily
  WHERE uk_date >= from_date AND uk_date <= to_date;
$function$;

-- ── Repoint check_despatch_sla_breach (b) to the canonical clock ──
-- Only the rolling 7-day <72h rate source changes (order_status_history →
-- dispatch_performance_daily). All thresholds, drift logic (a) — which already uses
-- the canonical get_queue_health_daily — and task creation are unchanged.
CREATE OR REPLACE FUNCTION public.check_despatch_sla_breach()
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

  -- (b) Rolling 7-day <72h rate — canonical clock via dispatch_performance_daily
  SELECT COALESCE(sum(total_despatched),0)::int,
         round(100.0 * sum(within_72h) / NULLIF(sum(total_despatched),0), 1)
  INTO v_total, v_rate
  FROM public.dispatch_performance_daily
  WHERE uk_date >= (now() AT TIME ZONE 'Europe/London')::date - 7;

  IF v_total >= 50 AND v_rate IS NOT NULL AND v_rate < 95 THEN
    v_breach := true;
    v_msg := v_msg || format('7-day <72h despatch rate is %s%% (target 95%%, %s orders). ', v_rate, v_total);
  END IF;

  -- (a) Cumulative drift rising 3 days (get_queue_health_daily already canonical)
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
