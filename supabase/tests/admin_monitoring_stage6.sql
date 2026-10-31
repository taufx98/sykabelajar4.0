-- Read-only contract for Stage 6 admin monitoring.
DO $$
DECLARE
  v_dashboard regprocedure := to_regprocedure('public.admin_get_monitoring_dashboard(uuid,text,text,integer,integer)');
  v_investigation regprocedure := to_regprocedure('public.admin_get_attempt_investigation(uuid)');
  v_dashboard_def text;
  v_investigation_def text;
BEGIN
  IF v_dashboard IS NULL OR v_investigation IS NULL THEN
    RAISE EXCEPTION 'STAGE6_MONITORING_RPC_MISSING';
  END IF;

  SELECT pg_get_functiondef(v_dashboard) INTO v_dashboard_def;
  SELECT pg_get_functiondef(v_investigation) INTO v_investigation_def;

  IF NOT has_function_privilege('authenticated', v_dashboard, 'EXECUTE')
     OR has_function_privilege('anon', v_dashboard, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE6_DASHBOARD_GRANTS_INVALID';
  END IF;

  IF NOT has_function_privilege('authenticated', v_investigation, 'EXECUTE')
     OR has_function_privilege('anon', v_investigation, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE6_INVESTIGATION_GRANTS_INVALID';
  END IF;

  IF position('current_user_is_admin' IN v_dashboard_def) = 0
     OR position('current_user_is_admin' IN v_investigation_def) = 0 THEN
    RAISE EXCEPTION 'STAGE6_ADMIN_GUARD_MISSING';
  END IF;

  IF position('is_preview' IN v_dashboard_def) = 0
     OR position('is_preview' IN v_investigation_def) = 0 THEN
    RAISE EXCEPTION 'STAGE6_PREVIEW_EXCLUSION_MISSING';
  END IF;

  IF has_table_privilege('authenticated', 'public.exam_attempt_events', 'SELECT') THEN
    RAISE EXCEPTION 'STAGE6_EVENT_TABLE_MUST_NOT_BE_DIRECTLY_READABLE';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_audit_attempt_result_snapshot'
      AND tgrelid = 'public.attempts'::regclass
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'STAGE6_RESULT_AUDIT_TRIGGER_MISSING';
  END IF;
END;
$$;
