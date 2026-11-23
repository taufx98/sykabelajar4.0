-- Stage 7 positive-path acceptance for collective participant portal.
-- PostgreSQL 17.6 disposable schema restore only; all synthetic rows roll back.
-- No real accounts, participants, emails, or production rows are read or changed.

\set ON_ERROR_STOP on
BEGIN;

-- Seed a fresh synthetic Better Auth identity and its minimal app/portal fixtures
-- as the disposable database owner, then exercise the public RPCs as anon.
INSERT INTO private.app_users (id)
VALUES ('00000000-0000-4000-8000-00000000f711');

INSERT INTO public.profiles (id, full_name, account_type)
VALUES ('00000000-0000-4000-8000-00000000f711', 'Stage 7 Synthetic Teacher', 'teacher');

INSERT INTO public.teacher_rosters (id, teacher_user_id, name)
VALUES (
  '00000000-0000-4000-8000-00000000f712',
  '00000000-0000-4000-8000-00000000f711',
  'Stage 7 Synthetic Roster'
);

INSERT INTO public.roster_students (id, roster_id, full_name, metadata)
VALUES (
  '00000000-0000-4000-8000-00000000f713',
  '00000000-0000-4000-8000-00000000f712',
  'Stage 7 Synthetic Participant',
  '{"source":"stage7-disposable-acceptance"}'::jsonb
);

INSERT INTO public.competitions (
  id, slug, title, status, visibility, participant_mode, starts_at, ends_at
) VALUES (
  '00000000-0000-4000-8000-00000000f714',
  'stage7-portal-valid-token-synthetic',
  'Stage 7 Portal Valid Token Synthetic',
  'LIVE',
  'PRIVATE',
  'COLLECTIVE_TEACHER',
  clock_timestamp() - interval '1 hour',
  clock_timestamp() + interval '1 hour'
);

INSERT INTO public.collective_participants (
  id, competition_id, roster_student_id, managed_by_user_id,
  participant_code, full_name, status
) VALUES (
  '00000000-0000-4000-8000-00000000f715',
  '00000000-0000-4000-8000-00000000f714',
  '00000000-0000-4000-8000-00000000f713',
  '00000000-0000-4000-8000-00000000f711',
  'STAGE7-VALID-001',
  'Stage 7 Synthetic Participant',
  'ACTIVE'
);

INSERT INTO public.questions (
  id, competition_id, type, prompt, points, required, display_order, config, status
) VALUES
  (
    '00000000-0000-4000-8000-00000000f718',
    '00000000-0000-4000-8000-00000000f714',
    'short_answer',
    'Stage 7 synthetic question one',
    5,
    true,
    1,
    '{"accepted_answers":["first response"]}'::jsonb,
    'PUBLISHED'
  ),
  (
    '00000000-0000-4000-8000-00000000f719',
    '00000000-0000-4000-8000-00000000f714',
    'short_answer',
    'Stage 7 synthetic question two',
    5,
    true,
    2,
    '{"accepted_answers":["second response"]}'::jsonb,
    'PUBLISHED'
  );

INSERT INTO public.collective_portal_identities (
  id, roster_student_id, owner_user_id, status
) VALUES (
  '00000000-0000-4000-8000-00000000f716',
  '00000000-0000-4000-8000-00000000f713',
  '00000000-0000-4000-8000-00000000f711',
  'ACTIVE'
);

INSERT INTO public.collective_portal_credentials (
  id, portal_identity_id, password_hash, password_lookup_key,
  password_version, enabled
) VALUES (
  '00000000-0000-4000-8000-00000000f717',
  '00000000-0000-4000-8000-00000000f716',
  extensions.crypt('PortalTest#2026!', extensions.gen_salt('bf')),
  pg_catalog.encode(extensions.digest('PortalTe', 'sha256'), 'hex'),
  1,
  true
);

SET LOCAL ROLE anon;
SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','anon',true);

DO $stage7_collective_portal_valid_token$
DECLARE
  v_password constant text := 'PortalTest#2026!';
  v_competition constant uuid := '00000000-0000-4000-8000-00000000f714';
  v_participant constant uuid := '00000000-0000-4000-8000-00000000f715';
  v_result jsonb;
  v_portal_token text;
  v_access_token text;
  v_count bigint;
  v_revoked boolean;
  v_error text;
  v_attempt_id uuid;
  v_question_id uuid;
  v_state jsonb;
