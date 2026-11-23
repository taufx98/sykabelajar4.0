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

-- The question entitlement guard requires a real synthetic organizer,
-- question bank and issuer-valid Admin context. Do not bypass the production trigger.
INSERT INTO public.user_roles (user_id,role,is_active)
VALUES ('00000000-0000-4000-8000-00000000f711','admin'::public.app_role,true);

SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f711","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true
);
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000f711',true);

INSERT INTO public.organizers (id,name,slug,owner_user_id,status)
VALUES (
  '00000000-0000-4000-8000-00000000f71a',
  'Stage 7 Synthetic Organizer',
  'stage7-portal-valid-token-synthetic',
  '00000000-0000-4000-8000-00000000f711',
  'ACTIVE'
);

INSERT INTO public.question_banks (id,organizer_id,owner_user_id,name,status)
VALUES (
  '00000000-0000-4000-8000-00000000f71b',
  '00000000-0000-4000-8000-00000000f71a',
  '00000000-0000-4000-8000-00000000f711',
  'Stage 7 Synthetic Question Bank',
  'PUBLISHED'
);

INSERT INTO public.questions (
  id, question_bank_id, competition_id, type, prompt, points, required, display_order, config, status
) VALUES
  (
    '00000000-0000-4000-8000-00000000f718',
    '00000000-0000-4000-8000-00000000f71b',
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
    '00000000-0000-4000-8000-00000000f71b',
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
  v_portal_token_lifecycle text;
  v_access_token_lifecycle text;
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

  -- Valid active child token may request reconciliation without changing a live question.
  v_state := public.resolve_collective_linear_exam_timeout(v_attempt_id,v_access_token);
  IF v_state->>'phase' IS DISTINCT FROM 'ACTIVE'
     OR (v_state->>'position')::integer IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'STAGE7_VALID_ACCESS_TOKEN_COULD_NOT_RESOLVE_ACTIVE_TIMEOUT:%',v_state;
  END IF;
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

  -- Create a second child access token for parent lifecycle tests. Reusing the
  -- completed attempt is safe: the same active participant owns it.
  v_result := public.verify_collective_portal_password(v_password);
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'STAGE7_SECOND_VALID_PORTAL_LOGIN_FAILED:%',v_result;
  END IF;
  v_portal_token_lifecycle := v_result->>'portal_token';

  v_result := public.open_collective_competition_session(
    v_portal_token_lifecycle,v_competition,'STAGE7-VALID-001'
  );
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'STAGE7_SECOND_VALID_CHILD_SESSION_FAILED:%',v_result;
  END IF;
  v_access_token_lifecycle := v_result->>'access_token';

  -- Revoke only this child; the portal parent must remain active and reusable.
  v_revoked := public.revoke_collective_access_session(v_access_token_lifecycle);
  IF v_revoked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE7_VALID_CHILD_ACCESS_TOKEN_COULD_NOT_BE_REVOKED';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.list_collective_portal_competitions(v_portal_token_lifecycle)
  WHERE competition_id=v_competition;
  IF v_count<>1 THEN
    RAISE EXCEPTION 'STAGE7_CHILD_REVOKE_INVALIDATED_PARENT_PORTAL_SESSION:%',v_count;
  END IF;
  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt_id,v_access_token_lifecycle);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_REVOKED_CHILD_ACCESS_TOKEN_STILL_VALID:%',coalesce(v_error,'<no error>');
  END IF;

  -- Issue a replacement child under the still-valid parent for separate parent
  -- revocation, credential rotation, identity suspension and expiry checks.
  v_result := public.open_collective_competition_session(
    v_portal_token_lifecycle,v_competition,'STAGE7-VALID-001'
  );
  IF coalesce((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'STAGE7_VALID_PARENT_COULD_NOT_REISSUE_CHILD_AFTER_CHILD_REVOKE:%',v_result;
  END IF;
  v_access_token_lifecycle := v_result->>'access_token';

  PERFORM pg_catalog.set_config('stage7.portal_token_parent',v_portal_token,true);
  PERFORM pg_catalog.set_config('stage7.access_token_parent',v_access_token,true);
  PERFORM pg_catalog.set_config('stage7.portal_token_lifecycle',v_portal_token_lifecycle,true);
  PERFORM pg_catalog.set_config('stage7.access_token_lifecycle',v_access_token_lifecycle,true);
  PERFORM pg_catalog.set_config('stage7.attempt_id',v_attempt_id::text,true);

  -- Parent revocation must cascade to the child access session without needing
  -- a separate call to revoke_collective_access_session().
  v_revoked := public.revoke_collective_portal_session(v_portal_token);
  IF v_revoked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE7_VALID_PORTAL_TOKEN_COULD_NOT_BE_REVOKED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_collective_portal_competitions(v_portal_token);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_REVOKED_PORTAL_TOKEN_STILL_LISTS_COMPETITIONS:%',v_count;
  END IF;

  v_state := public.get_collective_participant_certificate(v_access_token);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE7_REVOKED_ACCESS_TOKEN_CERTIFICATE_STILL_AVAILABLE:%',v_state;
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

-- Inspect the disposable fixture as owner and prove parent revocation marked
-- its child, while the newly opened child never outlives its parent session.
RESET ROLE;
INSERT INTO public.collective_certificates (
  id,collective_participant_id,competition_id,status,serial_number,verification_code
) VALUES (
  '00000000-0000-4000-8000-00000000f71c',
  '00000000-0000-4000-8000-00000000f715',
  '00000000-0000-4000-8000-00000000f714',
  'ELIGIBLE','STAGE7-CERT-SERIAL-001','STAGE7-CERT-VERIFY-001'
);

SET LOCAL ROLE anon;
DO $stage7_portal_unpublished_result_and_certificate$
DECLARE
  v_token text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_attempt uuid := pg_catalog.current_setting('stage7.attempt_id',true)::uuid;
  v_state jsonb;
BEGIN
  v_state := public.get_collective_participant_certificate(v_token);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_EXPOSED_BEFORE_PUBLICATION:%',v_state;
  END IF;

  v_state := public.get_collective_participant_result(v_token);
  IF coalesce((v_state->>'has_result')::boolean,false) IS NOT TRUE
     OR coalesce((v_state->>'published')::boolean,true) IS NOT FALSE
     OR v_state ? 'score' OR v_state ? 'rank' OR v_state ? 'attempt_id' THEN
    RAISE EXCEPTION 'STAGE7_RESULT_SCORE_LEAKED_BEFORE_PUBLICATION:%',v_state;
  END IF;

  v_state := public.get_collective_linear_exam_state(v_attempt,v_token);
  IF v_state->>'phase' IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'STAGE7_VALID_TOKEN_CANNOT_READ_COMPLETED_EXAM_STATE:%',v_state;
  END IF;

  v_state := public.choose_collective_linear_exam_timeout(v_attempt,v_token,'CONTINUE');
  IF v_state->>'phase' IS DISTINCT FROM 'COMPLETED' THEN
    RAISE EXCEPTION 'STAGE7_VALID_TOKEN_TIMEOUT_DECISION_CHANGED_COMPLETED_ATTEMPT:%',v_state;
  END IF;
END;
$stage7_portal_unpublished_result_and_certificate$;

RESET ROLE;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000f711","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true
);
SELECT pg_catalog.set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000f711',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','authenticated',true);

