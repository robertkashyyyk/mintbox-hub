-- War Room: locked save path for the seasonality weights (day-of-week + month).
-- Twin of set_target_goals — same capability lock, audit trail, and target regeneration,
-- but edits ONLY the dow_weight / month_share subtrees. Display/target-only: it reshapes how
-- the annual goal is distributed across the year (the "pace vs target" line), and never touches
-- the buy engine. Inputs are auto-normalised to sum 1.0 so raw figures can be pasted in.
--
-- Ordering (must match regenerate_scorecard_targets): dow_weight[0]=Mon..[6]=Sun (ISODOW-1),
-- month_share[0]=Jan..[11]=Dec. dow_weight is renormalised per-month by the regenerator, so its
-- shape is what matters; month_share must sum to 1.0 for the year to reconcile to the annual goal.

CREATE OR REPLACE FUNCTION public.set_target_seasonality(p_dow jsonb, p_months jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_model  jsonb;
  v_old    jsonb;
  v_year   int  := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/London'))::int;
  v_dow    numeric[];
  v_mon    numeric[];
  v_dsum   numeric;
  v_msum   numeric;
  v_dow_n  jsonb;
  v_mon_n  jsonb;
BEGIN
  IF NOT public.has_area_capability('strategy.war_room', 'admin', v_uid) THEN
    RAISE EXCEPTION 'not authorised to change seasonality weights';
  END IF;

  IF p_dow IS NULL OR jsonb_typeof(p_dow) <> 'array' OR jsonb_array_length(p_dow) <> 7 THEN
    RAISE EXCEPTION 'dow weights must be an array of 7 values (Mon..Sun)';
  END IF;
  IF p_months IS NULL OR jsonb_typeof(p_months) <> 'array' OR jsonb_array_length(p_months) <> 12 THEN
    RAISE EXCEPTION 'month weights must be an array of 12 values (Jan..Dec)';
  END IF;

  -- Parse to numeric arrays (throws on non-numeric), preserving order.
  SELECT array_agg(e::numeric ORDER BY ord) INTO v_dow
  FROM jsonb_array_elements_text(p_dow)    WITH ORDINALITY AS t(e, ord);
  SELECT array_agg(e::numeric ORDER BY ord) INTO v_mon
  FROM jsonb_array_elements_text(p_months) WITH ORDINALITY AS t(e, ord);

  IF (SELECT bool_or(x < 0) FROM unnest(v_dow) x)
  OR (SELECT bool_or(x < 0) FROM unnest(v_mon) x) THEN
    RAISE EXCEPTION 'weights must be non-negative';
  END IF;

  v_dsum := (SELECT sum(x) FROM unnest(v_dow) x);
  v_msum := (SELECT sum(x) FROM unnest(v_mon) x);
  IF v_dsum <= 0 OR v_msum <= 0 THEN
    RAISE EXCEPTION 'each weight set must total greater than zero';
  END IF;

  -- Auto-normalise each set to sum 1.0 (4 dp).
  SELECT jsonb_agg(round(x / v_dsum, 4) ORDER BY ord) INTO v_dow_n
  FROM unnest(v_dow) WITH ORDINALITY AS t(x, ord);
  SELECT jsonb_agg(round(x / v_msum, 4) ORDER BY ord) INTO v_mon_n
  FROM unnest(v_mon) WITH ORDINALITY AS t(x, ord);

  SELECT value INTO v_model FROM public.app_settings WHERE key = 'scorecard.target_model' FOR UPDATE;
  IF v_model IS NULL THEN RAISE EXCEPTION 'scorecard.target_model not set'; END IF;
  v_old := jsonb_build_object('dow_weight', v_model->'dow_weight', 'month_share', v_model->'month_share');

  v_model := jsonb_set(v_model, '{dow_weight}',  v_dow_n);
  v_model := jsonb_set(v_model, '{month_share}', v_mon_n);

  UPDATE public.app_settings SET value = v_model WHERE key = 'scorecard.target_model';
  PERFORM public.regenerate_scorecard_targets(v_year);

  INSERT INTO public.audit_log (actor_user_id, actor_display_name, action_type, entity_type, entity_label, old_value, new_value)
  VALUES (v_uid, public.audit_actor_display_name(), 'targets.seasonality_changed', 'scorecard.target_model',
          'War Room seasonality weights', v_old,
          jsonb_build_object('dow_weight', v_dow_n, 'month_share', v_mon_n));

  RETURN jsonb_build_object('dow_weight', v_dow_n, 'month_share', v_mon_n);
END;
$$;

REVOKE ALL ON FUNCTION public.set_target_seasonality(jsonb, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_target_seasonality(jsonb, jsonb) TO authenticated;
