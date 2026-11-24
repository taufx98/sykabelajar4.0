-- Rollback-only acceptance for the Stage 3 restrictive issuer guard.
-- Run only against the complete disposable schema restore after the guard draft.
\set ON_ERROR_STOP on
BEGIN;

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
  );

-- A public results page may expose the published result, but private badge
-- collections remain private unless read by their real Better Auth owner/Admin.
-- Stage 7 teacher/collective fixtures: same synthetic Better Auth Admin
-- owns the roster and participant, so the legacy-issuer path is tested
-- against actual protected rows rather than only absent UUIDs.
INSERT INTO public.teacher_rosters (id, teacher_user_id, name, is_active)
VALUES (
  '88888888-8888-4888-8888-888888888891',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'Stage 7 issuer boundary roster',
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
  'STAGE7-TEACHER-001',
  'Stage 7 Existing Collective Participant',
  'ACTIVE'
);

INSERT INTO public.participants (
  id, competition_id, collective_participant_id, participant_type,
  participant_code, full_name
)
VALUES (
  '77777777-7777-4777-8777-777777777781',
  '22222222-2222-4222-8222-222222222222',
  '66666666-6666-4666-8666-666666666681',
  'COLLECTIVE',
  'STAGE7-TEACHER-001',
  'Stage 7 Existing Collective Participant'
);

INSERT INTO public.participants (
  id, competition_id, user_id, participant_type, full_name
)
VALUES
  ('55555555-5555-4555-8555-555555555551', '33333333-3333-4333-8333-333333333333',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'INDIVIDUAL', 'Untrusted Issuer Private Participant'),
  ('55555555-5555-4555-8555-555555555552', '33333333-3333-4333-8333-333333333333',
   'ffffffff-ffff-4fff-8fff-fffffffffff6', 'INDIVIDUAL', 'Better Auth Private Participant');

INSERT INTO public.attempts (
  id, competition_id, participant_id, canonical_participant_id, status, score, finalized_at
)
VALUES
  ('77777777-7777-4777-8777-777777777771', '33333333-3333-4333-8333-333333333333',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555551',
   'FINALIZED'::public.attempt_status, 91, now()),
  ('77777777-7777-4777-8777-777777777772', '33333333-3333-4333-8333-333333333333',
   'ffffffff-ffff-4fff-8fff-fffffffffff6', '55555555-5555-4555-8555-555555555552',
   'FINALIZED'::public.attempt_status, 92, now());

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
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED'; END IF;
  IF has_schema_privilege(current_user, 'private', 'USAGE') THEN
    RAISE EXCEPTION 'STAGE3_PRIVATE_SCHEMA_USAGE_UNEXPECTED';
  END IF;
  IF NOT public.is_active_admin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED';
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

RESET ROLE;
ROLLBACK;
