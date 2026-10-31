-- Stage 5 teacher achievement report regression checks.
-- Read-only: this file verifies the secure report RPC contract without
-- creating fake teacher, roster, student, participant, attempt, or award rows.
DO $stage5$
DECLARE
  v_definition text;
  v_rls_enabled boolean;
BEGIN
  IF to_regprocedure('public.get_teacher_achievement_report(integer,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'Stage 5 teacher achievement report RPC is missing';
  END IF;

  SELECT pg_get_functiondef(
    'public.get_teacher_achievement_report(integer,integer,text)'::regprocedure
  ) INTO v_definition;

  IF position('SECURITY DEFINER' IN v_definition) = 0
     OR position('SET search_path TO ' || chr(39) || chr(39) IN v_definition) = 0
     OR position('auth.uid()' IN v_definition) = 0
     OR position('role::text = ''teacher''' IN v_definition) = 0
     OR position('tr.teacher_user_id = v_uid' IN v_definition) = 0
     OR position('cp.managed_by_user_id = v_uid' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Teacher report is missing authenticated identity or teacher ownership guards';
  END IF;

  IF position('a.status::text = ''FINALIZED''' IN v_definition) = 0
     OR position('a.is_preview = false' IN v_definition) = 0
     OR position('DISTINCT ON (a.canonical_participant_id)' IN v_definition) = 0
     OR position('RESULT_PUBLISHED' IN v_definition) = 0
     OR position('ARCHIVED' IN v_definition) = 0
     OR position('rank() OVER (PARTITION BY lf.competition_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Teacher report does not follow the official canonical result/ranking contract';
  END IF;

  IF position('pc.status = ''PUBLISHED''' IN v_definition) = 0
     OR position('a.visibility = ''PUBLIC''' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Teacher report must only expose published certificates and public awards';
  END IF;

  IF has_function_privilege('anon', 'public.get_teacher_achievement_report(integer,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_teacher_achievement_report(integer,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Teacher report RPC must be executable by authenticated users only';
  END IF;

  SELECT c.relrowsecurity INTO v_rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'teacher_rosters';

  IF coalesce(v_rls_enabled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Existing teacher_rosters RLS must remain enabled';
  END IF;
END;
$stage5$;