BEGIN
  v_result := public.verify_collective_portal_password(v_password);
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'STAGE7_VALID_PORTAL_PASSWORD_REJECTED:%',v_result;
  END IF;

  v_portal_token := v_result->>'portal_token';
  IF v_portal_token IS NULL OR length(v_portal_token) <> 64 THEN
    RAISE EXCEPTION 'STAGE7_VALID_PORTAL_TOKEN_NOT_256_BIT_HEX';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_collective_portal_competitions(v_portal_token) AS listed
  WHERE listed.competition_id = v_competition
    AND listed.participant_id = v_participant
    AND listed.participant_code = 'STAGE7-VALID-001';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VALID_PORTAL_TOKEN_CANNOT_LIST_OWN_PRIVATE_COMPETITION:%',v_count;
  END IF;

  v_result := public.open_collective_competition_session(
    v_portal_token,
    v_competition,
    'STAGE7-NOT-OWNED'
  );
  IF coalesce((v_result->>'ok')::boolean,false) IS TRUE
     OR v_result->>'reason' IS DISTINCT FROM 'INVALID_PARTICIPANT_CODE' THEN
    RAISE EXCEPTION 'STAGE7_PORTAL_TOKEN_OPENED_UNRELATED_PARTICIPANT:%',v_result;
  END IF;

  v_result := public.open_collective_competition_session(
    v_portal_token,
    v_competition,
    'STAGE7-VALID-001'
  );
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'participant_id' IS DISTINCT FROM v_participant::text
     OR v_result->>'competition_id' IS DISTINCT FROM v_competition::text THEN
    RAISE EXCEPTION 'STAGE7_VALID_PORTAL_TOKEN_CANNOT_OPEN_OWN_COMPETITION:%',v_result;
  END IF;

  v_access_token := v_result->>'access_token';
  IF v_access_token IS NULL OR length(v_access_token) <> 64 THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_NOT_256_BIT_HEX';
  END IF;

  v_result := public.start_collective_linear_exam_attempt(v_competition, v_access_token);
  IF v_result->>'phase' IS DISTINCT FROM 'ACTIVE'
     OR (v_result->>'position')::integer IS DISTINCT FROM 1
     OR (v_result->>'total_questions')::integer IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_COULD_NOT_START_LINEAR_EXAM:%',v_result;
  END IF;

  v_attempt_id := (v_result->>'attempt_id')::uuid;
  v_question_id := (v_result->'question'->>'id')::uuid;
  IF v_attempt_id IS NULL OR v_question_id IS NULL
     OR v_result ? 'answer_key_snapshot'
     OR v_result::text ILIKE '%accepted_answers%'
     OR v_result::text ILIKE '%correct_option_ids%' THEN
    RAISE EXCEPTION 'STAGE7_LINEAR_EXAM_STATE_LEAKED_ANSWER_KEY:%',v_result;
  END IF;

  v_state := public.save_collective_linear_exam_draft(
    v_attempt_id, v_access_token, v_question_id, '{"text":"draft response"}'::jsonb
  );
  IF v_state->'answer'->>'text' IS DISTINCT FROM 'draft response' THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_DRAFT_AUTOSAVE_FAILED:%',v_state;
  END IF;

  v_state := public.answer_collective_linear_exam_question(
    v_attempt_id, v_access_token, v_question_id, '{"text":"first response"}'::jsonb, false
  );
  IF v_state->>'phase' IS DISTINCT FROM 'ACTIVE'
     OR (v_state->>'position')::integer IS DISTINCT FROM 2
     OR (v_state->>'answered_count')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_LINEAR_ANSWER_ADVANCE_FAILED:%',v_state;
  END IF;

  v_state := public.skip_collective_linear_exam_question(v_attempt_id, v_access_token);
  IF v_state->>'phase' IS DISTINCT FROM 'COMPLETED'
     OR (v_state->>'answered_count')::integer IS DISTINCT FROM 1
     OR (v_state->>'skipped_count')::integer IS DISTINCT FROM 1
     OR v_state ? 'score' THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_LINEAR_SKIP_COMPLETION_FAILED:%',v_state;
  END IF;

  v_state := public.get_collective_linear_exam_state(v_attempt_id, v_access_token);
  IF v_state->>'phase' IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_COMPLETED_STATE_UNAVAILABLE:%',v_state;
  END IF;

  v_revoked := public.revoke_collective_access_session(v_access_token);
  IF v_revoked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_COULD_NOT_BE_REVOKED';
  END IF;

  v_revoked := public.revoke_collective_portal_session(v_portal_token);
  IF v_revoked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE7_VALID_PORTAL_TOKEN_COULD_NOT_BE_REVOKED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_collective_portal_competitions(v_portal_token);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_REVOKED_PORTAL_TOKEN_STILL_LISTS_COMPETITIONS:%',v_count;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_participant_result(v_access_token);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_REVOKED_ACCESS_TOKEN_NOT_REJECTED:%',coalesce(v_error,'<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt_id, v_access_token);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_REVOKED_ACCESS_TOKEN_LINEAR_EXAM_NOT_DENIED:%',coalesce(v_error,'<no error>');
  END IF;
END;
$stage7_collective_portal_valid_token$;

RESET ROLE;
ROLLBACK;
