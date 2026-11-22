-- DRAFT TEST ONLY — run against the PostgreSQL 17.6 disposable schema restore.
-- This verifies the intentionally anonymous collective participant portal remains
-- token/password-bound. It never creates a valid credential/session or reads a
-- participant's business rows. The entire test runs under role anon and rolls back.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','anon',true);

DO $stage7_collective_portal_token_boundary$
DECLARE
  v_signature text;
  v_token constant text := 'stage7-invalid-portal-token-8fb7c1a1cce147f3';
  v_password constant text := '0d4e00d7f1c34a4f91d9d9fd6e49cc6b-never-provisioned';
  v_result jsonb;
  v_bool boolean;
  v_count bigint;
  v_error text;
  v_attempt constant uuid := '00000000-0000-4000-8000-00000000f701';
  v_question constant uuid := '00000000-0000-4000-8000-00000000f702';
  v_checked integer := 0;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.answer_collective_linear_exam_question(uuid,text,uuid,jsonb,boolean)',
    'public.choose_collective_linear_exam_timeout(uuid,text,text)',
    'public.get_collective_linear_exam_state(uuid,text)',
    'public.get_collective_participant_certificate(text)',
    'public.get_collective_participant_result(text)',
    'public.list_collective_portal_competitions(text)',
    'public.open_collective_competition_session(text,uuid,text)',
    'public.resolve_collective_linear_exam_timeout(uuid,text)',
    'public.revoke_collective_access_session(text)',
    'public.revoke_collective_portal_session(text)',
    'public.save_collective_linear_exam_draft(uuid,text,uuid,jsonb)',
    'public.skip_collective_linear_exam_question(uuid,text)',
    'public.start_collective_linear_exam_attempt(uuid,text)',
    'public.verify_collective_portal_password(text)'
  ] LOOP
    IF NOT pg_catalog.has_function_privilege('anon',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'STAGE7_PORTAL_ANON_RPC_GRANT_MISSING:%',v_signature;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;
  IF v_checked <> 14 THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_RPC_SCOPE_MISMATCH:%',v_checked;
  END IF;

  v_result := public.verify_collective_portal_password(v_password);
  IF coalesce((v_result->>'ok')::boolean,true)
     OR v_result->>'reason' IS DISTINCT FROM 'INVALID_CREDENTIALS' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_PASSWORD_ACCEPTED:%',v_result;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_collective_portal_competitions(v_token);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_LISTED_COMPETITIONS:%',v_count;
  END IF;

  v_result := public.open_collective_competition_session(
    v_token,'00000000-0000-4000-8000-00000000f703'::uuid,'STAGE7-NO-PARTICIPANT'
  );
  IF coalesce((v_result->>'ok')::boolean,true)
     OR v_result->>'reason' IS DISTINCT FROM 'PORTAL_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_SESSION_OPENED:%',v_result;
  END IF;

  SELECT public.get_collective_participant_certificate(v_token) INTO v_result;
  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_RETURNED_CERTIFICATE:%',v_result;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_participant_result(v_token);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_RESULT_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_bool := public.revoke_collective_portal_session(v_token);
  IF coalesce(v_bool,false) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_REVOKED_EXISTING_SESSION';
  END IF;

  v_bool := public.revoke_collective_access_session(v_token);
  IF coalesce(v_bool,false) THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_ACCESS_TOKEN_REVOKED_EXISTING_SESSION';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.start_collective_linear_exam_attempt(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_START_EXAM_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.answer_collective_linear_exam_question(v_attempt,v_token,v_question,'{"value":"x"}'::jsonb,false);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_ANSWER_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.choose_collective_linear_exam_timeout(v_attempt,v_token,'CONTINUE');
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_CHOOSE_TIMEOUT_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_GET_STATE_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.resolve_collective_linear_exam_timeout(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_RESOLVE_TIMEOUT_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_collective_linear_exam_draft(v_attempt,v_token,v_question,'{"value":"x"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_SAVE_DRAFT_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.skip_collective_linear_exam_question(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_INVALID_TOKEN_SKIP_QUESTION_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;
END;
$stage7_collective_portal_token_boundary$;

RESET ROLE;
ROLLBACK;
