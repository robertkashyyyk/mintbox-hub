-- War Room permissions + the locked-down targets save path.
-- Applied live via MCP apply_migration 2026-07-02; kept here for version control.

-- Grant the War Room area to the dedicated role at admin capability.
INSERT INTO public.role_area_permissions (role, area_key, capability)
VALUES ('war_room', 'strategy.war_room', 'admin')
ON CONFLICT DO NOTHING;

-- Assign the war_room role to the two leaders (both of each person's accounts), by email.
INSERT INTO public.user_rbac_roles (user_id, role, is_active)
SELECT id, 'war_room'::public.rbac_role, true
FROM auth.users
WHERE email IN ('clivejardine@me.com','clive@partsdoc.co.uk','robert@kashyyyk.co.uk','robertzrickey@gmail.com')
ON CONFLICT DO NOTHING;

-- Save path for the War Room: the ONLY way to change targets from the app.
-- Server-side lock (independent of the dormant global RBAC flag): only holders of the
-- 'strategy.war_room' admin capability may run it. Edits ONLY the goals subtree, keeps the
-- seasonality weights intact, regenerates this year's daily cells, and writes an audit trail.
CREATE OR REPLACE FUNCTION public.set_target_goals(p_goals jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_model jsonb;
  v_old   jsonb;
  v_year  int  := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/London'))::int;
  v_p numeric := (p_goals->'primary'->>'annual')::numeric;
  v_s numeric := (p_goals->'stretch'->>'annual')::numeric;
  v_u numeric := (p_goals->'ultimate'->>'annual')::numeric;
BEGIN
  IF NOT public.has_area_capability('strategy.war_room', 'admin', v_uid) THEN
    RAISE EXCEPTION 'not authorised to change targets';
  END IF;

  IF p_goals IS NULL OR NOT (p_goals ? 'primary' AND p_goals ? 'stretch' AND p_goals ? 'ultimate') THEN
    RAISE EXCEPTION 'goals must include primary, stretch and ultimate';
  END IF;
  IF v_p <= 0 OR v_s < v_p OR v_u < v_s THEN
    RAISE EXCEPTION 'annual goals must be positive and primary <= stretch <= ultimate';
  END IF;
  IF (p_goals->'primary'->>'margin')::numeric  NOT BETWEEN 0 AND 1
  OR (p_goals->'stretch'->>'margin')::numeric  NOT BETWEEN 0 AND 1
  OR (p_goals->'ultimate'->>'margin')::numeric NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'margins must be between 0 and 1';
  END IF;

  SELECT value INTO v_model FROM public.app_settings WHERE key = 'scorecard.target_model' FOR UPDATE;
  IF v_model IS NULL THEN RAISE EXCEPTION 'scorecard.target_model not set'; END IF;
  v_old := v_model->'goals';

  v_model := jsonb_set(v_model, '{goals}', jsonb_build_object(
    'primary',  jsonb_build_object('annual', v_p, 'margin', (p_goals->'primary'->>'margin')::numeric),
    'stretch',  jsonb_build_object('annual', v_s, 'margin', (p_goals->'stretch'->>'margin')::numeric),
    'ultimate', jsonb_build_object('annual', v_u, 'margin', (p_goals->'ultimate'->>'margin')::numeric)
  ));

  UPDATE public.app_settings SET value = v_model WHERE key = 'scorecard.target_model';
  PERFORM public.regenerate_scorecard_targets(v_year);

  INSERT INTO public.audit_log (actor_user_id, actor_display_name, action_type, entity_type, entity_label, old_value, new_value)
  VALUES (v_uid, public.audit_actor_display_name(), 'targets.goals_changed', 'scorecard.target_model', 'War Room targets', v_old, v_model->'goals');

  RETURN v_model->'goals';
END;
$$;
REVOKE ALL ON FUNCTION public.set_target_goals(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_target_goals(jsonb) TO authenticated;