UPDATE public.collective_certificates
SET status='PUBLISHED',issued_at=pg_catalog.clock_timestamp(),
    certificate_url='https://res.cloudinary.com/demo/image/upload/stage7-synthetic-certificate.pdf'
WHERE id='00000000-0000-4000-8000-00000000f71c';

SELECT pg_catalog.set_config('syka.allow_competition_transition','1',true);

UPDATE public.competitions
SET status='RESULT_PUBLISHED'
WHERE id='00000000-0000-4000-8000-00000000f714';
SELECT pg_catalog.set_config('syka.allow_competition_transition','0',true);

SELECT pg_catalog.set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT pg_catalog.set_config('request.jwt.claim.role','anon',true);
SET LOCAL ROLE anon;
DO $stage7_portal_published_result_and_certificate$
DECLARE
  v_token text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_certificate jsonb;
  v_result jsonb;
BEGIN
  v_certificate := public.get_collective_participant_certificate(v_token);
  IF v_certificate->>'certificate_id' IS DISTINCT FROM '00000000-0000-4000-8000-00000000f71c'
     OR v_certificate->>'verification_code' IS DISTINCT FROM 'STAGE7-CERT-VERIFY-001'
     OR v_certificate->>'serial_number' IS DISTINCT FROM 'STAGE7-CERT-SERIAL-001'
     OR v_certificate->>'status' IS DISTINCT FROM 'PUBLISHED' THEN
    RAISE EXCEPTION 'STAGE7_VALID_PUBLISHED_CERTIFICATE_NOT_RETURNED:%',v_certificate;
  END IF;

  v_result := public.get_collective_participant_result(v_token);
  IF coalesce((v_result->>'has_result')::boolean,false) IS NOT TRUE
     OR coalesce((v_result->>'published')::boolean,false) IS NOT TRUE
     OR (v_result->>'score')::numeric IS DISTINCT FROM 5::numeric
     OR (v_result->>'rank')::bigint IS DISTINCT FROM 1::bigint THEN
    RAISE EXCEPTION 'STAGE7_VALID_PUBLISHED_RESULT_NOT_RETURNED:%',v_result;
  END IF;
