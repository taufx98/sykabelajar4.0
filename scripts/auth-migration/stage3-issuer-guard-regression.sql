-- Rollback-only acceptance for the Stage 3 restrictive issuer guard.
-- Run only against the complete disposable schema restore after the guard draft.
\set ON_ERROR_STOP on
BEGIN;

DO $stage7_tranche10_fixture_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.commerce_products
    WHERE id = '77777777-7777-4777-8777-777777777793'::uuid
       OR code = 'STAGE7-ISSUER-PRODUCT'
       OR slug = 'stage7-issuer-product'
  ) OR EXISTS (
    SELECT 1 FROM public.organizers
    WHERE id IN (
      '77777777-7777-4777-8777-777777777791'::uuid,
      '77777777-7777-4777-8777-777777777795'::uuid
    ) OR slug IN ('stage7-question-organizer','stage7-foreign-question-organizer')
  ) OR EXISTS (
    SELECT 1 FROM public.question_banks
    WHERE id IN (
      '77777777-7777-4777-8777-777777777792'::uuid,
      '77777777-7777-4777-8777-777777777796'::uuid
    )
  ) OR EXISTS (
    SELECT 1 FROM public.questions
    WHERE id = '77777777-7777-4777-8777-777777777797'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.organizer_members
    WHERE organizer_id = '77777777-7777-4777-8777-777777777791'::uuid
       OR (organizer_id = '77777777-7777-4777-8777-777777777791'::uuid
           AND user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid)
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
      AND role = 'student'::public.app_role
  ) OR EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = '44444444-4444-4444-8444-444444444441'::uuid
       OR slug = 'stage7-organizer-scope-probe'
  ) OR EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id = '44444444-4444-4444-8444-444444444442'::uuid
       OR slug = 'stage7-owner-preview-report-probe'
  ) OR EXISTS (
    SELECT 1 FROM public.attempts
    WHERE id = '77777777-7777-4777-8777-777777777783'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.competitions
    WHERE id IN (
      '33333333-3333-4333-8333-333333333334'::uuid,
      '33333333-3333-4333-8333-333333333335'::uuid
    ) OR slug IN (
      'stage3-unpublished-result-probe',
      'stage7-tranche12-collective-result-probe'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.teacher_rosters
    WHERE id = '88888888-8888-4888-8888-888888888892'::uuid
       OR (teacher_user_id = 'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid
           AND name = 'Stage 7 Tranche 12 Collective Result Roster')
  ) OR EXISTS (
    SELECT 1 FROM public.roster_students
    WHERE id = '99999999-9999-4999-8999-999999999983'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.collective_participants
    WHERE id = '66666666-6666-4666-8666-666666666682'::uuid
       OR participant_code = 'STAGE7-T12-COL-001'
  ) OR EXISTS (
    SELECT 1 FROM public.participants
    WHERE collective_participant_id = '66666666-6666-4666-8666-666666666682'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.attempts
    WHERE id = '77777777-7777-4777-8777-777777777774'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.participants
    WHERE id IN (
      '55555555-5555-4555-8555-555555555561'::uuid,
      '55555555-5555-4555-8555-555555555562'::uuid,
      '55555555-5555-4555-8555-555555555553'::uuid
    )
  ) OR EXISTS (
    SELECT 1 FROM public.attempts
    WHERE id IN (
      '77777777-7777-4777-8777-777777777781'::uuid,
      '77777777-7777-4777-8777-777777777782'::uuid,
      '77777777-7777-4777-8777-777777777773'::uuid
    )
  ) OR EXISTS (
    SELECT 1 FROM public.grading_items
    WHERE id = '88888888-8888-4888-8888-888888888893'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.registrations
    WHERE id = '66666666-6666-4666-8666-666666666691'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.organizer_custom_plan_requests
    WHERE organizer_id = '77777777-7777-4777-8777-777777777791'::uuid
      AND requester_user_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
      AND notes = 'Stage 7 Tranche 16 owner custom plan probe'
  ) THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE10_FIXTURE_UUID_COLLISION';
  END IF;
END;
$stage7_tranche10_fixture_preflight$;

CREATE FUNCTION pg_temp.stage3_user_rpc_call_error(p_signature text)
RETURNS text
LANGUAGE plpgsql
AS $function$
DECLARE
  v_oid oid;
  v_schema text;
  v_name text;
  v_returns_set boolean;
  v_args text;
  v_sql text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(p_signature)::oid;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE3_USER_RPC_SIGNATURE_MISSING:%', p_signature;
  END IF;

  SELECT n.nspname, p.proname, p.proretset,
         coalesce((
           SELECT string_agg(
             pg_catalog.format('NULL::%s', pg_catalog.format_type(arg.type_oid, NULL)),
             ', ' ORDER BY arg.ordinality
           )
           FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS arg(type_oid, ordinality)
         ), '')
    INTO v_schema, v_name, v_returns_set, v_args
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid=v_oid;

  v_sql := CASE WHEN v_returns_set
    THEN pg_catalog.format('SELECT * FROM %I.%I(%s)', v_schema, v_name, v_args)
    ELSE pg_catalog.format('SELECT %I.%I(%s)', v_schema, v_name, v_args)
  END;

  BEGIN
    EXECUTE v_sql;
    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
END;
$function$;


DO $verify_policy_catalog$
DECLARE
  v_authenticated oid;
  v_guard_count integer;
  v_guard_table_count integer;
  v_bad_count integer;
BEGIN
  SELECT oid INTO v_authenticated FROM pg_roles WHERE rolname = 'authenticated';

  SELECT count(*), count(DISTINCT pol.polrelid)
    INTO v_guard_count, v_guard_table_count
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard'
    AND pol.polpermissive = false
    AND pol.polcmd = '*'
    AND pol.polroles @> ARRAY[v_authenticated]::oid[]
    AND pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%auth.jwt%'
    AND pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%auth.jwt%';

  IF v_guard_count <> 61 OR v_guard_table_count <> 61 THEN
    RAISE EXCEPTION 'STAGE3_ISSUER_GUARD_COVERAGE_FAILED: policies %, tables %',
      v_guard_count, v_guard_table_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard'
    AND (
      pg_get_expr(pol.polqual, pol.polrelid) NOT LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) NOT LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
      OR pg_get_expr(pol.polqual, pol.polrelid) LIKE '%https://mvdczyitbkxkldjughor.supabase.co/auth/v1%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%https://mvdczyitbkxkldjughor.supabase.co/auth/v1%'
    );
  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_ISSUER_GUARD_ALLOWED_ISSUER_DRIFT: %', v_bad_count;
  END IF;
END;
$verify_policy_catalog$;

CREATE TABLE public.auth_issuer_guard_probe (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  marker text NOT NULL
);
ALTER TABLE public.auth_issuer_guard_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_issuer_guard_probe FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_issuer_guard_probe FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_issuer_guard_probe TO authenticated;

CREATE POLICY auth_issuer_guard_probe_owner
  ON public.auth_issuer_guard_probe
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY better_auth_issuer_guard
  ON public.auth_issuer_guard_probe
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'iss') = 'https://auth-prod.sykabelajar.my.id/api/auth')
  WITH CHECK ((SELECT auth.jwt() ->> 'iss') = 'https://auth-prod.sykabelajar.my.id/api/auth');

-- Use only fresh synthetic Better Auth identities. The first identity has an active
-- Admin role, but a Supabase Auth or foreign issuer must still fail every issuer guard.
INSERT INTO private.app_users (id, identity_origin)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'better_auth'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'better_auth'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'better_auth'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'better_auth'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff6', 'better_auth');

-- Synthetic profiles exercise the SECURITY DEFINER privacy boundary after
-- Stage 3. Two fresh synthetic Better Auth identities have private profiles;
-- public profile C publishes only its following list, not its followers list.
INSERT INTO public.profiles (id, username, full_name, is_public)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stage3_untrusted_issuer_private', 'Untrusted Issuer Probe', false),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stage3_ba_private', 'Better Auth Owner Probe', false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'stage3_public_profile', 'Public Profile Probe', true),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'stage3_public_follower', 'Public Follower Probe', true),
  ('ffffffff-ffff-4fff-8fff-fffffffffff6', 'stage3_ba_private_badge_owner', 'Private Badge Owner Probe', false);

INSERT INTO public.profile_ui_settings (user_id, show_following_popup, show_social_popup)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', false, false),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', false, false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true, false);

INSERT INTO public.follows (follower_id, following_id, status)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'approved'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'approved'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'approved'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'approved'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'approved');

-- Competition fixtures prove that the SECURITY DEFINER collective-options RPC
-- mirrors the table's PUBLIC/Admin/organizer visibility boundary.
INSERT INTO public.competitions (
  id, slug, title, category, status, visibility, participant_mode, config
)
VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'stage3-public-collective-probe',
    'Stage 3 Public Collective Probe',
    'Stage 3 Test',
    'REGISTRATION_OPEN'::public.competition_status,
    'PUBLIC',
    'COLLECTIVE_TEACHER',
    '{"participant_modes":["COLLECTIVE_TEACHER"]}'::jsonb
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'stage3-private-collective-probe',
    'Stage 3 Private Collective Probe',
    'Stage 3 Test',
    'REGISTRATION_OPEN'::public.competition_status,
    'PRIVATE',
    'COLLECTIVE_TEACHER',
    '{"participant_modes":["COLLECTIVE_TEACHER"]}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    'stage3-public-result-probe',
    'Stage 3 Public Result Probe',
    'Stage 3 Test',
    'RESULT_PUBLISHED'::public.competition_status,
    'PUBLIC',
    'INDIVIDUAL',
    '{}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333334',
    'stage3-unpublished-result-probe',
    'Stage 3 Unpublished Result Probe',
    'Stage 3 Test',
    'REGISTRATION_OPEN'::public.competition_status,
    'PUBLIC',
    'INDIVIDUAL',
    '{}'::jsonb
  ),
  (
    '33333333-3333-4333-8333-333333333335',
    'stage7-tranche12-collective-result-probe',
    'Stage 7 Tranche 12 Collective Result Probe',
    'Stage 7 Test',
    'RESULT_PUBLISHED'::public.competition_status,
    'PRIVATE',
    'COLLECTIVE_TEACHER',
    '{"participant_modes":["COLLECTIVE_TEACHER"]}'::jsonb
  );

-- A public results page may expose the published result, but private badge
-- collections remain private unless read by their real Better Auth owner/Admin.
-- Stage 7 teacher/collective fixtures: same synthetic Better Auth Admin
-- owns the roster and participant, so the legacy-issuer path is tested
-- against actual protected rows rather than only absent UUIDs.
DO $stage7_tranche09_fixture_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.participants
    WHERE competition_id = '22222222-2222-4222-8222-222222222222'::uuid
      AND participant_code = 'STAGE7-T09-NEW-001'
  ) OR EXISTS (
    SELECT 1 FROM public.collective_participants
    WHERE participant_code = 'STAGE7-T09-NEW-001'
  ) THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE09_PARTICIPANT_CODE_COLLISION';
  END IF;
END;
$stage7_tranche09_fixture_preflight$;

INSERT INTO public.teacher_rosters (id, teacher_user_id, name, is_active)
VALUES
  (
    '88888888-8888-4888-8888-888888888891',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Stage 7 issuer boundary roster',
    true
  ),
  (
    '88888888-8888-4888-8888-888888888892',
    'ffffffff-ffff-4fff-8fff-fffffffffff6',
    'Stage 7 Tranche 12 Collective Result Roster',
    true
  );

INSERT INTO public.roster_students (id, roster_id, full_name, is_active)
VALUES
  (
    '99999999-9999-4999-8999-999999999981',
    '88888888-8888-4888-8888-888888888891',
    'Stage 7 Existing Collective Participant',
    true
  ),
  (
    '99999999-9999-4999-8999-999999999982',
    '88888888-8888-4888-8888-888888888891',
    'Stage 7 New Collective Participant',
    true
  ),
  (
    '99999999-9999-4999-8999-999999999983',
    '88888888-8888-4888-8888-888888888892',
    'Stage 7 Tranche 12 Collective Result Participant',
    true
  );

INSERT INTO public.collective_participants (
  id, competition_id, roster_student_id, managed_by_user_id,
  participant_code, full_name, status
)
VALUES (
  '66666666-6666-4666-8666-666666666681',
  '22222222-2222-4222-8222-222222222222',
  '99999999-9999-4999-8999-999999999981',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'STAGE7-T09-NEW-001',
  'Stage 7 Existing Collective Participant',
  'ACTIVE'
);

INSERT INTO public.collective_participants (
  id, competition_id, roster_student_id, managed_by_user_id,
  participant_code, full_name, status
)
VALUES (
  '66666666-6666-4666-8666-666666666682',
  '33333333-3333-4333-8333-333333333335',
  '99999999-9999-4999-8999-999999999983',
  'ffffffff-ffff-4fff-8fff-fffffffffff6',
  'STAGE7-T12-COL-001',
  'Stage 7 Tranche 12 Collective Result Participant',
  'ACTIVE'
);

-- Active collective_participants are canonicalized by
-- trg_collective_participant_canonical. Assert that the trigger created the
-- canonical row instead of inserting a duplicate manually.
DO $stage7_tranche09_canonical_fixture$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.participants p
    WHERE p.competition_id = '22222222-2222-4222-8222-222222222222'::uuid
      AND p.collective_participant_id = '66666666-6666-4666-8666-666666666681'::uuid
      AND p.participant_type = 'COLLECTIVE'
      AND p.participant_code = 'STAGE7-T09-NEW-001'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.participants p
    WHERE p.competition_id = '33333333-3333-4333-8333-333333333335'::uuid
      AND p.collective_participant_id = '66666666-6666-4666-8666-666666666682'::uuid
      AND p.participant_type = 'COLLECTIVE'
      AND p.participant_code = 'STAGE7-T12-COL-001'
      AND p.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE09_OR_T12_CANONICAL_PARTICIPANT_NOT_CREATED';
  END IF;
END;
$stage7_tranche09_canonical_fixture$;

-- Keep the trigger-generated canonical ID for the later cross-user IDOR test.
-- The ID is captured while the schema-only fixture runner still has its
-- privileged database role, then reused unchanged after switching JWT claims.
SELECT set_config(
  'stage7.tranche12.canonical_participant_id',
  (
    SELECT id::text
    FROM public.participants
    WHERE collective_participant_id = '66666666-6666-4666-8666-666666666682'::uuid
  ),
  TRUE
);

INSERT INTO public.participants (
  id, competition_id, user_id, participant_type, full_name
)
VALUES
  ('55555555-5555-4555-8555-555555555551', '33333333-3333-4333-8333-333333333333',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'INDIVIDUAL', 'Untrusted Issuer Private Participant'),
  ('55555555-5555-4555-8555-555555555552', '33333333-3333-4333-8333-333333333333',
   'ffffffff-ffff-4fff-8fff-fffffffffff6', 'INDIVIDUAL', 'Better Auth Private Participant'),
  ('55555555-5555-4555-8555-555555555553', '33333333-3333-4333-8333-333333333334',
   'ffffffff-ffff-4fff-8fff-fffffffffff6', 'INDIVIDUAL', 'Unpublished Result Participant'),
  ('55555555-5555-4555-8555-555555555554', '33333333-3333-4333-8333-333333333334',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'INDIVIDUAL', 'Active Exam Issuer Probe Participant');

