-- Read-only Stage 5 database contract checks. Safe to run against production.
DO $$
DECLARE
  v_function regprocedure := 'public.list_teacher_achievement_report(uuid,text)'::regprocedure;
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(v_function) INTO v_definition;

  IF v_definition NOT ILIKE '%SECURITY DEFINER%' THEN
    RAISE EXCEPTION 'Stage 5 report must be SECURITY DEFINER';
  END IF;
  IF v_definition NOT ILIKE '%SET search_path TO %' THEN
    RAISE EXCEPTION 'Stage 5 report must pin search_path';
  END IF;
  IF v_definition NOT ILIKE '%managed_by_user_id%' OR v_definition NOT ILIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'Stage 5 report is missing teacher ownership scoping';
  END IF;
  IF v_definition NOT ILIKE '%canonical_participant_id%' OR v_definition NOT ILIKE '%is_preview = false%' THEN
    RAISE EXCEPTION 'Stage 5 report must use canonical, non-preview attempts';
  END IF;
  IF v_definition NOT ILIKE '%RESULT_PUBLISHED%' OR v_definition NOT ILIKE '%canonical_competition_rank%' THEN
    RAISE EXCEPTION 'Stage 5 report must gate official score and rank on publication';
  END IF;
  IF NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated role must execute the Stage 5 report RPC';
  END IF;
  IF has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous role must not execute the Stage 5 report RPC';
  END IF;
END;
$$;