END;
$stage7_portal_published_result_and_certificate$;

RESET ROLE;
DO $stage7_portal_parent_cascade_and_expiry$
DECLARE
  v_parent_token text := pg_catalog.current_setting('stage7.portal_token_parent',true);
  v_child_token text := pg_catalog.current_setting('stage7.access_token_parent',true);
  v_lifecycle_parent text := pg_catalog.current_setting('stage7.portal_token_lifecycle',true);
  v_lifecycle_child text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.collective_access_sessions AS s
  WHERE s.token_hash=private.hash_collective_token(v_child_token)
    AND s.revoked_at IS NOT NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_PARENT_REVOCATION_DID_NOT_REVOKE_CHILD:%',v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.collective_access_sessions AS s
    JOIN public.collective_portal_sessions AS ps ON ps.id=s.portal_session_id
    WHERE s.token_hash=private.hash_collective_token(v_lifecycle_child)
      AND s.expires_at>ps.expires_at
  ) THEN
    RAISE EXCEPTION 'STAGE7_CHILD_ACCESS_EXPIRY_EXCEEDS_PARENT';
  END IF;
END;
$stage7_portal_parent_cascade_and_expiry$;

-- A disabled/rotated credential invalidates previously issued child tokens.
UPDATE public.collective_portal_credentials
SET enabled=false,updated_at=pg_catalog.now()
WHERE portal_identity_id='00000000-0000-4000-8000-00000000f716';
SET LOCAL ROLE anon;
DO $stage7_disabled_parent_credential$
DECLARE
  v_attempt uuid := pg_catalog.current_setting('stage7.attempt_id',true)::uuid;
  v_token text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_DISABLED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED:%',coalesce(v_error,'<no error>');
  END IF;
END;
$stage7_disabled_parent_credential$;

RESET ROLE;
UPDATE public.collective_portal_credentials
SET enabled=true,password_version=password_version+1,updated_at=pg_catalog.now()
WHERE portal_identity_id='00000000-0000-4000-8000-00000000f716';
SET LOCAL ROLE anon;
DO $stage7_rotated_parent_credential$
DECLARE
  v_attempt uuid := pg_catalog.current_setting('stage7.attempt_id',true)::uuid;
  v_token text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_ROTATED_PORTAL_CREDENTIAL_CHILD_TOKEN_ALLOWED:%',coalesce(v_error,'<no error>');
  END IF;
END;
$stage7_rotated_parent_credential$;

RESET ROLE;
UPDATE public.collective_portal_credentials
SET password_version=password_version-1,updated_at=pg_catalog.now()
WHERE portal_identity_id='00000000-0000-4000-8000-00000000f716';
UPDATE public.collective_portal_identities
SET status='SUSPENDED',updated_at=pg_catalog.now()
WHERE id='00000000-0000-4000-8000-00000000f716';
SET LOCAL ROLE anon;
DO $stage7_suspended_parent_identity$
DECLARE
  v_attempt uuid := pg_catalog.current_setting('stage7.attempt_id',true)::uuid;
  v_token text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_SUSPENDED_PORTAL_IDENTITY_CHILD_TOKEN_ALLOWED:%',coalesce(v_error,'<no error>');
  END IF;
END;
$stage7_suspended_parent_identity$;

RESET ROLE;
UPDATE public.collective_portal_identities
SET status='ACTIVE',updated_at=pg_catalog.now()
WHERE id='00000000-0000-4000-8000-00000000f716';
UPDATE public.collective_portal_sessions
SET expires_at=pg_catalog.now()-interval '1 second'
WHERE token_hash=private.hash_collective_token(
  pg_catalog.current_setting('stage7.portal_token_lifecycle',true)
);
SET LOCAL ROLE anon;
DO $stage7_expired_parent_session$
DECLARE
  v_attempt uuid := pg_catalog.current_setting('stage7.attempt_id',true)::uuid;
  v_token text := pg_catalog.current_setting('stage7.access_token_lifecycle',true);
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_collective_linear_exam_state(v_attempt,v_token);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COLLECTIVE_SESSION_INVALID' THEN
    RAISE EXCEPTION 'STAGE7_EXPIRED_PARENT_SESSION_CHILD_TOKEN_ALLOWED:%',coalesce(v_error,'<no error>');
  END IF;
END;
$stage7_expired_parent_session$;

RESET ROLE;
ROLLBACK;