INSERT INTO public.attempts (
  id, competition_id, participant_id, canonical_participant_id, status, score, finalized_at
)
VALUES
  ('77777777-7777-4777-8777-777777777771', '33333333-3333-4333-8333-333333333333',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555551',
   'FINALIZED'::public.attempt_status, 91, now()),
  ('77777777-7777-4777-8777-777777777772', '33333333-3333-4333-8333-333333333333',
   'ffffffff-ffff-4fff-8fff-fffffffffff6', '55555555-5555-4555-8555-555555555552',
   'FINALIZED'::public.attempt_status, 92, now()),
  ('77777777-7777-4777-8777-777777777773', '33333333-3333-4333-8333-333333333334',
   'ffffffff-ffff-4fff-8fff-fffffffffff6', '55555555-5555-4555-8555-555555555553',
   'FINALIZED'::public.attempt_status, 88, now());

-- An existing in-progress attempt specifically exercises the legacy-issuer
-- start/resume path before any runtime initialization is attempted.
INSERT INTO public.attempts (
  id, competition_id, participant_id, canonical_participant_id, status
)
VALUES (
  '77777777-7777-4777-8777-777777777775',
  '33333333-3333-4333-8333-333333333334',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '55555555-5555-4555-8555-555555555554',
  'IN_PROGRESS'::public.attempt_status
);

-- A collective attempt must link both the canonical participant and the
-- collective participant while leaving the individual Auth participant NULL.
INSERT INTO public.attempts (
  id, competition_id, collective_participant_id, canonical_participant_id,
  status, score, finalized_at
)
SELECT
  '77777777-7777-4777-8777-777777777774',
  cp.competition_id,
  cp.id,
  p.id,
  'FINALIZED'::public.attempt_status,
  87,
  now()
FROM public.collective_participants cp
JOIN public.participants p ON p.collective_participant_id = cp.id
WHERE cp.id = '66666666-6666-4666-8666-666666666682'::uuid;

INSERT INTO public.badges (id, code, name, slug, status, award_type)
VALUES ('88888888-8888-4888-8888-888888888881', 'stage3-private-badge',
        'Stage 3 Private Badge', 'stage3-private-badge', 'ACTIVE', 'MANUAL');

INSERT INTO public.user_badges (user_id, badge_id, award_source, reason, source_reference)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '88888888-8888-4888-8888-888888888881',
   'MANUAL', 'Legacy private badge probe', '33333333-3333-4333-8333-333333333333'),
  ('ffffffff-ffff-4fff-8fff-fffffffffff6', '88888888-8888-4888-8888-888888888881',
   'MANUAL', 'Better Auth private badge probe', '33333333-3333-4333-8333-333333333333');
INSERT INTO public.user_roles (user_id, role, is_active)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'::public.app_role, TRUE),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'::public.app_role, TRUE),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'student'::public.app_role, TRUE);

-- Stage 7 Tranche 10 fixtures: a student catalog product, an active
-- organizer membership/question bank, and a foreign-bank question.
INSERT INTO public.commerce_products (
  id, code, slug, name, product_type, audiences, price, currency,
  is_active, is_featured, sort_order, metadata
)
VALUES (
  '77777777-7777-4777-8777-777777777793',
  'STAGE7-ISSUER-PRODUCT',
  'stage7-issuer-product',
  'Stage 7 Issuer Boundary Product',
  'DIGITAL_ITEM',
  ARRAY['student']::text[],
  1250,
  'IDR',
  TRUE,
  FALSE,
  0,
  '{}'::jsonb
);

INSERT INTO public.organizers (
  id, name, slug, owner_user_id, status, access_code
)
VALUES
  (
    '77777777-7777-4777-8777-777777777791',
    'Stage 7 Question Organizer',
    'stage7-question-organizer',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'ACTIVE',
    'DEPRECATED'
  ),
  (
    '77777777-7777-4777-8777-777777777795',
    'Stage 7 Foreign Question Organizer',
    'stage7-foreign-question-organizer',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'ACTIVE',
    'DEPRECATED'
  );

-- The owner must establish their own owner membership under the exact
-- Better Auth identity; the governance trigger rejects an unauthenticated
-- fixture even when the inserted user_id matches organizers.owner_user_id.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  TRUE
);
INSERT INTO public.organizer_members (
  organizer_id, user_id, member_role, is_active, role, status
)
VALUES (
  '77777777-7777-4777-8777-777777777791',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'owner',
  TRUE,
  'owner',
  'ACTIVE'
);
-- The two question banks belong to different synthetic organizers.
-- Use the existing Better Auth Admin identity for this shared fixture insert;
-- the question-bank entitlement trigger correctly rejects an unrelated owner.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);

INSERT INTO public.question_banks (id, organizer_id, name, status)
VALUES
  (
    '77777777-7777-4777-8777-777777777792',
    '77777777-7777-4777-8777-777777777791',
    'Stage 7 Owned Question Bank',
    'DRAFT'
  ),
  (
    '77777777-7777-4777-8777-777777777796',
    '77777777-7777-4777-8777-777777777795',
    'Stage 7 Foreign Question Bank',
    'DRAFT'
  );

-- Schema-only restores contain the plan tables but not their production
-- catalog rows. Seed a minimal FREE package/entitlement only for this
-- rollback-only test so the real organizer question-quota trigger can pass.
-- This synthetic configuration is removed by the outer transaction rollback.
INSERT INTO public.plan_catalog (
  plan_code, name, badge, description, monthly_price, yearly_price,
  monthly_discount_percent, yearly_discount_percent, currency,
  sort_order, is_active, config
)
VALUES (
  'FREE',
  'Stage 7 Disposable Fixture Plan',
  NULL,
  'Rollback-only Stage 7 entitlement fixture',
  0,
  0,
  0,
  0,
  'IDR',
  0,
  TRUE,
  '{}'::jsonb
)
ON CONFLICT (plan_code) DO NOTHING;

INSERT INTO public.plan_entitlements (
  plan_code, capability, limit_value, config
)
VALUES (
  'FREE',
  'question_limit',
  10,
  '{}'::jsonb
)
ON CONFLICT (plan_code, capability) DO NOTHING;

-- The organizer-owned finalize probe must pass the real manual_grading
-- entitlement check before it reaches the safe non-finalizable status guard.
INSERT INTO public.plan_entitlements (
  plan_code, capability, limit_value, config
)
VALUES (
  'FREE',
  'manual_grading',
  1,
  '{}'::jsonb
)
ON CONFLICT (plan_code, capability) DO NOTHING;

INSERT INTO public.organizer_plans (
  organizer_id, plan_code, starts_at, ends_at, is_active
)
VALUES (
  '77777777-7777-4777-8777-777777777791',
  'FREE',
  now() - interval '1 minute',
  now() + interval '1 day',
  TRUE
);

DO $stage7_question_entitlement_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.plan_entitlements pe
    WHERE pe.plan_code = 'FREE'
      AND pe.capability = 'question_limit'
      AND pe.limit_value > 0
  ) THEN
    RAISE EXCEPTION 'STAGE7_QUESTION_QUOTA_FIXTURE_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.plan_entitlements pe
    WHERE pe.plan_code = 'FREE'
      AND pe.capability = 'manual_grading'
      AND pe.limit_value > 0
  ) THEN
    RAISE EXCEPTION 'STAGE7_MANUAL_GRADING_ENTITLEMENT_FIXTURE_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizer_plans op
    WHERE op.organizer_id = '77777777-7777-4777-8777-777777777791'::uuid
      AND op.plan_code = 'FREE'
      AND op.is_active = TRUE
      AND op.starts_at <= now()
      AND (op.ends_at IS NULL OR op.ends_at > now())
  ) THEN
    RAISE EXCEPTION 'STAGE7_ORGANIZER_PLAN_FIXTURE_MISSING';
  END IF;
END;
$stage7_question_entitlement_preflight$;

INSERT INTO public.questions (
  id, question_bank_id, type, prompt, points, required,
  display_order, status, config
)
VALUES (
  '77777777-7777-4777-8777-777777777797',
  '77777777-7777-4777-8777-777777777796',
  'multiple-choice',
  'Stage 7 foreign-bank question that must not be moved',
  1,
  TRUE,
  1,
  'DRAFT',
  '{}'::jsonb
);

INSERT INTO public.question_options (
  question_id, label, value, is_correct, display_order
)
VALUES (
  '77777777-7777-4777-8777-777777777797',
  'Foreign existing option',
  'foreign-existing-option',
  TRUE,
  1
);

-- Tranche 11 owner-scope fixture: bind the organizer when the competition is
-- created. The application intentionally makes organizer_id immutable after
-- insert; do not retarget an unrelated pre-existing competition.
-- The synthetic Admin JWT is active, and the outer transaction rolls back.
INSERT INTO public.competitions (
  id, slug, title, category, status, visibility,
  participant_mode, config, organizer_id
)
VALUES (
  '44444444-4444-4444-8444-444444444441',
  'stage7-organizer-scope-probe',
  'Stage 7 Organizer Scope Probe',
  'Stage 7 Test',
  'RESULT_PUBLISHED'::public.competition_status,
  'PRIVATE',
  'INDIVIDUAL',
  '{}'::jsonb,
  '77777777-7777-4777-8777-777777777791'::uuid
);

-- A distinct DRAFT competition is used only to seed the owner-only preview report.
INSERT INTO public.competitions (
  id, slug, title, category, status, visibility,
  participant_mode, config, organizer_id
)
VALUES (
  '44444444-4444-4444-8444-444444444442',
  'stage7-owner-preview-report-probe',
  'Stage 7 Owner Preview Report Probe',
  'Stage 7 Test',
  'DRAFT'::public.competition_status,
  'PRIVATE',
  'INDIVIDUAL',
  '{}'::jsonb,
  '77777777-7777-4777-8777-777777777791'::uuid
);

INSERT INTO public.participants (
  id, competition_id, user_id, participant_type, full_name
)
VALUES
  (
    '55555555-5555-4555-8555-555555555561',
    '44444444-4444-4444-8444-444444444441',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'INDIVIDUAL',
    'Stage 7 Organizer Finalized Attempt'
  ),
  (
    '55555555-5555-4555-8555-555555555562',
    '44444444-4444-4444-8444-444444444441',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'INDIVIDUAL',
    'Stage 7 Organizer Grading Limits Attempt'
  );

INSERT INTO public.attempts (
  id, competition_id, participant_id, canonical_participant_id,
  status, score, finalized_at, is_preview
)
VALUES
  (
    '77777777-7777-4777-8777-777777777781',
    '44444444-4444-4444-8444-444444444441',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '55555555-5555-4555-8555-555555555561',
    'FINALIZED'::public.attempt_status,
    91,
    now(),
    FALSE
  ),
  (
    '77777777-7777-4777-8777-777777777782',
    '44444444-4444-4444-8444-444444444441',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '55555555-5555-4555-8555-555555555562',
    'FINALIZED'::public.attempt_status,
    92,
    now(),
    FALSE
  );

-- The completed preview intentionally contains a recognizable answer key.
-- Only preview_owner_id may retrieve this report, including its answer_key field.
INSERT INTO public.attempts (
  id, competition_id, attempt_number, status, started_at, submitted_at,
  score, is_preview, preview_owner_id
)
VALUES (
  '77777777-7777-4777-8777-777777777783',
  '44444444-4444-4444-8444-444444444442',
  1,
  'SUBMITTED'::public.attempt_status,
  now() - interval '2 minutes',
  now(),
  1,
  TRUE,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
);

INSERT INTO public.exam_attempt_runtime (
  attempt_id, current_position, question_count, duration_seconds, phase, global_deadline
)
VALUES (
  '77777777-7777-4777-8777-777777777783',
  1, 1, 60, 'COMPLETED', now() + interval '1 minute'
);

INSERT INTO public.exam_attempt_questions (
  attempt_id, position, question_id, question_snapshot, answer_key_snapshot,
  points_snapshot, base_seconds, state, opened_at, closed_at, elapsed_seconds, transition_reason
)
VALUES (
  '77777777-7777-4777-8777-777777777783',
  1,
  '77777777-7777-4777-8777-777777777797',
  jsonb_build_object(
    'id', '77777777-7777-4777-8777-777777777797',
    'prompt', 'Stage 7 owner-only preview question',
    'type', 'multiple-choice',
    'points', 1,
    'display_order', 1,
    'options', jsonb_build_array(jsonb_build_object('id', 'preview-correct-option', 'label', 'Preview option'))
  ),
  jsonb_build_object(
    'correct_option_ids', jsonb_build_array('preview-correct-option'),
    'accepted_answers', '[]'::jsonb,
    'answer_key', 'preview-answer-key-secret'
  ),
  1, 60, 'SKIPPED', now() - interval '1 minute', now(), 0, 'SKIPPED'
);

INSERT INTO public.grading_items (
  id, attempt_id, question_id, score, feedback
)
VALUES (
  '88888888-8888-4888-8888-888888888893',
  '77777777-7777-4777-8777-777777777781',
  '77777777-7777-4777-8777-777777777797',
  0,
  'Stage 7 tranche 14 rollback-only authorization fixture'
);

-- Tranche 16 organizer registration fixture. It reuses the fresh synthetic
-- owner/competition created above and one unrelated synthetic student profile.
-- This row exists only to test review_registration authorization against a
-- private, already-published competition. It is not a normal registration
-- acceptance test, so bypass only the normal INSERT validation trigger while
-- inserting this privileged rollback fixture; keep all other table triggers,
-- constraints and the production registration trigger intact afterward.
DO $stage3_registration_fixture_trigger_preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.registrations'::regclass
      AND t.tgname = 'trg_validate_registration_insert'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
  ) THEN
    RAISE EXCEPTION 'STAGE3_REGISTRATION_FIXTURE_VALIDATION_TRIGGER_MISSING';
  END IF;
END;
$stage3_registration_fixture_trigger_preflight$;

ALTER TABLE public.registrations DISABLE TRIGGER trg_validate_registration_insert;
INSERT INTO public.registrations (
  id, competition_id, user_id, status, metadata
)
VALUES (
  '66666666-6666-4666-8666-666666666691',
  '44444444-4444-4444-8444-444444444441',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'PENDING'::public.registration_status,
  jsonb_build_object('fixture', 'stage7-tranche16')
);
ALTER TABLE public.registrations ENABLE TRIGGER trg_validate_registration_insert;

SELECT set_config('request.jwt.claims', '{}', TRUE);
SELECT set_config('request.jwt.claim.sub', '', TRUE);

INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner-a'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner-b');

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims',
  '{"role":"anon","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  true);
SELECT set_config('request.jwt.claim.sub', '', true);
DO $profile_anon$
DECLARE
  v_count integer;
  v_detail jsonb;
  v_status text;
  v_denied boolean := false;
