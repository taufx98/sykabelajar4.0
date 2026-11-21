-- Rollback-only acceptance for the Stage 3 restrictive issuer guard.
-- Run only against the complete disposable schema restore after the guard draft.
\set ON_ERROR_STOP on
BEGIN;

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

-- Simulate one retained legacy Admin UUID and one new Better Auth Admin.
-- The legacy role row is kept, but must not satisfy any authenticated Admin helper.
INSERT INTO private.app_users (id, identity_origin)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy_reference'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'better_auth'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'better_auth'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'better_auth');

-- Synthetic profiles exercise the SECURITY DEFINER privacy boundary after
-- Stage 3. A legacy owner and a Better Auth owner both have private profiles;
-- public profile C publishes only its following list, not its followers list.
INSERT INTO public.profiles (id, username, full_name, is_public)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stage3_legacy_private', 'Legacy Probe', false),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stage3_ba_private', 'Better Auth Owner Probe', false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'stage3_public_profile', 'Public Profile Probe', true),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'stage3_public_follower', 'Public Follower Probe', true);

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
INSERT INTO public.user_roles (user_id, role, is_active)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'::public.app_role, TRUE),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'::public.app_role, TRUE);

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
END;
$profile_anon$;

RESET ROLE;
SET LOCAL ROLE authenticated;

-- Supabase Auth is not a trusted application login after this cutover.
-- Even a legacy Auth subject that was previously valid is now denied.
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $legacy_issuer$
DECLARE
  v_count integer;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_READ_ALLOWED'; END IF;
  -- The private schema intentionally has no USAGE for API roles.
  -- Verify that boundary; exercise its SECURITY DEFINER helpers through
  -- public entrypoints below instead of invoking private functions directly.
  IF has_schema_privilege(current_user, 'private', 'USAGE') THEN
    RAISE EXCEPTION 'STAGE3_PRIVATE_SCHEMA_USAGE_UNEXPECTED';
  END IF;
  IF public.is_active_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_IS_ACTIVE_ADMIN_ALLOWED';
  END IF;

  -- Matching a private profile UUID does not make a legacy Supabase Auth
  -- session its Better Auth owner.
  SELECT count(*) INTO v_count
  FROM public.get_profile_connections('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'following');
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
  -- exam RPC can inspect an attempt owned by the same legacy UUID.
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

-- Better Auth issuer is also valid and still sees only its own UUID.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $better_auth_issuer$
DECLARE
  v_count integer;
  v_result jsonb;
  v_status text;
  v_exam_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED'; END IF;
  IF has_schema_privilege(current_user, 'private', 'USAGE') THEN
    RAISE EXCEPTION 'STAGE3_PRIVATE_SCHEMA_USAGE_UNEXPECTED';
  END IF;
  IF NOT public.is_active_admin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED';
  END IF;
  IF public.admin_set_collective_certificate_price(0) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_DIRECT_ADMIN_RPC_DENIED';
  END IF;

  -- The valid Better Auth Admin can execute the scoped Admin/social RPCs.
  v_result := public.admin_diagnose_organizer_voucher_delete(
    'ffffffff-ffff-4fff-8fff-fffffffffff1'::uuid
  );
  IF COALESCE((v_result ->> 'ok')::boolean, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_DIAGNOSE_RPC_FAILED:%', v_result;
  END IF;

  PERFORM public.admin_evaluate_badges();

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

  INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'better-auth-insert');
END;
$better_auth_issuer$;

-- A different Better Auth identity may see public profile social projections,
-- but must not inspect another user's private connection list or summary.
SELECT set_config('request.jwt.claims',
  '{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', true);
DO $better_auth_other_user$
DECLARE
  v_count integer;
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
END;
$better_auth_other_user$;

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

RESET ROLE;
ROLLBACK;