BEGIN
  -- A private profile remains private even when its popup setting is enabled.
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'following');
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_ANON_PRIVATE_PROFILE_CONNECTIONS_ALLOWED'; END IF;

  -- Public connection lists are available only for the enabled mode.
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 'following');
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_ANON_PUBLIC_FOLLOWING_LIST_FAILED:%', v_count; END IF;
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid, 'followers');
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_ANON_HIDDEN_FOLLOWERS_LIST_ALLOWED'; END IF;

  v_detail := public.get_competition_participant_detail(
    'stage3-public-result-probe',
    '55555555-5555-4555-8555-555555555551'::uuid
  );
  IF jsonb_array_length(coalesce(v_detail->'badges', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_ANON_PRIVATE_RESULT_BADGES_ALLOWED';
  END IF;
  IF coalesce(v_detail ? 'answers', false)
     OR coalesce(v_detail ? 'answer', false)
     OR coalesce(v_detail ? 'question_snapshot', false)
     OR coalesce(v_detail ? 'answer_key', false)
     OR coalesce(v_detail ? 'answer_key_snapshot', false)
     OR coalesce(v_detail::text ILIKE '%correct_option_ids%', false)
     OR coalesce(v_detail::text ILIKE '%accepted_answers%', false) THEN
    RAISE EXCEPTION 'STAGE3_ANON_PARTICIPANT_DETAIL_QUESTION_SNAPSHOT_LEAKED:%', v_detail;
  END IF;

  -- Public results are available only after publication on a PUBLIC competition.
  v_detail := public.get_public_competition_results('stage3-public-result-probe', 100, 0);
  IF v_detail->'competition'->>'slug' IS DISTINCT FROM 'stage3-public-result-probe'
     OR coalesce((v_detail->>'result_count')::integer, 0) < 1
     OR jsonb_array_length(coalesce(v_detail->'results', '[]'::jsonb)) < 1 THEN
    RAISE EXCEPTION 'STAGE3_ANON_PUBLIC_RESULTS_READ_FAILED:%', v_detail;
  END IF;
  IF (v_detail->'results'->0) ? 'answers'
     OR (v_detail->'results'->0) ? 'answer_key'
     OR (v_detail->'results'->0) ? 'question_snapshot'
     OR (v_detail->'results'->0) ? 'answer_key_snapshot'
     OR (v_detail->'results'->0) ? 'social_proof_url'
     OR (v_detail->'results'->0) ? 'registration_metadata'
     OR coalesce((v_detail->'results'->0)::text ILIKE '%correct_option_ids%', false)
     OR coalesce((v_detail->'results'->0)::text ILIKE '%accepted_answers%', false) THEN
    RAISE EXCEPTION 'STAGE3_ANON_PUBLIC_RESULTS_PRIVATE_FIELDS_LEAKED:%', v_detail;
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.get_public_competition_results('stage3-unpublished-result-probe', 100, 0);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_RESULTS_NOT_FOUND' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_ANON_UNPUBLISHED_COMPETITION_RESULTS_ALLOWED';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.get_public_competition_results('stage7-tranche12-collective-result-probe', 100, 0);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_RESULTS_NOT_FOUND' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_ANON_PRIVATE_COMPETITION_RESULTS_ALLOWED';
  END IF;

  -- The social summary deliberately has no anon/PUBLIC EXECUTE grant.
  IF has_function_privilege('anon', 'public.get_public_profile_social(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_SOCIAL_SUMMARY_GRANT_REMAINS';
  END IF;
  BEGIN
    PERFORM * FROM public.get_public_profile_social('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid);
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_ANON_SOCIAL_SUMMARY_ALLOWED'; END IF;

  -- Anonymous pages may sync only public competitions whose schedule has
  -- crossed a registration boundary; private IDs do not reveal status.
  v_status := public.sync_competition_registration_status('11111111-1111-4111-8111-111111111111'::uuid);
  IF v_status IS DISTINCT FROM 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'STAGE3_ANON_PUBLIC_COMPETITION_STATUS_SYNC_FAILED:%', v_status;
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.sync_competition_registration_status('22222222-2222-4222-8222-222222222222'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_ANON_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED'; END IF;

  -- Login/Admin-only RPCs must not be directly executable as anon.
  IF has_function_privilege('anon', 'public.admin_diagnose_organizer_voucher_delete(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_ADMIN_DIAGNOSE_EXECUTE_REMAINS';
  END IF;
  IF has_function_privilege('anon', 'public.admin_evaluate_badges()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_ADMIN_EVALUATE_BADGES_EXECUTE_REMAINS';
  END IF;
  IF has_function_privilege('anon', 'public.admin_update_system_error_status(uuid,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_ADMIN_UPDATE_SYSTEM_ERROR_EXECUTE_REMAINS';
  END IF;
  IF has_function_privilege('anon', 'public.reopen_system_error_incident(uuid,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_REOPEN_SYSTEM_ERROR_EXECUTE_REMAINS';
  END IF;
  IF has_function_privilege('anon', 'public.get_follow_status(uuid,uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_GET_FOLLOW_STATUS_EXECUTE_REMAINS';
  END IF;
  IF has_function_privilege('anon', 'public.get_collective_registration_options(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_ANON_COLLECTIVE_OPTIONS_EXECUTE_REMAINS';
  END IF;
END;
$profile_anon$;

RESET ROLE;
DO $stage3_exam_start_active_attempt_fixture_preflight$
BEGIN
  -- Check the active attempt while this rollback-only regression is still
  -- running with the privileged session role. The later legacy JWT must not
  -- be able to read this fixture through the restrictive issuer RLS policy.
  IF NOT EXISTS (
    SELECT 1 FROM public.attempts
    WHERE id = '77777777-7777-4777-8777-777777777775'::uuid
      AND competition_id = '33333333-3333-4333-8333-333333333334'::uuid
      AND participant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND status = 'IN_PROGRESS'::public.attempt_status
  ) THEN
    RAISE EXCEPTION 'STAGE3_EXAM_START_ACTIVE_ATTEMPT_FIXTURE_MISSING';
  END IF;
END;
$stage3_exam_start_active_attempt_fixture_preflight$;

SET LOCAL ROLE authenticated;

-- Supabase Auth is not a trusted application login after this cutover.
-- A Supabase Auth issuer is no longer trusted, even for a fresh UUID that has an active role.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $all_user_rpc_legacy_issuer$
DECLARE
  v_signature text;
  v_error text;
  v_rpc_source text;
  v_count integer := 0;
BEGIN
  -- This subject owns the active synthetic attempt verified by the privileged
  -- fixture preflight above. The legacy issuer must be rejected before the
  -- start/resume RPC can read or initialize that row.
  v_error := NULL;
  BEGIN
    PERFORM public.start_linear_exam_attempt(
      '33333333-3333-4333-8333-333333333334'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_START_LINEAR_EXAM_ACTIVE_ATTEMPT_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)',
    'public.archive_my_order_history(uuid)',
    'public.bulk_import_roster_students(uuid,jsonb)',
    'public.cancel_my_pending_order(uuid)',
    'public.choose_linear_exam_timeout(uuid,text)',
    'public.claim_and_complete_daily_task(uuid)',
    'public.claim_collective_participant(text,text)',
    'public.claim_daily_checkin(date,integer)',
    'public.claim_daily_task(uuid)',
    'public.claim_organizer_voucher(uuid)',
    'public.claim_rpc_recovery(text)',
    'public.complete_daily_task(uuid)',
    'public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)',
    'public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)',
    'public.create_follow_request(uuid)',
    'public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])',
    'public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])',
    'public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])',
    'public.ensure_referral_code()',
    'public.get_collective_registration(uuid)',
    'public.get_collective_registration_options(uuid)',
    'public.get_daily_checkin_streak_rewards(date)',
    'public.get_follow_status(uuid,uuid)',
    'public.get_linear_exam_state(uuid)',
    'public.get_my_canonical_competition_result(uuid)',
    'public.get_my_canonical_participant(uuid)',
    'public.get_my_learning_insights()',
    'public.get_my_referral_tier_awards()',
    'public.get_my_referrals()',
    'public.get_my_referrals_v2()',
    'public.get_my_verified_referrals()',
    'public.get_organizer_exam_preview_report(uuid)',
    'public.get_organizer_payment_config()',
    'public.get_public_profile_social(uuid)',
    'public.get_referral_program_settings()',
    'public.get_referral_program_settings_v2()',
    'public.join_organizer(text,text)',
    'public.list_claimable_organizer_vouchers()',
    'public.list_my_canonical_certificates()',
    'public.list_my_claimed_collective_history()',
    'public.list_my_competition_dashboard()',
    'public.list_my_participant_core()',
    'public.list_my_shop_vouchers()',
    'public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)',
    'public.list_teacher_collective_participants(uuid)',
    'public.mark_my_shop_vouchers_seen()',
    'public.mark_rpc_healthy(text)',
    'public.provision_collective_registration(uuid)',
    'public.regenerate_collective_participant_password(uuid)',
    'public.register_for_competition(uuid,text,uuid,text,boolean,text,text,text)',
    'public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)',
    'public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)',
    'public.remove_follow(uuid)',
    'public.report_competition_comment(uuid,text)',
    'public.report_rpc_failure(text,text,text)',
    'public.report_system_error(text,text,text,text,jsonb,text,text)',
    'public.resolve_linear_exam_timeout(uuid)',
    'public.respond_follow_request(uuid,boolean)',
    'public.save_linear_exam_draft(uuid,uuid,jsonb)',
    'public.save_my_commerce_product_review(uuid,smallint,text)',
    'public.set_collective_participant_password(uuid,text)',
    'public.skip_linear_exam_question(uuid)',
    'public.start_linear_exam_attempt(uuid)',
    'public.sync_collective_registration_order_payment(uuid)',
    'public.validate_organizer_voucher(text)',
    'public.validate_organizer_voucher(text,text,text)',
    'public.create_collective_certificate_order(uuid)',
    'public.create_product_order(uuid,integer)'
  ] LOOP
    -- The one-argument overload is shadowed by the three-argument overload's
    -- DEFAULT parameters for a positional one-argument call. Resolve its exact
    -- pg_proc identity and verify its issuer guard statically; the three-argument
    -- overload remains covered by the runtime call immediately after this case.
    IF v_signature = 'public.validate_organizer_voucher(text)' THEN
      SELECT p.prosrc
        INTO v_rpc_source
      FROM pg_catalog.pg_proc p
      WHERE p.oid = pg_catalog.to_regprocedure(v_signature);

      IF v_rpc_source IS NULL
         OR pg_catalog.strpos(v_rpc_source, 'private.current_user_is_better_auth()') = 0 THEN
        RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_MISSING:%', v_signature;
      END IF;

      v_count := v_count + 1;
      CONTINUE;
    END IF;

    v_error := pg_temp.stage3_user_rpc_call_error(v_signature);
    IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_NOT_DENIED:%:%', v_signature, coalesce(v_error, '<no error>');
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> 68 THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_TEST_COUNT_MISMATCH:%', v_count;
  END IF;
END;
$all_user_rpc_legacy_issuer$;

DO $legacy_issuer$
DECLARE
  v_count integer;
  v_detail jsonb;
  v_status text;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_READ_ALLOWED'; END IF;

  v_detail := public.get_competition_participant_detail(
    'stage3-public-result-probe',
    '55555555-5555-4555-8555-555555555551'::uuid
  );
  IF jsonb_array_length(coalesce(v_detail->'badges', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_PRIVATE_RESULT_BADGES_ALLOWED';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.sync_competition_registration_status('22222222-2222-4222-8222-222222222222'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED'; END IF;
  -- The private schema intentionally has no USAGE for API roles.
  -- Verify that boundary; exercise its SECURITY DEFINER helpers through
  -- public entrypoints below instead of invoking private functions directly.
  IF has_schema_privilege(current_user, 'private', 'USAGE') THEN
    RAISE EXCEPTION 'STAGE3_PRIVATE_SCHEMA_USAGE_UNEXPECTED';
  END IF;
  IF public.is_active_admin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_IS_ACTIVE_ADMIN_ALLOWED';
  END IF;

  -- Matching a private profile UUID does not make a legacy Supabase Auth
  -- session its Better Auth owner.
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'following');
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_LEGACY_PRIVATE_PROFILE_OWNER_BYPASS'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.get_public_profile_social('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_SOCIAL_SUMMARY_ALLOWED'; END IF;

  -- An old Supabase Auth subject must be rejected before a SECURITY DEFINER
  -- An untrusted issuer cannot inspect an attempt owned by the same UUID.
  v_denied := false;
  BEGIN
    PERFORM public.get_linear_exam_state('ffffffff-ffff-4fff-8fff-fffffffffff4'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_INDIVIDUAL_EXAM_RPC_ALLOWED'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.get_collective_registration_options('ffffffff-ffff-4fff-8fff-fffffffffff5'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_COLLECTIVE_OPTIONS_ALLOWED'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_set_collective_certificate_price(12);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_DIRECT_ADMIN_RPC_ALLOWED';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.get_follow_status(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_GET_FOLLOW_STATUS_ALLOWED'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_diagnose_organizer_voucher_delete(
      'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_DIAGNOSE_ALLOWED'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_evaluate_badges();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_EVALUATE_BADGES_ALLOWED'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_update_system_error_status(
      'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid,
      'resolved',
      'stage3 negative issuer test'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_UPDATE_SYSTEM_ERROR_ALLOWED'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.reopen_system_error_incident(
      'ffffffff-ffff-4fff-8fff-fffffffffff3'::uuid,
      'stage3 negative issuer test'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_REOPEN_SYSTEM_ERROR_ALLOWED'; END IF;

  BEGIN
    INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-insert');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_INSERT_ALLOWED'; END IF;
END;
$legacy_issuer$;

-- User-scoped SECURITY DEFINER RPCs must reject a legacy Supabase Auth
-- subject before reading or changing the subject's application records.
DO $legacy_user_rpc_issuer_gate$
DECLARE
  v_denied boolean;
  v_count integer;
BEGIN
  -- A legacy Supabase Auth issuer cannot use a real active student role
  -- to probe or purchase this active student-audience catalog product.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',TRUE);
  v_denied := false;
  BEGIN
    PERFORM public.create_product_order(
      '77777777-7777-4777-8777-777777777793'::uuid, 1
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:create_product_order';
  END IF;

  -- A legacy issuer also cannot use an existing active organizer-membership
  -- row to read or mutate a question bank.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',TRUE);
  v_denied := false;
  BEGIN
    PERFORM public.save_question_with_options(
      NULL::uuid,
      '77777777-7777-4777-8777-777777777792'::uuid,
      'multiple-choice',
      'Legacy issuer must not add this question',
      1,
      TRUE,
      1,
      'DRAFT',
      '{}'::jsonb,
      '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:save_question_with_options';
  END IF;

  -- Restore the existing legacy Admin fixture for the earlier Admin probes.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',TRUE);

  v_denied := false;
  BEGIN
    PERFORM public.archive_my_order_history('99999999-9999-4999-8999-999999999991'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:archive_my_order_history';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.bulk_import_roster_students('99999999-9999-4999-8999-999999999992'::uuid, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:bulk_import_roster_students';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.cancel_my_pending_order('99999999-9999-4999-8999-999999999993'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:cancel_my_pending_order';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.claim_and_complete_daily_task('99999999-9999-4999-8999-999999999994'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:claim_and_complete_daily_task';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.claim_daily_checkin((pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date, NULL::integer);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:claim_daily_checkin';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.claim_daily_task('99999999-9999-4999-8999-999999999995'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:claim_daily_task';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.claim_organizer_voucher('99999999-9999-4999-8999-999999999996'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:claim_organizer_voucher';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.claim_rpc_recovery('stage3_user_rpc_issuer_probe');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:claim_rpc_recovery';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.complete_daily_task('99999999-9999-4999-8999-999999999997'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:complete_daily_task';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.create_ad_banner_payment_order('99999999-9999-4999-8999-999999999998'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::text, NULL::text, 0);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ISSUER_GUARD_FAILED:create_ad_banner_payment_order';
  END IF;


  -- A Supabase Auth issuer must not inherit private-profile
  -- moderation exceptions after the Better Auth issuer boundary is installed.
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_badge_visibility('ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_PRIVATE_BADGE_VISIBILITY_ALLOWED';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_badges('ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_PRIVATE_BADGES_ALLOWED';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_ui_settings('ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_PRIVATE_UI_SETTINGS_ALLOWED';
  END IF;

  -- Stage 7 Admin/organizer tranche: the same UUID has an active Admin role,
  -- but the legacy Supabase Auth issuer must not authorize any of these RPCs.
  v_denied := false;
  BEGIN
    PERFORM public.admin_adjust_user_currency(
      '99999999-9999-4999-8999-999999999981'::uuid, 'xp', 1, 'Stage 3 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Unauthorized: only admins can adjust currency.' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_adjust_user_currency'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_bulk_adjust_currency(
      ARRAY['99999999-9999-4999-8999-999999999982'::uuid], 'xp', 1, 'Stage 3 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Unauthorized: only admins can bulk adjust currency.' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_bulk_adjust_currency'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_assign_organizer_plan(
      '99999999-9999-4999-8999-999999999983'::uuid,
      'STAGE3_AUDIT_NO_SUCH_PLAN_20261123',
      now(),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_assign_organizer_plan'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_change_username(
      NULL::uuid, 'stage3-issuer-probe', 'Stage 3 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_change_username'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_organizer(
      NULL::uuid, 'Stage 3 issuer probe', 'stage3-issuer-probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_create_organizer'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_create_organizer_payment_method(
      NULL::text, 'TEST', '{}'::jsonb, 0, NULL::text, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_create_organizer_payment_method'; END IF;


  -- Tranche 03: privileged mutation RPCs must deny the same active Admin UUID
  -- when the token issuer is still Supabase Auth.
  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_competition(
      '99999999-9999-4999-8999-999999999971'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_delete_competition'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_force_delete_competition(
      '99999999-9999-4999-8999-999999999972'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_force_delete_competition'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_force_complete_pending_order(
      '99999999-9999-4999-8999-999999999973'::uuid, 'Stage 7 audit probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_force_complete_pending_order'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_review_manual_order(
      '99999999-9999-4999-8999-999999999974'::uuid, 'REJECT', 'Stage 7 audit probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_review_manual_order'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_set_user_role(
      '99999999-9999-4999-8999-999999999975'::uuid,
      'teacher'::public.app_role, true, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_set_user_role'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_set_user_status(
      '99999999-9999-4999-8999-999999999976'::uuid,
      'ACTIVE'::public.user_status, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_set_user_status'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_issue_shop_voucher(
      '99999999-9999-4999-8999-999999999977'::uuid, 'stage7-no-such-user'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_issue_shop_voucher'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_shop_voucher_definition('{"name":""}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_shop_voucher_definition'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_set_comment_moderation(
      NULL::uuid, 'INVALID_STAGE7_STATE', 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_set_comment_moderation'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_update_referral_program_settings(
      NULL::boolean, 100, NULL::integer, NULL::text, NULL::text,
      NULL::timestamptz, NULL::timestamptz
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_update_referral_program_settings'; END IF;


  -- Tranche 04: certificate/award RPCs must reject a legacy issuer before
  -- reading the protected attempt, competition, award or certificate rows.
  v_denied := false;
  BEGIN
    PERFORM public.auto_grade_essay_item(
      '99999999-9999-4999-8999-999999999961'::uuid,
      '99999999-9999-4999-8999-999999999962'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ALLOWED:auto_grade_essay_item'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.generate_awards_for_competition(
      '99999999-9999-4999-8999-999999999963'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ALLOWED:generate_awards_for_competition'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.issue_certificate_for_award(
      '99999999-9999-4999-8999-999999999964'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_USER_RPC_ALLOWED:issue_certificate_for_award'; END IF;

  -- Direct Admin certificate/order functions must also deny the matching
  -- active role when presented with the old Supabase Auth issuer.
  v_denied := false;
  BEGIN
    PERFORM public.admin_set_certificate_status(
      '99999999-9999-4999-8999-999999999965'::uuid,
      'PUBLISHED'::public.certificate_status, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_set_certificate_status'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_transition_certificate(
      '99999999-9999-4999-8999-999999999966'::uuid,
      'PUBLISHED'::public.certificate_status, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_transition_certificate'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_transition_order(
      '99999999-9999-4999-8999-999999999967'::uuid,
      'COMPLETED'::public.order_status, 'Stage 7 issuer probe', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_transition_order'; END IF;


  -- Tranche 05: remaining Admin delete/read RPCs must reject the legacy
  -- Supabase Auth issuer before any row read, delete or diagnostic projection.
  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_organizer_payment_method(
      '99999999-9999-4999-8999-999999999951'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_delete_organizer_payment_method'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_post(
      '99999999-9999-4999-8999-999999999952'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_delete_post'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_product(
      '99999999-9999-4999-8999-999999999953'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_delete_product'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_shop_promo_banner(
      '99999999-9999-4999-8999-999999999954'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_delete_shop_promo_banner'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_get_attempt_investigation(
      '99999999-9999-4999-8999-999999999955'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_get_attempt_investigation'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_get_competition_delete_blockers(
      '99999999-9999-4999-8999-999999999956'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_get_competition_delete_blockers'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_get_monitoring_dashboard(
      NULL::uuid, NULL::text, NULL::text, 25, 0
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_get_monitoring_dashboard'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_list_issued_shop_vouchers();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_list_issued_shop_vouchers'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_list_shop_promo_banners();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_list_shop_promo_banners'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_list_shop_voucher_definitions();
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_list_shop_voucher_definitions'; END IF;


  -- Tranche 06: privileged voucher/plan/referral/content RPCs must deny
  -- the same active Admin UUID under the legacy Supabase Auth issuer.
  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_organizer_voucher(
      '99999999-9999-4999-8999-999999999941'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_ONLY' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_delete_organizer_voucher'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_generate_organizer_vouchers(1, 0);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_generate_organizer_vouchers'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_save_organizer_payment_fields('{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_organizer_payment_fields'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_plan_bundle(
      'INVALID_STAGE7_PLAN', NULL::text, NULL::text, NULL::text,
      NULL::numeric, NULL::numeric, NULL::boolean, '[]'::jsonb,
      NULL::numeric, NULL::numeric
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_plan_bundle'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_upsert_organizer_voucher(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::numeric,
      NULL::text, NULL::integer, NULL::text[], NULL::text[], NULL::integer,
      NULL::timestamptz, NULL::timestamptz, NULL::boolean
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_ONLY' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_upsert_organizer_voucher'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_update_referral_program_settings_v2(
      NULL::boolean, 100, NULL::integer, NULL::text, NULL::text,
      NULL::timestamptz, NULL::timestamptz, '[]'::jsonb, NULL::boolean,
      NULL::text, NULL::text, NULL::text, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_update_referral_program_settings_v2'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_competition(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::public.competition_status,
      NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
      NULL::text, NULL::boolean, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_competition'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_post(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_post'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_product(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text[], NULL::numeric, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_product'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_shop_promo_banner(
      NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::boolean
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ADMIN_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_shop_promo_banner'; END IF;


  -- Tranche 07: final two explicit Admin RPCs must reject the old issuer.
  v_denied := false;
  BEGIN
    PERFORM public.admin_save_organizer_payment_config(
      '{"mode":"MANUAL_TRANSFER","manual":{"bank_name":"LEGACY-PROBE"}}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACCESS_DENIED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_save_organizer_payment_config'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_set_collective_certificate_price(NULL::numeric);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:admin_set_collective_certificate_price'; END IF;


  -- Tranche 08: collective order, organizer serial and certificate asset
  -- RPCs reject the legacy issuer before the first protected row read.
  v_denied := false;
  BEGIN
    PERFORM public.create_collective_certificate_order(
      '99999999-9999-4999-8999-999999999931'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:create_collective_certificate_order'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.assign_organizer_serial(
      '99999999-9999-4999-8999-999999999932'::uuid,
      '99999999-9999-4999-8999-999999999933'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:assign_organizer_serial'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.create_certificate_asset(
      '99999999-9999-4999-8999-999999999934'::uuid,
      'stage7-legacy-probe',
      'https://res.cloudinary.com/stage7/image/upload/legacy-probe.png'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:create_certificate_asset'; END IF;


  -- Tranche 09: collective/teacher/organizer functions reject the old issuer
  -- even when the subject owns a matching synthetic Admin role and roster.
  v_denied := false;
  BEGIN
    PERFORM * FROM public.create_collective_participants(
      '22222222-2222-4222-8222-222222222222'::uuid,
      ARRAY['99999999-9999-4999-8999-999999999982'::uuid]
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:create_collective_participants'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.save_organizer_competition_config(
      '22222222-2222-4222-8222-222222222222'::uuid,
      '{}'::jsonb,
      '{"minimum_participants":0}'::jsonb,
      '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:save_organizer_competition_config'; END IF;

  SELECT count(*) INTO v_count
  FROM public.list_teacher_collective_certificates('22222222-2222-4222-8222-222222222222'::uuid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:list_teacher_collective_certificates';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.list_teacher_achievement_report(
      '22222222-2222-4222-8222-222222222222'::uuid, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:list_teacher_achievement_report'; END IF;

-- Tranche 11: reject legacy Supabase Auth before attempt/competition reads.
  v_denied := false;
  BEGIN
    PERFORM public.finalize_attempt_manual(
      '99999999-9999-4999-8999-999999999991'::uuid,
      1::numeric,
      'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:finalize_attempt_manual'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.get_attempt_grading_limits(
      '99999999-9999-4999-8999-999999999992'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:get_attempt_grading_limits'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.publish_competition_results(
      '99999999-9999-4999-8999-999999999993'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:publish_competition_results'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.release_organizer_competition(
      '99999999-9999-4999-8999-999999999994'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'BETTER_AUTH_ISSUER_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ADMIN_RPC_ALLOWED:release_organizer_competition'; END IF;


END;
$legacy_user_rpc_issuer_gate$;


-- Better Auth issuer is also valid and still sees only its own UUID.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $all_user_rpc_better_auth_issuer$
DECLARE
  v_signature text;
  v_error text;
  v_count integer := 0;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)',
    'public.archive_my_order_history(uuid)',
    'public.bulk_import_roster_students(uuid,jsonb)',
    'public.cancel_my_pending_order(uuid)',
    'public.choose_linear_exam_timeout(uuid,text)',
    'public.claim_and_complete_daily_task(uuid)',
    'public.claim_collective_participant(text,text)',
    'public.claim_daily_checkin(date,integer)',
    'public.claim_daily_task(uuid)',
    'public.claim_organizer_voucher(uuid)',
    'public.claim_rpc_recovery(text)',
    'public.complete_daily_task(uuid)',
    'public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)',
    'public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)',
    'public.create_follow_request(uuid)',
    'public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])',
    'public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])',
    'public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])',
    'public.ensure_referral_code()',
    'public.get_collective_registration(uuid)',
    'public.get_collective_registration_options(uuid)',
    'public.get_daily_checkin_streak_rewards(date)',
    'public.get_follow_status(uuid,uuid)',
    'public.get_linear_exam_state(uuid)',
    'public.get_my_canonical_competition_result(uuid)',
    'public.get_my_canonical_participant(uuid)',
    'public.get_my_learning_insights()',
    'public.get_my_referral_tier_awards()',
    'public.get_my_referrals()',
    'public.get_my_referrals_v2()',
    'public.get_my_verified_referrals()',
    'public.get_organizer_exam_preview_report(uuid)',
    'public.get_organizer_payment_config()',
    'public.get_public_profile_social(uuid)',
    'public.get_referral_program_settings()',
    'public.get_referral_program_settings_v2()',
    'public.join_organizer(text,text)',
    'public.list_claimable_organizer_vouchers()',
    'public.list_my_canonical_certificates()',
    'public.list_my_claimed_collective_history()',
    'public.list_my_competition_dashboard()',
    'public.list_my_participant_core()',
    'public.list_my_shop_vouchers()',
    'public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)',
    'public.list_teacher_collective_participants(uuid)',
    'public.mark_my_shop_vouchers_seen()',
    'public.mark_rpc_healthy(text)',
    'public.provision_collective_registration(uuid)',
    'public.regenerate_collective_participant_password(uuid)',
    'public.register_for_competition(uuid,text,uuid,text,boolean,text,text,text)',
    'public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)',
    'public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)',
    'public.remove_follow(uuid)',
    'public.report_competition_comment(uuid,text)',
    'public.report_rpc_failure(text,text,text)',
    'public.report_system_error(text,text,text,text,jsonb,text,text)',
    'public.resolve_linear_exam_timeout(uuid)',
    'public.respond_follow_request(uuid,boolean)',
    'public.save_linear_exam_draft(uuid,uuid,jsonb)',
    'public.save_my_commerce_product_review(uuid,smallint,text)',
    'public.set_collective_participant_password(uuid,text)',
    'public.skip_linear_exam_question(uuid)',
    'public.start_linear_exam_attempt(uuid)',
    'public.sync_collective_registration_order_payment(uuid)',
    'public.validate_organizer_voucher(text)',
    'public.validate_organizer_voucher(text,text,text)',
    'public.create_collective_certificate_order(uuid)',
    'public.create_product_order(uuid,integer)'
  ] LOOP
    v_error := pg_temp.stage3_user_rpc_call_error(v_signature);
    IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_REJECTED:%', v_signature;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count <> 68 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_TEST_COUNT_MISMATCH:%', v_count;
  END IF;
END;
$all_user_rpc_better_auth_issuer$;

DO $better_auth_issuer$
DECLARE
  v_count integer;
  v_result jsonb;
  v_status text;
  v_exam_denied boolean := false;
  v_options jsonb;
  v_order public.orders;
  v_question public.questions;
  v_option_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED'; END IF;
  IF has_schema_privilege(current_user, 'private', 'USAGE') THEN
    RAISE EXCEPTION 'STAGE3_PRIVATE_SCHEMA_USAGE_UNEXPECTED';
  END IF;
  IF NOT public.is_active_admin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED';
  END IF;

  -- A non-Admin Better Auth student with the matching active role may buy
  -- the student-audience product. The enclosing transaction rolls back order,
  -- order_items, and audit rows after this end-to-end check.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',TRUE);
  v_order := public.create_product_order(
    '77777777-7777-4777-8777-777777777793'::uuid,
    2
  );
  IF v_order.user_id <> 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
     OR v_order.status <> 'DRAFT'
     OR v_order.total <> 2500 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_STUDENT_PRODUCT_ORDER_FAILED:%',v_order;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.order_items
  WHERE order_id = v_order.id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_STUDENT_PRODUCT_ORDER_ITEMS_FAILED:%',v_count;
  END IF;

  -- An active organizer member without an Admin role may create a question
  -- in their own bank. A foreign-bank question ID must not be movable into it.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',TRUE);
  v_question := public.save_question_with_options(
    NULL::uuid,
    '77777777-7777-4777-8777-777777777792'::uuid,
    'multiple-choice',
    'Stage 7 owner-scoped question creation',
    1,
    TRUE,
    1,
    'DRAFT',
    '{}'::jsonb,
    '[
      {"label":"A","value":"stage7-own-A","is_correct":true,"display_order":1},
      {"label":"B","value":"stage7-own-B","is_correct":false,"display_order":2},
      {"label":"C","value":"stage7-own-C","is_correct":false,"display_order":3}
    ]'::jsonb
  );
  IF v_question.question_bank_id <> '77777777-7777-4777-8777-777777777792'::uuid THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_QUESTION_BANK_OWNERSHIP_FAILED:%',v_question;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.question_options
  WHERE question_id = v_question.id;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_QUESTION_OPTIONS_FAILED:%',v_count;
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.save_question_with_options(
      '77777777-7777-4777-8777-777777777797'::uuid,
      '77777777-7777-4777-8777-777777777792'::uuid,
      'multiple-choice',
      'Attempt to move a question from another organizer',
      1,
      TRUE,
      2,
      'DRAFT',
      '{}'::jsonb,
      '[
        {"label":"A","value":"stage7-foreign-A","is_correct":true,"display_order":1},
        {"label":"B","value":"stage7-foreign-B","is_correct":false,"display_order":2},
        {"label":"C","value":"stage7-foreign-C","is_correct":false,"display_order":3}
      ]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'QUESTION_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_QUESTION_CROSS_BANK_UPDATE_ALLOWED';
  END IF;

    -- The unrelated/foreign bank must remain invisible to the organizer caller.
  -- Switch to the synthetic Better Auth Admin only for integrity inspection;
  -- this prevents RLS visibility from making an unchanged row look deleted.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',TRUE);

SELECT count(*) INTO v_count
  FROM public.questions
  WHERE id = '77777777-7777-4777-8777-777777777797'::uuid
    AND question_bank_id = '77777777-7777-4777-8777-777777777796'::uuid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_FOREIGN_QUESTION_BANK_CHANGED';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.question_options
  WHERE question_id = '77777777-7777-4777-8777-777777777797'::uuid
    AND value = 'foreign-existing-option';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_FOREIGN_QUESTION_OPTIONS_CHANGED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_teacher_collective_certificates('22222222-2222-4222-8222-222222222222'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:list_teacher_collective_certificates:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_teacher_achievement_report('22222222-2222-4222-8222-222222222222'::uuid, NULL::text);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:list_teacher_achievement_report:%', v_count;
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.save_organizer_competition_config(
      '22222222-2222-4222-8222-222222222222'::uuid,
      '{}'::jsonb,
      '{"minimum_participants":0}'::jsonb,
      '[]'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'MINIMUM_PARTICIPANTS_INVALID' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:save_organizer_competition_config';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.create_collective_participants(
    '22222222-2222-4222-8222-222222222222'::uuid,
    ARRAY['99999999-9999-4999-8999-999999999982'::uuid]
  );
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:create_collective_participants:%', v_count;
  END IF;


  -- This UUID is an existing synthetic fixture from the trusted-issuer RLS
  -- regression. The Better Auth Admin must pass the owner/Admin lookup and
  -- stop at the deliberately unconfigured collective certificate price;
  -- no payment order or downstream row is created.
  v_exam_denied := false;
  BEGIN
    PERFORM public.create_collective_certificate_order(
      '99999999-9999-4999-8999-999999999931'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'CERTIFICATE_PRICE_NOT_CONFIGURED' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:create_collective_certificate_order';
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.assign_organizer_serial(
      '99999999-9999-4999-8999-999999999932'::uuid,
      '99999999-9999-4999-8999-999999999933'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'SERIAL_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:assign_organizer_serial';
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.create_certificate_asset(
      '99999999-9999-4999-8999-999999999934'::uuid,
      'stage7-better-auth-probe',
      'https://res.cloudinary.com/stage7/image/upload/better-auth-probe.png'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'CERTIFICATE_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:create_certificate_asset';
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_set_collective_certificate_price(NULL::numeric);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_AMOUNT' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_set_collective_certificate_price';
  END IF;

  -- This RPC writes a global setting and an audit row. Force an exception
  -- after verifying its normalized return value so the PL/pgSQL exception
  -- subtransaction rolls both writes back immediately.
  v_exam_denied := false;
  BEGIN
    v_result := public.admin_save_organizer_payment_config(
      '{"mode":"MANUAL_TRANSFER","manual":{"bank_name":"STAGE7-DISPOSABLE","account_number":"000000","account_name":"ROLLBACK ONLY","instructions":"Synthetic rollback-only probe"}}'::jsonb
    );
    IF v_result #>> '{mode}' IS DISTINCT FROM 'MANUAL_TRANSFER'
       OR v_result #>> '{manual,bank_name}' IS DISTINCT FROM 'STAGE7-DISPOSABLE'
       OR v_result #>> '{manual,account_number}' IS DISTINCT FROM '000000' THEN
      RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_RESULT_INVALID:admin_save_organizer_payment_config:%', v_result;
    END IF;
    RAISE EXCEPTION 'STAGE3_ADMIN_PAYMENT_CONFIG_ROLLBACK_SENTINEL';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'STAGE3_ADMIN_PAYMENT_CONFIG_ROLLBACK_SENTINEL' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_organizer_payment_config';
  END IF;

  -- The valid Better Auth Admin can execute the scoped Admin/social RPCs.
  v_result := public.admin_diagnose_organizer_voucher_delete(
    'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid
  );
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_DIAGNOSE_RPC_FAILED:%', v_result;
  END IF;

  PERFORM public.admin_evaluate_badges();

  -- A verified Better Auth Admin keeps the intended private-profile
  -- moderation projections, including private targets with hidden popups.
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_badge_visibility('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_PRIVATE_BADGE_VISIBILITY_FAILED:%', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_badges('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_PRIVATE_BADGES_FAILED:%', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_ui_settings('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_PRIVATE_UI_SETTINGS_FAILED:%', v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_social('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_PRIVATE_SOCIAL_FAILED:%', v_count;
  END IF;


  v_result := NULL;
  BEGIN
    v_result := public.admin_update_system_error_status(
      'ffffffff-ffff-4fff-8fff-fffffffffff2'::uuid,
      'resolved',
      'stage3 positive admin test'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INCIDENT_NOT_FOUND' THEN RAISE; END IF;
  END;
  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_UPDATE_SYSTEM_ERROR_UNEXPECTED_RESULT:%', v_result;
  END IF;

  v_result := NULL;
  BEGIN
    v_result := public.reopen_system_error_incident(
      'ffffffff-ffff-4fff-8fff-fffffffffff3'::uuid,
      'stage3 positive admin test'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'INCIDENT_NOT_FOUND' THEN RAISE; END IF;
  END;
  IF v_result IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REOPEN_SYSTEM_ERROR_UNEXPECTED_RESULT:%', v_result;
  END IF;

  v_status := public.get_follow_status(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  );
  IF v_status IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_GET_FOLLOW_STATUS_FAILED:%', v_status;
  END IF;

  -- A valid Better Auth identity passes the shared issuer gate before the
  -- missing-attempt check; use an impossible UUID so no business row is read
  -- or changed in this positive boundary probe.
  BEGIN
    PERFORM public.get_linear_exam_state('ffffffff-ffff-4fff-8fff-fffffffffff4'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ATTEMPT_NOT_FOUND' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_INDIVIDUAL_EXAM_ISSUER_GATE_FAILED';
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.get_collective_registration_options('ffffffff-ffff-4fff-8fff-fffffffffff5'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_COLLECTIVE_OPTIONS_ISSUER_GATE_FAILED';
  END IF;

  v_options := public.get_collective_registration_options('22222222-2222-4222-8222-222222222222'::uuid);
  IF v_options #>> '{competition,title}' IS DISTINCT FROM 'Stage 3 Private Collective Probe' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_PRIVATE_COLLECTIVE_OPTIONS_FAILED:%', v_options;
  END IF;

  v_status := public.sync_competition_registration_status('22222222-2222-4222-8222-222222222222'::uuid);
  IF v_status IS DISTINCT FROM 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_PRIVATE_STATUS_SYNC_FAILED:%', v_status;
  END IF;

  -- A verified Better Auth owner may read their own private/hidden connections
  -- and social summary; the same session may see public social summaries.
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'following');
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PRIVATE_OWNER_CONNECTIONS_FAILED:%', v_count; END IF;
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'followers');
  IF v_count <> 2 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PRIVATE_OWNER_FOLLOWERS_FAILED:%', v_count; END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_social('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid);
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PRIVATE_OWNER_SOCIAL_FAILED:%', v_count; END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_social('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid);
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PUBLIC_SOCIAL_FAILED:%', v_count; END IF;

  -- Each Admin RPC must accept the exact Better Auth issuer and proceed to
  -- its next business validation. Inputs deliberately cause no row writes.
  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_adjust_user_currency(
      '99999999-9999-4999-8999-999999999981'::uuid, 'xp', 1, 'Stage 3 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'User not found:%' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_adjust_user_currency'; END IF;

  v_result := public.admin_bulk_adjust_currency(
    ARRAY['99999999-9999-4999-8999-999999999982'::uuid], 'xp', 1, 'Stage 3 issuer probe'
  );
  IF v_result ->> 'success' IS DISTINCT FROM '0'
     OR v_result ->> 'failed' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_bulk_adjust_currency:%', v_result;
  END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_assign_organizer_plan(
      '99999999-9999-4999-8999-999999999983'::uuid,
      'STAGE3_AUDIT_NO_SUCH_PLAN_20261123',
      now(),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PLAN_NOT_AVAILABLE' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_assign_organizer_plan'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_change_username(
      NULL::uuid, 'stage3-issuer-probe', 'Stage 3 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'USER_ID_REQUIRED' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_change_username'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_create_organizer(
      NULL::uuid, 'Stage 3 issuer probe', 'stage3-issuer-probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'OWNER_REQUIRED' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_create_organizer'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_create_organizer_payment_method(
      NULL::text, 'TEST', '{}'::jsonb, 0, NULL::text, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PAYMENT_METHOD_NAME_REQUIRED' THEN
      v_exam_denied := true;
    ELSE
      RAISE;
    END IF;
  END;

  -- Under the exact Better Auth issuer each Admin mutation must pass the
  -- shared Admin guard and stop at a deliberate no-write business boundary.
  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_delete_competition(
      '99999999-9999-4999-8999-999999999971'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_delete_competition'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_force_delete_competition(
      '99999999-9999-4999-8999-999999999972'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_force_delete_competition'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_force_complete_pending_order(
      '99999999-9999-4999-8999-999999999973'::uuid, 'Stage 7 audit probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ORDER_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_force_complete_pending_order'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_review_manual_order(
      '99999999-9999-4999-8999-999999999974'::uuid, 'REJECT', 'Stage 7 audit probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ORDER_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_review_manual_order'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_set_user_role(
      '99999999-9999-4999-8999-999999999975'::uuid,
      'teacher'::public.app_role, true, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_exam_denied := true;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_set_user_role'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_set_user_status(
      '99999999-9999-4999-8999-999999999976'::uuid,
      'ACTIVE'::public.user_status, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'USER_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_set_user_status'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_issue_shop_voucher(
      '99999999-9999-4999-8999-999999999977'::uuid, 'stage7-no-such-user'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'VOUCHER_DEFINITION_NOT_AVAILABLE' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_issue_shop_voucher'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_save_shop_voucher_definition('{"name":""}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'VOUCHER_NAME_REQUIRED' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_shop_voucher_definition'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_set_comment_moderation(
      NULL::uuid, 'INVALID_STAGE7_STATE', 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_STATE' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_set_comment_moderation'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_update_referral_program_settings(
      NULL::boolean, 100, NULL::integer, NULL::text, NULL::text,
      NULL::timestamptz, NULL::timestamptz
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACTIVE_FLAG_REQUIRED' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_update_referral_program_settings'; END IF;

  -- Tranche 04: valid Better Auth issuer passes the identity gate, then
  -- reaches not-found business validation without any fixture-row writes.
  v_exam_denied := false;
  BEGIN
    PERFORM public.auto_grade_essay_item(
      '99999999-9999-4999-8999-999999999961'::uuid,
      '99999999-9999-4999-8999-999999999962'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ATTEMPT_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_ISSUER_GATE_FAILED:auto_grade_essay_item'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.generate_awards_for_competition(
      '99999999-9999-4999-8999-999999999963'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_ISSUER_GATE_FAILED:generate_awards_for_competition'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.issue_certificate_for_award(
      '99999999-9999-4999-8999-999999999964'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'AWARD_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_ISSUER_GATE_FAILED:issue_certificate_for_award'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_set_certificate_status(
      '99999999-9999-4999-8999-999999999965'::uuid,
      'PUBLISHED'::public.certificate_status, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'CERTIFICATE_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_set_certificate_status'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_transition_certificate(
      '99999999-9999-4999-8999-999999999966'::uuid,
      'PUBLISHED'::public.certificate_status, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'CERTIFICATE_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_transition_certificate'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.admin_transition_order(
      '99999999-9999-4999-8999-999999999967'::uuid,
      'COMPLETED'::public.order_status, 'Stage 7 issuer probe', NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ORDER_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_transition_order'; END IF;


  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_create_organizer_payment_method'; END IF;


  INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'better-auth-insert');

-- Exact Better Auth Admin reaches the scoped first lookup; all synthetic
  -- UUIDs are absent, so none of these calls performs a business mutation.
  v_exam_denied := false;
  BEGIN
    PERFORM public.finalize_attempt_manual(
      '99999999-9999-4999-8999-999999999991'::uuid,
      1::numeric,
      'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ATTEMPT_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:finalize_attempt_manual'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM * FROM public.get_attempt_grading_limits(
      '99999999-9999-4999-8999-999999999992'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ATTEMPT_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:get_attempt_grading_limits'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.publish_competition_results(
      '99999999-9999-4999-8999-999999999993'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:publish_competition_results'; END IF;

  v_exam_denied := false;
  BEGIN
    PERFORM public.release_organizer_competition(
      '99999999-9999-4999-8999-999999999994'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN v_exam_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_exam_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:release_organizer_competition'; END IF;

END;
$better_auth_issuer$;

-- Tranche 05 positive Admin tests execute only against the schema-only
-- disposable restore. Missing synthetic IDs stop delete RPCs before mutation;
-- read RPCs return only their normal shape/empty projections.
DO $stage7_more_admin_positive$
DECLARE
  v_count integer;
  v_result jsonb;
  v_deleted boolean;
BEGIN
  BEGIN
    PERFORM public.admin_delete_organizer_payment_method(
      '99999999-9999-4999-8999-999999999951'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PAYMENT_METHOD_NOT_FOUND' THEN
      v_count := 1;
    ELSE
      RAISE;
    END IF;
  END;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_delete_organizer_payment_method';
  END IF;

  v_count := 0;
  BEGIN
    PERFORM public.admin_delete_post(
      '99999999-9999-4999-8999-999999999952'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'POST_NOT_FOUND' THEN v_count := 1; ELSE RAISE; END IF;
  END;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_delete_post';
  END IF;

  v_count := 0;
  BEGIN
    PERFORM public.admin_delete_product(
      '99999999-9999-4999-8999-999999999953'::uuid, 'Stage 7 issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PRODUCT_NOT_FOUND' THEN v_count := 1; ELSE RAISE; END IF;
  END;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_delete_product';
  END IF;

  v_deleted := public.admin_delete_shop_promo_banner(
    '99999999-9999-4999-8999-999999999954'::uuid
  );
  IF v_deleted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_delete_shop_promo_banner';
  END IF;

  v_count := 0;
  BEGIN
    v_result := public.admin_get_attempt_investigation(
      '99999999-9999-4999-8999-999999999955'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ATTEMPT_NOT_FOUND' THEN v_count := 1; ELSE RAISE; END IF;
  END;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_get_attempt_investigation';
  END IF;

  v_count := 0;
  BEGIN
    v_result := public.admin_get_competition_delete_blockers(
      '99999999-9999-4999-8999-999999999956'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN v_count := 1; ELSE RAISE; END IF;
  END;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_get_competition_delete_blockers';
  END IF;

  v_result := public.admin_get_monitoring_dashboard(
    NULL::uuid, NULL::text, NULL::text, 25, 0
  );
  IF jsonb_typeof(v_result) IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result -> 'summary') IS DISTINCT FROM 'object'
     OR jsonb_typeof(v_result -> 'attempts') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_result -> 'competitions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_get_monitoring_dashboard';
  END IF;

  SELECT count(*) INTO v_count FROM public.admin_list_issued_shop_vouchers();
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_list_issued_shop_vouchers';
  END IF;

  SELECT count(*) INTO v_count FROM public.admin_list_shop_promo_banners();
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_list_shop_promo_banners';
  END IF;

  SELECT count(*) INTO v_count FROM public.admin_list_shop_voucher_definitions();
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_list_shop_voucher_definitions';
  END IF;
END;
$stage7_more_admin_positive$;

-- Tranche 06 positive Admin tests stop at validation errors before inserts,
-- deletes, settings upserts, or downstream reward/Realtime side effects.
DO $stage7_admin_mutation_validation_positive$
DECLARE
  v_denied boolean;
BEGIN
  v_denied := false;
  BEGIN
    PERFORM public.admin_delete_organizer_voucher(
      '99999999-9999-4999-8999-999999999941'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'VOUCHER_NOT_FOUND' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_delete_organizer_voucher'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_generate_organizer_vouchers(1, 0);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_DISCOUNT_PERCENT' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_generate_organizer_vouchers'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_save_organizer_payment_fields('{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_FIELDS_PAYLOAD' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_organizer_payment_fields'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_plan_bundle(
      'INVALID_STAGE7_PLAN', NULL::text, NULL::text, NULL::text,
      NULL::numeric, NULL::numeric, NULL::boolean, '[]'::jsonb,
      NULL::numeric, NULL::numeric
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_PLAN_CODE' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_plan_bundle'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_upsert_organizer_voucher(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::numeric,
      NULL::text, NULL::integer, NULL::text[], NULL::text[], NULL::integer,
      NULL::timestamptz, NULL::timestamptz, NULL::boolean
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TITLE_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_upsert_organizer_voucher'; END IF;

  v_denied := false;
  BEGIN
    PERFORM * FROM public.admin_update_referral_program_settings_v2(
      NULL::boolean, 100, NULL::integer, NULL::text, NULL::text,
      NULL::timestamptz, NULL::timestamptz, '[]'::jsonb, NULL::boolean,
      NULL::text, NULL::text, NULL::text, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ACTIVE_FLAG_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_update_referral_program_settings_v2'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_competition(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text, NULL::public.competition_status,
      NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz,
      NULL::text, NULL::boolean, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TITLE_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_competition'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_post(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::uuid, NULL::text
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TITLE_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_post'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_product(
      NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text,
      NULL::text, NULL::text, NULL::text[], NULL::numeric, NULL::text,
      NULL::text, NULL::boolean, NULL::boolean, NULL::integer, NULL::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'NAME_REQUIRED' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_product'; END IF;

  v_denied := false;
  BEGIN
    PERFORM public.admin_save_shop_promo_banner(
      NULL::uuid, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::boolean
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'INVALID_BANNER_IMAGE_URL' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_RPC_ISSUER_GATE_FAILED:admin_save_shop_promo_banner'; END IF;
END;
$stage7_admin_mutation_validation_positive$;

-- The same user-scoped RPCs must accept the exact Better Auth issuer and
-- continue into their existing business validation/ownership checks.
-- A business error or a successful no-op is expected; the issuer gate itself
-- must not reject a projected Better Auth identity.
DO $better_auth_user_rpc_issuer_gate$
DECLARE
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.archive_my_order_history('99999999-9999-4999-8999-999999999991'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:archive_my_order_history';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.bulk_import_roster_students('99999999-9999-4999-8999-999999999992'::uuid, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:bulk_import_roster_students';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.cancel_my_pending_order('99999999-9999-4999-8999-999999999993'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:cancel_my_pending_order';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.claim_and_complete_daily_task('99999999-9999-4999-8999-999999999994'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:claim_and_complete_daily_task';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.claim_daily_checkin((pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date, NULL::integer);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:claim_daily_checkin';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.claim_daily_task('99999999-9999-4999-8999-999999999995'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:claim_daily_task';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.claim_organizer_voucher('99999999-9999-4999-8999-999999999996'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:claim_organizer_voucher';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.claim_rpc_recovery('stage3_user_rpc_issuer_probe');
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:claim_rpc_recovery';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.complete_daily_task('99999999-9999-4999-8999-999999999997'::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:complete_daily_task';
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.create_ad_banner_payment_order('99999999-9999-4999-8999-999999999998'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::text, NULL::text, 0);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error = 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_USER_RPC_WRONGLY_REJECTED:create_ad_banner_payment_order';
  END IF;

END;
$better_auth_user_rpc_issuer_gate$;


-- A different Better Auth identity may see public profile social projections,
-- but must not inspect another user's private connection list or summary.
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
DO $better_auth_other_user$
DECLARE
  v_count integer;
  v_options jsonb;
  v_detail jsonb;
  v_status text;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid, 'following');
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PRIVATE_CONNECTIONS_ALLOWED'; END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_social('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid);
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PRIVATE_SOCIAL_ALLOWED'; END IF;
  SELECT count(*) INTO v_count
  FROM public.get_public_profile_social('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid);
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PUBLIC_SOCIAL_FAILED:%', v_count; END IF;

  v_denied := false;
  BEGIN
    v_options := public.get_collective_registration_options('22222222-2222-4222-8222-222222222222'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PRIVATE_COLLECTIVE_OPTIONS_ALLOWED';
  END IF;

  v_denied := false;
  BEGIN
    PERFORM public.sync_competition_registration_status('22222222-2222-4222-8222-222222222222'::uuid);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'COMPETITION_NOT_FOUND' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PRIVATE_COMPETITION_STATUS_SYNC_ALLOWED'; END IF;

  v_status := public.sync_competition_registration_status('11111111-1111-4111-8111-111111111111'::uuid);
  IF v_status IS DISTINCT FROM 'REGISTRATION_OPEN' THEN
    RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PUBLIC_STATUS_SYNC_FAILED:%', v_status;
  END IF;

  v_detail := public.get_competition_participant_detail(
    'stage3-public-result-probe',
    '55555555-5555-4555-8555-555555555552'::uuid
  );
  IF jsonb_array_length(coalesce(v_detail->'badges', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PRIVATE_RESULT_BADGES_ALLOWED';
  END IF;

  v_options := public.get_collective_registration_options('11111111-1111-4111-8111-111111111111'::uuid);
  IF v_options #>> '{competition,title}' IS DISTINCT FROM 'Stage 3 Public Collective Probe' THEN
    RAISE EXCEPTION 'STAGE3_OTHER_BETTER_AUTH_PUBLIC_COLLECTIVE_OPTIONS_FAILED:%', v_options;
  END IF;
END;
$better_auth_other_user$;

-- The Better Auth owner of a private profile may see their own badge
-- collection within a published public results page.
SELECT set_config('request.jwt.claims',
  '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'ffffffff-ffff-4fff-8fff-fffffffffff6', true);
DO $better_auth_private_badge_owner$
DECLARE
  v_detail jsonb;
BEGIN
  v_detail := public.get_competition_participant_detail(
    'stage3-public-result-probe',
    '55555555-5555-4555-8555-555555555552'::uuid
  );
  IF jsonb_array_length(coalesce(v_detail->'badges', '[]'::jsonb)) <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PRIVATE_RESULT_BADGE_OWNER_FAILED:%', v_detail;
  END IF;
END;
$better_auth_private_badge_owner$;

-- A syntactically valid UUID from an untrusted issuer receives no row access
-- and cannot insert even when its sub matches a real owner UUID.
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","iss":"https://attacker.invalid"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $untrusted_issuer$
DECLARE
  v_count integer;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_UNTRUSTED_ISSUER_READ_ALLOWED'; END IF;
  BEGIN
    INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'untrusted-insert');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_UNTRUSTED_ISSUER_INSERT_ALLOWED'; END IF;
END;
$untrusted_issuer$;

-- Stage 7 tranche 11 organizer-owner positive tests: all four guarded RPCs
-- must accept a real Better Auth organizer membership, then stop at safe
-- business boundaries without publishing, releasing, or grading any row.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  TRUE
);
DO $stage7_tranche11_organizer_positive$
DECLARE
  v_error text;
  v_result jsonb;
  v_row_count integer;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.finalize_attempt_manual(
      '77777777-7777-4777-8777-777777777781'::uuid,
      1::numeric,
      'Stage 7 organizer authorization probe'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_FINALIZABLE' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ORGANIZER_RPC_SCOPE_FAILED:finalize_attempt_manual:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  SELECT count(*)::integer
  INTO v_row_count
  FROM public.get_attempt_grading_limits(
    '77777777-7777-4777-8777-777777777782'::uuid
  );
  -- An empty grading projection is valid for this fixture; reaching the
  -- function result proves the organizer-scoped attempt lookup succeeded.

  v_result := public.publish_competition_results(
    '44444444-4444-4444-8444-444444444441'::uuid
  );
  IF v_result ->> 'already_published' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ORGANIZER_RPC_SCOPE_FAILED:publish_competition_results:%',
      v_result;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.release_organizer_competition(
      '44444444-4444-4444-8444-444444444441'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COMPETITION_NOT_DRAFT' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ORGANIZER_RPC_SCOPE_FAILED:release_organizer_competition:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche11_organizer_positive$;

-- A different Better Auth student has no membership in this organizer. The
-- same existing protected UUIDs must be indistinguishable from absent rows.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  TRUE
);
DO $stage7_tranche11_unrelated_user$
DECLARE
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.finalize_attempt_manual(
      '77777777-7777-4777-8777-777777777781'::uuid,
      1::numeric,
      'Stage 7 unrelated Better Auth user probe'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_OUTSIDER_RPC_SCOPE_FAILED:finalize_attempt_manual:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.get_attempt_grading_limits(
      '77777777-7777-4777-8777-777777777782'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_OUTSIDER_RPC_SCOPE_FAILED:get_attempt_grading_limits:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.publish_competition_results(
      '44444444-4444-4444-8444-444444444441'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COMPETITION_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_OUTSIDER_RPC_SCOPE_FAILED:publish_competition_results:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.release_organizer_competition(
      '44444444-4444-4444-8444-444444444441'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COMPETITION_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_OUTSIDER_RPC_SCOPE_FAILED:release_organizer_competition:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche11_unrelated_user$;


-- Stage 7 tranche 12: canonical competition result RPCs must reject legacy
-- issuers before participant reads, retain owner/Admin access, deny IDOR, and
-- withhold attempt score/rank until official result publication.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'ffffffff-ffff-4fff-8fff-fffffffffff6',
  TRUE
);
DO $stage7_tranche12_legacy_issuer$
DECLARE
  v_error text;
BEGIN
  v_error := pg_temp.stage3_user_rpc_call_error(
    'public.get_canonical_competition_result(uuid)'
  );
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_LEGACY_DIRECT_RESULT_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := pg_temp.stage3_user_rpc_call_error(
    'public.get_my_canonical_competition_result(uuid)'
  );
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_LEGACY_MY_RESULT_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche12_legacy_issuer$;

-- The real Better Auth participant can read their own published result through
-- the frontend wrapper and direct RPC; the same score remains hidden before
-- publication even for the same valid owner identity.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'ffffffff-ffff-4fff-8fff-fffffffffff6',
  TRUE
);
DO $stage7_tranche12_participant_positive$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_my_canonical_competition_result(
    '33333333-3333-4333-8333-333333333333'::uuid
  );
  IF v_result ->> 'participant_id' IS DISTINCT FROM
     '55555555-5555-4555-8555-555555555552'
     OR v_result #>> '{attempt,score}' IS DISTINCT FROM '92'
     OR v_result ->> 'published' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_MY_PUBLISHED_RESULT_FAILED:%', v_result;
  END IF;

  v_result := public.get_canonical_competition_result(
    '55555555-5555-4555-8555-555555555552'::uuid
  );
  IF v_result #>> '{attempt,score}' IS DISTINCT FROM '92'
     OR v_result ->> 'published' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_DIRECT_OWNER_RESULT_FAILED:%', v_result;
  END IF;

  v_result := public.get_canonical_competition_result(
    '55555555-5555-4555-8555-555555555553'::uuid
  );
  IF v_result ->> 'published' IS DISTINCT FROM 'false'
     OR v_result -> 'attempt' IS DISTINCT FROM 'null'::jsonb
     OR v_result ->> 'rank' IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_UNPUBLISHED_SCORE_LEAK:%', v_result;
  END IF;
END;
$stage7_tranche12_participant_positive$;

-- A valid Better Auth student cannot read another participant's private result.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  TRUE
);
DO $stage7_tranche12_unrelated_user$
DECLARE
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_canonical_competition_result(
      '55555555-5555-4555-8555-555555555552'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_CROSS_PARTICIPANT_RESULT_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_canonical_competition_result(
      current_setting('stage7.tranche12.canonical_participant_id')::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_COLLECTIVE_IDOR_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche12_unrelated_user$;

-- Admin access remains available through the issuer-gated Admin helper.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);
DO $stage7_tranche12_admin_positive$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.get_canonical_competition_result(
    '55555555-5555-4555-8555-555555555552'::uuid
  );
  IF v_result #>> '{attempt,score}' IS DISTINCT FROM '92'
     OR v_result ->> 'published' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_ADMIN_RESULT_FAILED:%', v_result;
  END IF;
END;
$stage7_tranche12_admin_positive$;

-- A non-Admin Better Auth teacher who manages a collective roster may read
-- the official result for that collective participant, but not another user's.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'ffffffff-ffff-4fff-8fff-fffffffffff6',
  TRUE
);
DO $stage7_tranche12_collective_manager_positive$
DECLARE
  v_canonical_participant_id uuid;
  v_result jsonb;
BEGIN
  SELECT id INTO v_canonical_participant_id
  FROM public.participants
  WHERE collective_participant_id = '66666666-6666-4666-8666-666666666682'::uuid;

  IF v_canonical_participant_id IS NULL THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_COLLECTIVE_CANONICAL_PARTICIPANT_MISSING';
  END IF;

  v_result := public.get_canonical_competition_result(v_canonical_participant_id);
  IF v_result ->> 'participant_type' IS DISTINCT FROM 'COLLECTIVE'
     OR v_result #>> '{attempt,score}' IS DISTINCT FROM '87'
     OR v_result ->> 'published' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE12_COLLECTIVE_OWNER_RESULT_FAILED:%', v_result;
  END IF;
END;
$stage7_tranche12_collective_manager_positive$;


-- Stage 7 tranche 13: Admin/organizer entitlement reads and currency logs.
-- The fixture has no imported auth.users or currency-log rows, so the tests
-- assert caller authorization, owner scoping and successful valid paths while
-- keeping all state inside this outer rollback-only transaction.
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  TRUE
);

DO $stage7_tranche13_legacy_issuer$
DECLARE
  v_count integer;
  v_error text;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.get_all_currency_logs(100);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_LEGACY_ALL_CURRENCY_LOGS_LEAKED:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.get_user_currency_logs(auth.uid(), 50);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_LEGACY_SELF_CURRENCY_LOGS_LEAKED:%', v_count;
  END IF;

  v_error := pg_temp.stage3_user_rpc_call_error(
    'public.get_active_organizer_entitlements(uuid)'
  );
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_LEGACY_ENTITLEMENTS_ALLOWED:%',
      COALESCE(v_error, 'NO_ERROR');
  END IF;

  v_error := pg_temp.stage3_user_rpc_call_error(
    'public.get_organizer_effective_plan(uuid)'
  );
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_LEGACY_EFFECTIVE_PLAN_ALLOWED:%',
      COALESCE(v_error, 'NO_ERROR');
  END IF;

  v_error := pg_temp.stage3_user_rpc_call_error(
    'public.get_organizer_competition_quota(uuid)'
  );
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_LEGACY_COMPETITION_QUOTA_ALLOWED:%',
      COALESCE(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche13_legacy_issuer$;

-- Better Auth Admin retains the admin log and organizer plan/quota reads.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);

DO $stage7_tranche13_admin_positive$
DECLARE
  v_count integer;
  v_plan text;
  v_quota record;
BEGIN
  PERFORM * FROM public.get_all_currency_logs(100);
  PERFORM * FROM public.get_user_currency_logs(auth.uid(), 50);

  SELECT count(*) INTO v_count
  FROM public.get_active_organizer_entitlements(
    '77777777-7777-4777-8777-777777777791'::uuid
  );
  IF v_count < 2 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_ADMIN_ENTITLEMENTS_MISSING:%', v_count;
  END IF;

  SELECT plan_code INTO v_plan
  FROM public.get_organizer_effective_plan(
    '77777777-7777-4777-8777-777777777791'::uuid
  );
  IF v_plan IS DISTINCT FROM 'FREE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_ADMIN_EFFECTIVE_PLAN_FAILED:%',
      COALESCE(v_plan, 'NULL');
  END IF;

  SELECT * INTO v_quota
  FROM public.get_organizer_competition_quota(
    '77777777-7777-4777-8777-777777777791'::uuid
  );
  IF v_quota.plan_code IS DISTINCT FROM 'FREE'
     OR v_quota.is_admin IS DISTINCT FROM TRUE
     OR v_quota.can_publish IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_ADMIN_COMPETITION_QUOTA_FAILED:%',
      row_to_json(v_quota);
  END IF;
END;
$stage7_tranche13_admin_positive$;

-- The active Better Auth organizer owner may inspect only their own plan,
-- entitlements and publication quota; a different authenticated user cannot.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  TRUE
);

DO $stage7_tranche13_organizer_positive$
DECLARE
  v_count integer;
  v_plan text;
  v_quota record;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.get_active_organizer_entitlements(
    '77777777-7777-4777-8777-777777777791'::uuid
  );
  IF v_count < 2 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_ORGANIZER_ENTITLEMENTS_MISSING:%', v_count;
  END IF;

  SELECT plan_code INTO v_plan
  FROM public.get_organizer_effective_plan(
    '77777777-7777-4777-8777-777777777791'::uuid
  );
  IF v_plan IS DISTINCT FROM 'FREE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_ORGANIZER_EFFECTIVE_PLAN_FAILED:%',
      COALESCE(v_plan, 'NULL');
  END IF;

  SELECT * INTO v_quota
  FROM public.get_organizer_competition_quota(
    '77777777-7777-4777-8777-777777777791'::uuid
  );
  IF v_quota.plan_code IS DISTINCT FROM 'FREE'
     OR v_quota.is_admin IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_ORGANIZER_COMPETITION_QUOTA_FAILED:%',
      row_to_json(v_quota);
  END IF;

  PERFORM * FROM public.get_user_currency_logs(auth.uid(), 50);
END;
$stage7_tranche13_organizer_positive$;

-- An unrelated Better Auth student cannot inspect a different organizer's
-- entitlements, effective plan or publication quota, nor another user's logs.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  TRUE
);

DO $stage7_tranche13_unrelated_user$
DECLARE
  v_error text;
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.get_user_currency_logs(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
    50
  );
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_FOREIGN_CURRENCY_LOGS_LEAKED:%', v_count;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.get_active_organizer_entitlements(
      '77777777-7777-4777-8777-777777777791'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_FOREIGN_ENTITLEMENTS_ALLOWED:%',
      COALESCE(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.get_organizer_effective_plan(
      '77777777-7777-4777-8777-777777777791'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_FOREIGN_EFFECTIVE_PLAN_ALLOWED:%',
      COALESCE(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.get_organizer_competition_quota(
      '77777777-7777-4777-8777-777777777791'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE13_FOREIGN_COMPETITION_QUOTA_ALLOWED:%',
      COALESCE(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche13_unrelated_user$;



-- Stage 7 tranche 14: exam activity, grading and organizer preview must
-- reject legacy issuers before protected reads/locks, retain owner/Admin
-- access, and deny unrelated Better Auth identities.
RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);

DO $stage7_tranche14_legacy_issuer$
DECLARE
  v_signature text;
  v_error text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_linear_exam_activity(uuid,integer,integer)',
    'public.grade_competition_attempt(uuid)',
    'public.grade_essay_similarity(uuid,uuid)',
    'public.save_manual_grading_item(uuid,numeric,text)',
    'public.start_organizer_exam_preview(uuid)'
  ] LOOP
    v_error := pg_temp.stage3_user_rpc_call_error(v_signature);
    IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      RAISE EXCEPTION 'STAGE7_TRANCHE14_LEGACY_ISSUER_ALLOWED:%:%',
        v_signature, coalesce(v_error, 'NO_ERROR');
    END IF;
  END LOOP;
END;
$stage7_tranche14_legacy_issuer$;

-- The real organizer owner can inspect activity and reach the safe
-- business-state boundary for grading and preview without mutating attempts.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  TRUE
);

DO $stage7_tranche14_organizer_owner$
DECLARE
  v_activity jsonb;
  v_attempt public.attempts%rowtype;
  v_error text;
  v_preview_report jsonb;
BEGIN
  v_activity := public.get_linear_exam_activity(
    '44444444-4444-4444-8444-444444444441'::uuid, 100, 0
  );
  IF v_activity ->> 'competition_id' IS DISTINCT FROM
     '44444444-4444-4444-8444-444444444441'
     OR jsonb_typeof(v_activity -> 'participants') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_OWNER_ACTIVITY_FAILED:%', v_activity;
  END IF;

  v_attempt := public.grade_competition_attempt(
    '77777777-7777-4777-8777-777777777781'::uuid
  );
  IF v_attempt.id IS DISTINCT FROM '77777777-7777-4777-8777-777777777781'::uuid
     OR v_attempt.status::text IS DISTINCT FROM 'FINALIZED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_OWNER_GRADE_ATTEMPT_FAILED:%', row_to_json(v_attempt);
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.grade_essay_similarity(
      '77777777-7777-4777-8777-777777777781'::uuid,
      '77777777-7777-4777-8777-777777777797'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_GRADABLE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_OWNER_AI_GRADE_SCOPE_FAILED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_manual_grading_item(
      '88888888-8888-4888-8888-888888888893'::uuid,
      0,
      'Rollback-only owner authorization probe'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_GRADABLE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_OWNER_MANUAL_GRADE_SCOPE_FAILED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.start_organizer_exam_preview(
      '44444444-4444-4444-8444-444444444441'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'PREVIEW_REQUIRES_DRAFT_COMPETITION' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_OWNER_PREVIEW_SCOPE_FAILED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_preview_report := public.get_organizer_exam_preview_report(
    '77777777-7777-4777-8777-777777777783'::uuid
  );
  IF v_preview_report->>'attempt_id' IS DISTINCT FROM '77777777-7777-4777-8777-777777777783'
     OR jsonb_array_length(coalesce(v_preview_report->'questions', '[]'::jsonb)) <> 1
     OR v_preview_report->'questions'->0->'answer_key'->'correct_option_ids'->>0
          IS DISTINCT FROM 'preview-correct-option'
     OR v_preview_report->'questions'->0->'answer_key'->>'answer_key'
          IS DISTINCT FROM 'preview-answer-key-secret' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_OWNER_PREVIEW_REPORT_FAILED:%', v_preview_report;
  END IF;
END;
$stage7_tranche14_organizer_owner$;

-- Admin access remains available for the same exam/activity and grading scope.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);

DO $stage7_tranche14_admin_positive$
DECLARE
  v_activity jsonb;
  v_attempt public.attempts%rowtype;
  v_error text;
BEGIN
  v_activity := public.get_linear_exam_activity(
    '44444444-4444-4444-8444-444444444441'::uuid, 100, 0
  );
  IF v_activity ->> 'competition_id' IS DISTINCT FROM
     '44444444-4444-4444-8444-444444444441' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_ADMIN_ACTIVITY_FAILED:%', v_activity;
  END IF;

  v_attempt := public.grade_competition_attempt(
    '77777777-7777-4777-8777-777777777781'::uuid
  );
  IF v_attempt.status::text IS DISTINCT FROM 'FINALIZED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_ADMIN_GRADE_ATTEMPT_FAILED:%', row_to_json(v_attempt);
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.grade_essay_similarity(
      '77777777-7777-4777-8777-777777777781'::uuid,
      '77777777-7777-4777-8777-777777777797'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_GRADABLE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_ADMIN_AI_GRADE_FAILED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_manual_grading_item(
      '88888888-8888-4888-8888-888888888893'::uuid,
      0,
      'Rollback-only Admin authorization probe'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ATTEMPT_NOT_GRADABLE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_ADMIN_MANUAL_GRADE_FAILED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.start_organizer_exam_preview(
      '44444444-4444-4444-8444-444444444441'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'PREVIEW_REQUIRES_DRAFT_COMPETITION' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_ADMIN_PREVIEW_FAILED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_organizer_exam_preview_report(
      '77777777-7777-4777-8777-777777777783'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'PREVIEW_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_ADMIN_PREVIEW_REPORT_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche14_admin_positive$;

-- An unrelated Better Auth student cannot inspect or invoke any organizer
-- exam, grading, manual-grading or preview entrypoint.
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  TRUE
);

DO $stage7_tranche14_unrelated_user$
DECLARE
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_linear_exam_activity(
      '44444444-4444-4444-8444-444444444441'::uuid, 100, 0
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_FOREIGN_ACTIVITY_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.grade_competition_attempt(
      '77777777-7777-4777-8777-777777777781'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_FOREIGN_GRADE_ATTEMPT_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.grade_essay_similarity(
      '77777777-7777-4777-8777-777777777781'::uuid,
      '77777777-7777-4777-8777-777777777797'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'FORBIDDEN' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_FOREIGN_AI_GRADE_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.save_manual_grading_item(
      '88888888-8888-4888-8888-888888888893'::uuid,
      0,
      'Rollback-only outsider authorization probe'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'GRADING_ITEM_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_FOREIGN_MANUAL_GRADE_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.start_organizer_exam_preview(
      '44444444-4444-4444-8444-444444444441'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'NOT_AUTHORIZED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_FOREIGN_PREVIEW_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.get_organizer_exam_preview_report(
      '77777777-7777-4777-8777-777777777783'::uuid
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'PREVIEW_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE14_FOREIGN_PREVIEW_REPORT_ALLOWED:%',
      coalesce(v_error, 'NO_ERROR');
  END IF;
END;
$stage7_tranche14_unrelated_user$;



-- Stage 7 tranche 15: Admin-only RPCs rely on the shared current_user_is_admin
-- -> current_user_has_role -> current_user_is_better_auth chain. Seed one plan
-- row only in this transaction so organizer creation/plan assignment can be
-- exercised without importing Production catalog data. Production constrains
-- plan_code to FREE, PREMIUM, or PRO; use PRO on this empty schema-only restore
-- and fail closed if that key unexpectedly exists.
RESET ROLE;

DO $stage7_tranche15_fixture_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.plan_catalog
    WHERE plan_code = 'PRO'
  ) OR EXISTS (
    SELECT 1 FROM public.organizers
    WHERE owner_user_id = 'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid
  ) OR EXISTS (
    SELECT 1 FROM public.organizers
    WHERE slug = 'stage7-tranche15-fixture'
  ) OR EXISTS (
    SELECT 1 FROM public.profiles
    WHERE username = 'stage7t15target'
  ) THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_FIXTURE_UUID_OR_KEY_COLLISION';
  END IF;
END;
$stage7_tranche15_fixture_preflight$;

INSERT INTO public.plan_catalog (plan_code, name, is_active)
VALUES ('PRO', 'Stage 7 Tranche 15 Synthetic Plan', TRUE);

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);

DO $stage7_tranche15_legacy_issuer$
DECLARE
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.admin_adjust_user_currency(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, 'xp', 1, 'Stage 7 T15 legacy issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Unauthorized: only admins can adjust currency.' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_LEGACY_CURRENCY_ADJUST_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_bulk_adjust_currency(
      ARRAY['dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid],
      'edu_coin', 1, 'Stage 7 T15 legacy issuer bulk probe'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Unauthorized: only admins can bulk adjust currency.' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_LEGACY_BULK_CURRENCY_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_assign_organizer_plan(
      '77777777-7777-4777-8777-777777777791'::uuid,
      'PRO', clock_timestamp(), clock_timestamp() + interval '30 days'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_LEGACY_PLAN_ASSIGN_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_change_username(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      'stage7t15legacyname', 'Stage 7 T15 legacy issuer probe'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_LEGACY_USERNAME_CHANGE_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.admin_create_organizer(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      'Stage 7 T15 Legacy Organizer',
      'stage7-t15-legacy-organizer'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_LEGACY_ORGANIZER_CREATE_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;
END;
$stage7_tranche15_legacy_issuer$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  TRUE
);

DO $stage7_tranche15_unrelated_user$
DECLARE
  v_error text;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.admin_adjust_user_currency(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid, 'xp', 1, 'Stage 7 T15 outsider probe'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Unauthorized: only admins can adjust currency.' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_FOREIGN_CURRENCY_ADJUST_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_bulk_adjust_currency(
      ARRAY['dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid],
      'edu_coin', 1, 'Stage 7 T15 outsider bulk probe'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'Unauthorized: only admins can bulk adjust currency.' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_FOREIGN_BULK_CURRENCY_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_assign_organizer_plan(
      '77777777-7777-4777-8777-777777777791'::uuid,
      'PRO', clock_timestamp(), clock_timestamp() + interval '30 days'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_FOREIGN_PLAN_ASSIGN_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_change_username(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
      'stage7t15outsidername', 'Stage 7 T15 outsider probe'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_FOREIGN_USERNAME_CHANGE_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.admin_create_organizer(
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
      'Stage 7 T15 Outsider Organizer',
      'stage7-t15-outsider-organizer'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_FOREIGN_ORGANIZER_CREATE_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;
END;
$stage7_tranche15_unrelated_user$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config(
  'request.jwt.claim.sub',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  TRUE
);

DO $stage7_tranche15_admin_positive$
DECLARE
  v_before_xp bigint;
  v_before_coin bigint;
  v_adjustment jsonb;
  v_bulk jsonb;
  v_profile public.profiles%ROWTYPE;
  v_created_organizer record;
  v_assigned_plan public.organizer_plans%ROWTYPE;
  v_owner_membership_count integer;
BEGIN
  SELECT total_xp, edu_coin
  INTO v_before_xp, v_before_coin
  FROM public.profiles
  WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_TARGET_PROFILE_MISSING';
  END IF;

  SELECT public.admin_adjust_user_currency(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
    'xp', 3, 'Stage 7 T15 rollback-only Admin currency adjustment'
  ) INTO v_adjustment;
  IF (v_adjustment ->> 'balance_after')::bigint IS DISTINCT FROM coalesce(v_before_xp,0) + 3 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_CURRENCY_ADJUST_FAILED:%', v_adjustment;
  END IF;

  SELECT public.admin_bulk_adjust_currency(
    ARRAY['dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid],
    'edu_coin', 5, 'Stage 7 T15 rollback-only Admin bulk adjustment'
  ) INTO v_bulk;
  IF (v_bulk ->> 'success')::integer IS DISTINCT FROM 1
     OR (v_bulk ->> 'failed')::integer IS DISTINCT FROM 0
     OR (v_bulk -> 'results' -> 0 ->> 'new')::bigint IS DISTINCT FROM coalesce(v_before_coin,0) + 5 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_BULK_CURRENCY_FAILED:%', v_bulk;
  END IF;

  SELECT * INTO v_profile
  FROM public.admin_change_username(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
    'stage7t15target',
    'Stage 7 T15 rollback-only Admin username change'
  );
  IF v_profile.id IS DISTINCT FROM 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
     OR v_profile.username IS DISTINCT FROM 'stage7t15target' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_USERNAME_CHANGE_FAILED:%', row_to_json(v_profile);
  END IF;

  SELECT * INTO v_created_organizer
  FROM public.admin_create_organizer(
    'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid,
    'Stage 7 Tranche 15 Synthetic Organizer',
    'stage7-tranche15-fixture'
  );
  IF v_created_organizer.id IS NULL
     OR v_created_organizer.slug IS DISTINCT FROM 'stage7-tranche15-fixture'
     OR length(v_created_organizer.access_code) <> 10 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_ORGANIZER_CREATE_FAILED:%', row_to_json(v_created_organizer);
  END IF;

  SELECT count(*) INTO v_owner_membership_count
  FROM public.organizer_members
  WHERE organizer_id = v_created_organizer.id
    AND user_id = 'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid
    AND member_role = 'owner'
    AND role = 'owner'
    AND is_active IS TRUE
    AND status = 'ACTIVE';
  IF v_owner_membership_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_OWNER_MEMBERSHIP_FAILED:%', v_owner_membership_count;
  END IF;

  PERFORM set_config('stage7.tranche15.organizer_id', v_created_organizer.id::text, TRUE);
  PERFORM set_config('stage7.tranche15.access_code', v_created_organizer.access_code, TRUE);

  SELECT * INTO v_assigned_plan
  FROM public.admin_assign_organizer_plan(
    v_created_organizer.id,
    'PRO',
    clock_timestamp(),
    clock_timestamp() + interval '30 days'
  );
  IF v_assigned_plan.organizer_id IS DISTINCT FROM v_created_organizer.id
     OR v_assigned_plan.plan_code IS DISTINCT FROM 'PRO'
     OR v_assigned_plan.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ADMIN_PLAN_ASSIGN_FAILED:%', row_to_json(v_assigned_plan);
  END IF;
END;
$stage7_tranche15_admin_positive$;

-- The caller-facing RPC test remains under authenticated Admin. Inspect the
-- private credential table only after restoring the disposable database owner.
RESET ROLE;
DO $stage7_tranche15_access_code_hash_only$
DECLARE
  v_organizer_id uuid := nullif(current_setting('stage7.tranche15.organizer_id', TRUE), '')::uuid;
  v_access_code text := current_setting('stage7.tranche15.access_code', TRUE);
  v_stored_access_code text;
  v_code_hash text;
BEGIN
  IF v_organizer_id IS NULL OR v_access_code IS NULL THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ACCESS_CODE_FIXTURE_MISSING';
  END IF;
  SELECT access_code INTO v_stored_access_code
  FROM public.organizers
  WHERE id = v_organizer_id;
  SELECT code_hash INTO v_code_hash
  FROM private.organizer_access_codes
  WHERE organizer_id = v_organizer_id;
  IF v_stored_access_code IS DISTINCT FROM 'SECURED'
     OR v_code_hash IS NULL
     OR length(v_code_hash) < 30
     OR v_code_hash = v_access_code
     OR extensions.crypt(v_access_code, v_code_hash) IS DISTINCT FROM v_code_hash THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE15_ACCESS_CODE_NOT_HASH_ONLY';
  END IF;
END;
$stage7_tranche15_access_code_hash_only$;

-- Stage 7 Tranche 16: organizer result, registration and plan RPC issuer/scope boundary.
-- All fixtures are synthetic and the outer transaction remains rollback-only.
SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  TRUE
);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', TRUE);

DO $stage7_tranche16_legacy_issuer$
DECLARE
  v_error text;
  v_count integer;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_organizer_competition_result_overview(
      '44444444-4444-4444-8444-444444444441'::uuid, 20, 0
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_LEGACY_OVERVIEW_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_organizer_registrations('77777777-7777-4777-8777-777777777791'::uuid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_LEGACY_REGISTRATIONS_LEAKED:%', v_count;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.review_registration(
      '66666666-6666-4666-8666-666666666691'::uuid, 'APPROVED', NULL
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_LEGACY_REVIEW_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.choose_organizer_plan(
      '77777777-7777-4777-8777-777777777791'::uuid, 'FREE'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_LEGACY_PLAN_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.request_custom_organizer_plan(
      '77777777-7777-4777-8777-777777777791'::uuid,
      '{"features":["competition_create"],"quantities":{"competition_create":1}}'::jsonb,
      'Stage 7 Tranche 16 legacy issuer probe',
      '081234567890'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_LEGACY_CUSTOM_PLAN_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;
END;
$stage7_tranche16_legacy_issuer$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config('request.jwt.claim.sub', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', TRUE);

DO $stage7_tranche16_unrelated_user$
DECLARE
  v_error text;
  v_count integer;
BEGIN
  v_error := NULL;
  BEGIN
    PERFORM public.get_organizer_competition_result_overview(
      '44444444-4444-4444-8444-444444444441'::uuid, 20, 0
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'COMPETITION_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_FOREIGN_OVERVIEW_DISCLOSED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_organizer_registrations('77777777-7777-4777-8777-777777777791'::uuid);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_FOREIGN_REGISTRATIONS_LEAKED:%', v_count;
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.review_registration(
      '66666666-6666-4666-8666-666666666691'::uuid, 'APPROVED', NULL
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'REGISTRATION_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_FOREIGN_REVIEW_DISCLOSED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.choose_organizer_plan(
      '77777777-7777-4777-8777-777777777791'::uuid, 'FREE'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_FOREIGN_PLAN_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.request_custom_organizer_plan(
      '77777777-7777-4777-8777-777777777791'::uuid,
      '{"features":["competition_create"],"quantities":{"competition_create":1}}'::jsonb,
      'Stage 7 Tranche 16 unrelated user probe',
      '081234567890'
    );
  EXCEPTION WHEN OTHERS THEN v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_FOREIGN_CUSTOM_PLAN_ALLOWED:%', coalesce(v_error,'NO_ERROR');
  END IF;
END;
$stage7_tranche16_unrelated_user$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', TRUE);

DO $stage7_tranche16_owner_positive$
DECLARE
  v_overview jsonb;
  v_count integer;
  v_registration public.registrations;
  v_plan public.organizer_plans;
  v_request public.organizer_custom_plan_requests;
BEGIN
  v_overview := public.get_organizer_competition_result_overview(
    '44444444-4444-4444-8444-444444444441'::uuid, 20, 0
  );
  IF v_overview->'competition'->>'slug' IS DISTINCT FROM 'stage7-organizer-scope-probe'
     OR jsonb_typeof(v_overview->'results') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_OWNER_OVERVIEW_FAILED:%', v_overview;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_organizer_registrations('77777777-7777-4777-8777-777777777791'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_OWNER_REGISTRATIONS_FAILED:%', v_count;
  END IF;

  SELECT * INTO v_registration
  FROM public.review_registration(
    '66666666-6666-4666-8666-666666666691'::uuid, 'APPROVED', NULL
  );
  IF v_registration.id IS DISTINCT FROM '66666666-6666-4666-8666-666666666691'::uuid
     OR v_registration.status::text IS DISTINCT FROM 'ACTIVE'
     OR v_registration.approved_by IS DISTINCT FROM 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_OWNER_REVIEW_FAILED:%', row_to_json(v_registration);
  END IF;

  SELECT * INTO v_plan
  FROM public.choose_organizer_plan(
    '77777777-7777-4777-8777-777777777791'::uuid, 'FREE'
  );
  IF v_plan.organizer_id IS DISTINCT FROM '77777777-7777-4777-8777-777777777791'::uuid
     OR v_plan.plan_code IS DISTINCT FROM 'FREE'
     OR v_plan.is_active IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_OWNER_PLAN_FAILED:%', row_to_json(v_plan);
  END IF;

  SELECT * INTO v_request
  FROM public.request_custom_organizer_plan(
    '77777777-7777-4777-8777-777777777791'::uuid,
    '{"features":["competition_create"],"quantities":{"competition_create":1}}'::jsonb,
    'Stage 7 Tranche 16 owner custom plan probe',
    '081234567890'
  );
  IF v_request.organizer_id IS DISTINCT FROM '77777777-7777-4777-8777-777777777791'::uuid
     OR v_request.requester_user_id IS DISTINCT FROM 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
     OR v_request.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_OWNER_CUSTOM_PLAN_FAILED:%', row_to_json(v_request);
  END IF;
END;
$stage7_tranche16_owner_positive$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  TRUE
);
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', TRUE);

DO $stage7_tranche16_admin_positive$
DECLARE
  v_overview jsonb;
  v_count integer;
  v_registration public.registrations;
  v_plan public.organizer_plans;
  v_request public.organizer_custom_plan_requests;
BEGIN
  v_overview := public.get_organizer_competition_result_overview(
    '44444444-4444-4444-8444-444444444441'::uuid, 20, 0
  );
  IF v_overview->'competition'->>'slug' IS DISTINCT FROM 'stage7-organizer-scope-probe' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_ADMIN_OVERVIEW_FAILED:%', v_overview;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_organizer_registrations('77777777-7777-4777-8777-777777777791'::uuid);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_ADMIN_REGISTRATIONS_FAILED:%', v_count;
  END IF;

  SELECT * INTO v_registration
  FROM public.review_registration(
    '66666666-6666-4666-8666-666666666691'::uuid,
    'REJECTED',
    'Stage 7 Tranche 16 rollback-only Admin review'
  );
  IF v_registration.status::text IS DISTINCT FROM 'REJECTED'
     OR v_registration.approved_by IS DISTINCT FROM 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
     OR v_registration.rejection_reason IS DISTINCT FROM 'Stage 7 Tranche 16 rollback-only Admin review' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_ADMIN_REVIEW_FAILED:%', row_to_json(v_registration);
  END IF;

  SELECT * INTO v_plan
  FROM public.choose_organizer_plan(
    '77777777-7777-4777-8777-777777777791'::uuid, 'FREE'
  );
  IF v_plan.organizer_id IS DISTINCT FROM '77777777-7777-4777-8777-777777777791'::uuid
     OR v_plan.plan_code IS DISTINCT FROM 'FREE' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_ADMIN_PLAN_FAILED:%', row_to_json(v_plan);
  END IF;

  SELECT * INTO v_request
  FROM public.request_custom_organizer_plan(
    '77777777-7777-4777-8777-777777777791'::uuid,
    '{"features":["competition_create"],"quantities":{"competition_create":1}}'::jsonb,
    'Stage 7 Tranche 16 Admin custom plan probe',
    '081234567891'
  );
  IF v_request.organizer_id IS DISTINCT FROM '77777777-7777-4777-8777-777777777791'::uuid
     OR v_request.requester_user_id IS DISTINCT FROM 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
     OR v_request.status IS DISTINCT FROM 'PENDING' THEN
    RAISE EXCEPTION 'STAGE7_TRANCHE16_ADMIN_CUSTOM_PLAN_FAILED:%', row_to_json(v_request);
  END IF;
END;
$stage7_tranche16_admin_positive$;

DO $stage7_transition_competition_caller_acceptance$
DECLARE
  v_comp public.competitions;
  v_error text;
BEGIN
  -- The established synthetic organizer owner may perform an allowed
  -- transition on their own competition under the exact Better Auth issuer.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',TRUE);
  SELECT * INTO v_comp
  FROM public.transition_competition(
    '44444444-4444-4444-8444-444444444441'::uuid,
    'SUSPENDED'::public.competition_status,
    'Stage 7 owner transition authorization probe'
  );
  IF v_comp.id IS DISTINCT FROM '44444444-4444-4444-8444-444444444441'::uuid
     OR v_comp.status IS DISTINCT FROM 'SUSPENDED'::public.competition_status THEN
    RAISE EXCEPTION 'STAGE7_TRANSITION_COMPETITION_OWNER_FAILED:%',row_to_json(v_comp);
  END IF;

  -- A different Better Auth student has no membership and must not restore
  -- or otherwise transition the organizer's competition.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',TRUE);
  v_error := NULL;
  BEGIN
    PERFORM public.transition_competition(
      '44444444-4444-4444-8444-444444444441'::uuid,
      'RESULT_PUBLISHED'::public.competition_status,
      'Stage 7 outsider transition must be denied'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANSITION_COMPETITION_OUTSIDER_NOT_DENIED:%',coalesce(v_error,'NO_ERROR');
  END IF;

  -- The same real organizer owner UUID is not trusted when the token issuer
  -- is Supabase Auth rather than the configured Better Auth issuer.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',TRUE);
  v_error := NULL;
  BEGIN
    PERFORM public.transition_competition(
      '44444444-4444-4444-8444-444444444441'::uuid,
      'RESULT_PUBLISHED'::public.competition_status,
      'Stage 7 legacy issuer transition must be denied'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ACCESS_DENIED' THEN
    RAISE EXCEPTION 'STAGE7_TRANSITION_COMPETITION_LEGACY_ISSUER_NOT_DENIED:%',coalesce(v_error,'NO_ERROR');
  END IF;

  -- An active Admin using Better Auth retains the documented override path.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',TRUE);
  SELECT * INTO v_comp
  FROM public.transition_competition(
    '44444444-4444-4444-8444-444444444441'::uuid,
    'RESULT_PUBLISHED'::public.competition_status,
    'Stage 7 Admin transition authorization probe'
  );
  IF v_comp.status IS DISTINCT FROM 'RESULT_PUBLISHED'::public.competition_status THEN
    RAISE EXCEPTION 'STAGE7_TRANSITION_COMPETITION_ADMIN_FAILED:%',row_to_json(v_comp);
  END IF;
END;
$stage7_transition_competition_caller_acceptance$;

RESET ROLE;
ROLLBACK;
