\set ON_ERROR_STOP on

-- Production-shaped Stage 3 regression against the schema-only disposable restore.
-- Every synthetic user is provisioned through the Better Auth server-only RPCs.
-- It deliberately leaves auth.users empty and never installs legacy Auth triggers.
-- The entire test suite is rolled back; never run it against a hosted project.

BEGIN;

CREATE TEMP TABLE stage3_fixture_temp_anchor (id integer) ON COMMIT DROP;

CREATE FUNCTION pg_temp.stage3_provision_user(
  p_user_id uuid,
  p_account_type text,
  p_full_name text,
  p_username text,
  p_referral_code text,
  p_email_verified boolean,
  p_institution text,
  p_grade text
) RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.better_auth_provision_user(
    p_user_id,
    p_account_type,
    p_full_name,
    p_username,
    p_referral_code,
    p_email_verified,
    NULL::date,
    p_institution,
    p_grade,
    NULL::text
  );
END;
$function$;

CREATE FUNCTION pg_temp.stage3_verify_email(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.better_auth_complete_email_verification(p_user_id, clock_timestamp());
END;
$function$;

CREATE FUNCTION pg_temp.stage3_verify_phone(
  p_user_id uuid,
  p_phone_digits text,
  p_provider_subject text
) RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.better_auth_complete_phone_verification(
    p_user_id,
    clock_timestamp(),
    encode(extensions.digest(p_phone_digits, 'sha256'), 'hex'),
    'telegram',
    p_provider_subject,
    length(p_phone_digits)
  );
END;
$function$;

DO $stage3_conflict_mode$
BEGIN
  IF current_setting('plpgsql.variable_conflict') IS DISTINCT FROM 'error' THEN
    RAISE EXCEPTION 'STAGE3_PLPGSQL_VARIABLE_CONFLICT_MODE_MUST_MATCH_PRODUCTION: expected error, found %',
      current_setting('plpgsql.variable_conflict');
  END IF;
END;
$stage3_conflict_mode$;

DO $stage3_regression$
DECLARE
  u_referrer constant uuid := '00000000-0000-4000-8000-00000000a001';
  u_referred constant uuid := '00000000-0000-4000-8000-00000000a002';
  u_expired constant uuid := '00000000-0000-4000-8000-00000000a003';
  u_fallback constant uuid := '00000000-0000-4000-8000-00000000a004';
  u_organizer constant uuid := '00000000-0000-4000-8000-00000000a005';
  u_duplicate_organizer constant uuid := '00000000-0000-4000-8000-00000000a006';
  u_no_phone constant uuid := '00000000-0000-4000-8000-00000000a007';
  u_no_email constant uuid := '00000000-0000-4000-8000-00000000a008';
  u_participant constant uuid := '00000000-0000-4000-8000-00000000a009';
  u_unverified_referrer constant uuid := '00000000-0000-4000-8000-00000000a010';
  u_bad_referral constant uuid := '00000000-0000-4000-8000-00000000a011';
  u_admin constant uuid := '00000000-0000-4000-8000-00000000a012';
  u_active_member constant uuid := '00000000-0000-4000-8000-00000000a013';
  u_inactive_member constant uuid := '00000000-0000-4000-8000-00000000a014';
  v_order_id constant uuid := '00000000-0000-4000-8000-00000000a201';
  v_payment_intent_id constant uuid := '00000000-0000-4000-8000-00000000a202';
  v_attempt_id constant uuid := '00000000-0000-4000-8000-00000000a203';
  v_canonical_participant_id constant uuid := '00000000-0000-4000-8000-00000000a204';
  v_roster_id constant uuid := '00000000-0000-4000-8000-00000000a205';
  v_roster_student_id constant uuid := '00000000-0000-4000-8000-00000000a206';
  v_collective_participant_id constant uuid := '00000000-0000-4000-8000-00000000a222';
  v_award_id constant uuid := '00000000-0000-4000-8000-00000000a212';
  v_certificate_id constant uuid := '00000000-0000-4000-8000-00000000a213';
  v_certificate_asset_id constant uuid := '00000000-0000-4000-8000-00000000a214';
  v_product_id constant uuid := '00000000-0000-4000-8000-00000000a215';
  v_review_id constant uuid := '00000000-0000-4000-8000-00000000a216';
  v_post_published_id constant uuid := '00000000-0000-4000-8000-00000000a217';
  v_post_draft_id constant uuid := '00000000-0000-4000-8000-00000000a218';
  v_comment_published_id constant uuid := '00000000-0000-4000-8000-00000000a219';
  v_comment_hidden_id constant uuid := '00000000-0000-4000-8000-00000000a220';
  v_follow_id constant uuid := '00000000-0000-4000-8000-00000000a221';

  v_event_id uuid;
  v_fallback_event_id uuid;
  v_organizer_id uuid;
  v_access_code text;
  v_code_hash text;
  v_competition_id uuid := '00000000-0000-4000-8000-00000000a101';
  v_registration_id uuid;
  v_reward numeric;
  v_applied boolean;
  v_count integer;
  v_affected integer;
  v_caught boolean;
  v_profile_type text;
  v_role public.app_role;
  v_org_hash text;
  v_auth_create_organizer boolean;
  v_anon_create_organizer boolean;
  v_auth_register boolean;
  v_auth_apply_referral boolean;
  v_auth_get_my_referrals boolean;
  v_anon_get_my_referrals boolean;
  v_service_get_my_referrals boolean;
  v_auth_get_my_referrals_v2 boolean;
  v_anon_get_my_referrals_v2 boolean;
  v_service_get_my_referrals_v2 boolean;
  v_auth_get_my_verified_referrals boolean;
  v_anon_get_my_verified_referrals boolean;
  v_service_get_my_verified_referrals boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id IN (
      u_referrer,u_referred,u_expired,u_fallback,u_organizer,
      u_duplicate_organizer,u_no_phone,u_no_email,u_participant,
      u_unverified_referrer,u_bad_referral,u_admin,u_active_member,u_inactive_member
    )
  ) THEN
    RAISE EXCEPTION 'STAGE3_FIXTURE_UUID_COLLISION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id IN (
      u_referrer,u_referred,u_expired,u_fallback,u_organizer,
      u_duplicate_organizer,u_no_phone,u_no_email,u_participant,
      u_unverified_referrer,u_bad_referral,u_admin,u_active_member,u_inactive_member
    )
  ) THEN
    RAISE EXCEPTION 'STAGE3_FIXTURE_PROFILE_COLLISION';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.competitions WHERE id = v_competition_id
  ) THEN
    RAISE EXCEPTION 'STAGE3_FIXTURE_COMPETITION_COLLISION';
  END IF;

  IF EXISTS (SELECT 1 FROM public.orders WHERE id=v_order_id)
     OR EXISTS (SELECT 1 FROM public.payment_intents WHERE id=v_payment_intent_id)
     OR EXISTS (SELECT 1 FROM public.attempts WHERE id=v_attempt_id)
     OR EXISTS (SELECT 1 FROM public.participants WHERE id=v_canonical_participant_id)
     OR EXISTS (SELECT 1 FROM public.teacher_rosters WHERE id=v_roster_id)
     OR EXISTS (SELECT 1 FROM public.roster_students WHERE id=v_roster_student_id)
     OR EXISTS (SELECT 1 FROM public.payment_events WHERE provider_event_id='stage3-auth-regression-payment-event')
      OR EXISTS (SELECT 1 FROM public.awards WHERE id=v_award_id)
      OR EXISTS (SELECT 1 FROM public.certificates WHERE id=v_certificate_id)
      OR EXISTS (SELECT 1 FROM public.certificate_assets WHERE id=v_certificate_asset_id)
      OR EXISTS (SELECT 1 FROM public.commerce_products WHERE id=v_product_id OR code='STAGE3_AUTH_REGRESSION_PRODUCT' OR slug='stage3-auth-regression-product')
      OR EXISTS (SELECT 1 FROM public.commerce_product_reviews WHERE id=v_review_id)
      OR EXISTS (SELECT 1 FROM public.posts WHERE id IN (v_post_published_id,v_post_draft_id))
      OR EXISTS (SELECT 1 FROM public.comments WHERE id IN (v_comment_published_id,v_comment_hidden_id))
      OR EXISTS (SELECT 1 FROM public.follows WHERE id=v_follow_id)
       OR EXISTS (SELECT 1 FROM public.collective_participants WHERE id=v_collective_participant_id)
       OR EXISTS (SELECT 1 FROM public.collective_participants WHERE competition_id=v_competition_id AND participant_code='STAGE3-COLLECTIVE-001') THEN
    RAISE EXCEPTION 'STAGE3_FIXTURE_BUSINESS_UUID_COLLISION';
  END IF;

  IF (SELECT count(*) FROM auth.users) <> 0
     OR (SELECT count(*) FROM private.app_users) <> 0
     OR (SELECT count(*) FROM public.profiles) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RESTORE_MUST_START_WITH_ZERO_AUTH_AND_IDENTITY_ROWS';
  END IF;

  v_auth_create_organizer := has_function_privilege(
    'authenticated','public.create_organizer(text,text)','EXECUTE');
  v_anon_create_organizer := has_function_privilege(
    'anon','public.create_organizer(text,text)','EXECUTE');
  v_auth_register := has_function_privilege(
    'authenticated','public.register_for_competition(uuid,text,uuid,text,boolean,text,text,text)','EXECUTE');
  v_auth_apply_referral := has_function_privilege(
    'authenticated','private.apply_referral_qualification(uuid,text,timestamptz)','EXECUTE');

  v_auth_get_my_referrals := has_function_privilege('authenticated','public.get_my_referrals()','EXECUTE');
  v_anon_get_my_referrals := has_function_privilege('anon','public.get_my_referrals()','EXECUTE');
  v_service_get_my_referrals := has_function_privilege('service_role','public.get_my_referrals()','EXECUTE');
  v_auth_get_my_referrals_v2 := has_function_privilege('authenticated','public.get_my_referrals_v2()','EXECUTE');
  v_anon_get_my_referrals_v2 := has_function_privilege('anon','public.get_my_referrals_v2()','EXECUTE');
  v_service_get_my_referrals_v2 := has_function_privilege('service_role','public.get_my_referrals_v2()','EXECUTE');
  v_auth_get_my_verified_referrals := has_function_privilege('authenticated','public.get_my_verified_referrals()','EXECUTE');
  v_anon_get_my_verified_referrals := has_function_privilege('anon','public.get_my_verified_referrals()','EXECUTE');
  v_service_get_my_verified_referrals := has_function_privilege('service_role','public.get_my_verified_referrals()','EXECUTE');

  IF v_auth_create_organizer IS DISTINCT FROM true
     OR v_anon_create_organizer IS DISTINCT FROM false
     OR v_auth_register IS DISTINCT FROM true
     OR v_auth_apply_referral IS DISTINCT FROM false
     OR v_auth_get_my_referrals IS DISTINCT FROM true
     OR v_anon_get_my_referrals IS DISTINCT FROM false
     OR v_service_get_my_referrals IS DISTINCT FROM false
     OR v_auth_get_my_referrals_v2 IS DISTINCT FROM true
     OR v_anon_get_my_referrals_v2 IS DISTINCT FROM false
     OR v_service_get_my_referrals_v2 IS DISTINCT FROM false
     OR v_auth_get_my_verified_referrals IS DISTINCT FROM true
     OR v_anon_get_my_verified_referrals IS DISTINCT FROM false
     OR v_service_get_my_verified_referrals IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'STAGE3_FUNCTION_GRANT_CONTRACT_DRIFT: authenticated_create_organizer=%, anon_create_organizer=%, authenticated_register=%, authenticated_apply_referral=%, referral_v1(auth/anon/service)= %/%/%, referral_v2(auth/anon/service)= %/%/%, verified_referrals(auth/anon/service)= %/%/%',
      v_auth_create_organizer,v_anon_create_organizer,v_auth_register,v_auth_apply_referral,
      v_auth_get_my_referrals,v_anon_get_my_referrals,v_service_get_my_referrals,
      v_auth_get_my_referrals_v2,v_anon_get_my_referrals_v2,v_service_get_my_referrals_v2,
      v_auth_get_my_verified_referrals,v_anon_get_my_verified_referrals,v_service_get_my_verified_referrals;
  END IF;

  INSERT INTO private.referral_program_settings (
    id, is_active, base_reward_amount, event_reward_amount,
    starts_at, ends_at
  )
  VALUES (true, true, 17, NULL, NULL, NULL)
  ON CONFLICT (id) DO UPDATE
    SET is_active = EXCLUDED.is_active,
        base_reward_amount = EXCLUDED.base_reward_amount,
        event_reward_amount = EXCLUDED.event_reward_amount,
        starts_at = NULL,
        ends_at = NULL;

  -- Verified teacher referrer; Better Auth provisioning normalizes profile fields
  -- and maps the teacher business role without changing PostgreSQL JWT role.
    PERFORM pg_temp.stage3_provision_user(u_referrer,'teacher','  Stage3 Teacher Referrer  ','  Stage3_Referrer  ',NULL,true,'  sekolah uji  ','12');


  SELECT p.account_type,p.full_name,p.username,p.institution
    INTO v_profile_type,v_access_code,v_code_hash,v_org_hash
  FROM public.profiles p WHERE p.id=u_referrer;

  IF v_profile_type <> 'teacher'
     OR v_access_code <> 'Stage3 Teacher Referrer'
     OR v_code_hash <> 'stage3_referrer'
     OR v_org_hash <> 'SEKOLAH UJI' THEN
    RAISE EXCEPTION 'STAGE3_PROFILE_BOOTSTRAP_NORMALIZATION_FAILED';
  END IF;

  SELECT ur.role INTO v_role
  FROM public.user_roles ur
  WHERE ur.user_id=u_referrer AND ur.is_active=true;

  IF v_role IS DISTINCT FROM 'teacher'::public.app_role THEN
    RAISE EXCEPTION 'STAGE3_TEACHER_ROLE_MAPPING_FAILED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_settings WHERE user_id=u_referrer) THEN
    RAISE EXCEPTION 'STAGE3_USER_SETTINGS_BOOTSTRAP_FAILED';
  END IF;

  INSERT INTO public.referral_codes(user_id,code)
  VALUES (u_referrer,'STAGE3REF');

  -- Public account registration cannot request admin. The Better Auth provisioning
  -- RPC rejects that account type, then the valid student registration snapshots
  -- the referral reward and creates exactly one PENDING event.
    -- Public signup cannot assign admin; invalid account_type is rejected by the
  -- trusted provisioning RPC. The legitimate student registration then uses
  -- the referral code and starts with an unverified email state.
  v_caught := false;
  BEGIN
    PERFORM pg_temp.stage3_provision_user(u_referred,'admin','Stage3 Referred','stage3_referred','STAGE3REF',false,NULL,NULL);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'STAGE3_PRIVILEGED_SELF_REGISTRATION_NOT_REJECTED'; END IF;
  PERFORM pg_temp.stage3_provision_user(u_referred,'student','Stage3 Referred','stage3_referred','STAGE3REF',false,NULL,NULL);


  SELECT p.account_type INTO v_profile_type
  FROM public.profiles p WHERE p.id=u_referred;

  IF v_profile_type <> 'student' THEN
    RAISE EXCEPTION 'STAGE3_PRIVILEGED_SELF_REGISTRATION_NOT_REJECTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=u_referred AND role='student'::public.app_role AND is_active
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=u_referred AND role IN ('admin'::public.app_role,'organizer_member'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'STAGE3_INVALID_ROLE_MAPPING';
  END IF;

  SELECT re.id,re.reward_amount,re.status
    INTO v_event_id,v_reward,v_profile_type
  FROM public.referral_events re
  WHERE re.referred_user_id=u_referred;

  IF v_event_id IS NULL OR v_reward <> 17 OR v_profile_type <> 'PENDING' THEN
    RAISE EXCEPTION 'STAGE3_SIGNUP_REFERRAL_ATTRIBUTION_FAILED';
  END IF;

  -- A qualifying activity before email verification is recorded but not paid.
  INSERT INTO public.daily_checkins (
    user_id,checkin_date,reward_type,reward_amount,streak_day,created_at
  )
  VALUES (
    u_referred,current_date,'STAGE3_TEST',0,1,clock_timestamp()
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE id=v_event_id
      AND status='PENDING'
      AND verified_at IS NULL
      AND verified_activity='daily_checkin'
      AND last_checked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'STAGE3_PENDING_ACTIVITY_WAS_NOT_RECORDED';
  END IF;

  -- A settings change after registration must not alter the snapshotted reward.
  UPDATE private.referral_program_settings SET base_reward_amount=99 WHERE id=true;

  PERFORM pg_temp.stage3_verify_email(u_referred);

  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE id=v_event_id
      AND status='VERIFIED'
      AND verified_at IS NOT NULL
      AND verified_activity='daily_checkin'
      AND reward_amount=17
  ) THEN
    RAISE EXCEPTION 'STAGE3_EMAIL_VERIFICATION_DID_NOT_QUALIFY_REFERRAL';
  END IF;

  SELECT count(*),coalesce(sum(amount),0)
    INTO v_count,v_reward
  FROM public.edu_coin_ledger
  WHERE user_id=u_referrer
    AND event_type='REFERRAL_REGISTRATION'
    AND event_id=v_event_id::text;

  IF v_count <> 1 OR v_reward <> 17 THEN
    RAISE EXCEPTION 'STAGE3_REFERRAL_LEDGER_SNAPSHOT_OR_IDEMPOTENCY_FAILED';
  END IF;

  IF (SELECT edu_coin FROM public.profiles WHERE id=u_referrer) <> 17 THEN
    RAISE EXCEPTION 'STAGE3_REFERRAL_PROFILE_CREDIT_FAILED';
  END IF;

  v_applied := private.apply_referral_qualification(u_referred,'comment',clock_timestamp());
  IF v_applied IS DISTINCT FROM false
     OR (SELECT count(*) FROM public.edu_coin_ledger
         WHERE user_id=u_referrer AND event_type='REFERRAL_REGISTRATION'
           AND event_id=v_event_id::text) <> 1 THEN
    RAISE EXCEPTION 'STAGE3_REFERRAL_RETRY_NOT_IDEMPOTENT';
  END IF;

  -- Exact 24-hour deadline must not qualify an expired PENDING event.
    PERFORM pg_temp.stage3_provision_user(u_expired,'student','Stage3 Expired','stage3_expired',NULL,true,NULL,NULL);


  INSERT INTO public.referral_events (
    id,referrer_user_id,referred_user_id,reward_amount,status,created_at
  )
  VALUES (
    '00000000-0000-4000-8000-00000000b101',
    u_referrer,u_expired,23,'PENDING',clock_timestamp()-interval '25 hours'
  );

  v_applied := private.apply_referral_qualification(u_expired,'daily_checkin',clock_timestamp());
  IF v_applied IS DISTINCT FROM false
     OR NOT EXISTS (
       SELECT 1 FROM public.referral_events
       WHERE referred_user_id=u_expired AND status='PENDING' AND verified_at IS NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.edu_coin_ledger
       WHERE user_id=u_referrer AND event_type='REFERRAL_REGISTRATION'
         AND event_id='00000000-0000-4000-8000-00000000b101'
     ) THEN
    RAISE EXCEPTION 'STAGE3_REFERRAL_24_HOUR_EXPIRY_GUARD_FAILED';
  END IF;

  -- Exercise the scheduled fallback verifier independently of the activity
  -- trigger: create an inactive event, add an activity, then make it PENDING.
    PERFORM pg_temp.stage3_provision_user(u_fallback,'student','Stage3 Fallback','stage3_fallback',NULL,true,NULL,NULL);


  v_fallback_event_id := '00000000-0000-4000-8000-00000000b102';

  INSERT INTO public.referral_events (
    id,referrer_user_id,referred_user_id,reward_amount,status,created_at
  )
  VALUES (
    v_fallback_event_id,u_referrer,u_fallback,13,'REVOKED',clock_timestamp()-interval '2 minutes'
  );

  INSERT INTO public.daily_checkins (
    user_id,checkin_date,reward_type,reward_amount,streak_day,created_at
  )
  VALUES (
    u_fallback,current_date,'STAGE3_FALLBACK',0,1,clock_timestamp()
  );

  UPDATE public.referral_events
  SET status='PENDING'
  WHERE id=v_fallback_event_id;

  v_count := public.verify_pending_referrals();

  IF v_count <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.referral_events
       WHERE id=v_fallback_event_id AND status='VERIFIED'
         AND verified_activity='daily_checkin' AND verified_at IS NOT NULL
     )
     OR (SELECT count(*) FROM public.edu_coin_ledger
         WHERE user_id=u_referrer AND event_type='REFERRAL_REGISTRATION'
           AND event_id=v_fallback_event_id::text) <> 1
     OR (SELECT edu_coin FROM public.profiles WHERE id=u_referrer) <> 30 THEN
    RAISE EXCEPTION 'STAGE3_SCHEDULED_REFERRAL_VERIFIER_FAILED';
  END IF;

  IF public.verify_pending_referrals() <> 0 THEN
    RAISE EXCEPTION 'STAGE3_SCHEDULED_REFERRAL_VERIFIER_NOT_IDEMPOTENT';
  END IF;

  -- The unverified referrer must not be accepted for Better Auth referral attribution.
    PERFORM pg_temp.stage3_provision_user(u_unverified_referrer,'teacher','Unverified Referrer','stage3_unverified_ref',NULL,false,NULL,NULL);
  INSERT INTO public.referral_codes(user_id,code) VALUES (u_unverified_referrer,'STAGE3UNVER');


    PERFORM pg_temp.stage3_provision_user(u_bad_referral,'student','Bad Referral','stage3_bad_referral','STAGE3UNVER',false,NULL,NULL);


  IF EXISTS (SELECT 1 FROM public.referral_events WHERE referred_user_id=u_bad_referral) THEN
    RAISE EXCEPTION 'STAGE3_UNVERIFIED_REFERRER_WAS_ACCEPTED';
  END IF;

  -- Simulate an already-approved admin assigned by a trusted database owner.
  -- Better Auth public registration remains limited to basic roles and cannot self-assign admin.
    PERFORM pg_temp.stage3_provision_user(u_admin,'student','Stage3 Admin Fixture','stage3_admin_fixture',NULL,true,NULL,NULL);


  INSERT INTO public.user_roles(user_id,role,is_active)
  VALUES (u_admin,'admin'::public.app_role,true);


  -- Trusted organizer path: both verification timestamps are required, the
  -- phone hash is based on normalized verified phone digits, and all related
  -- business rows must be created as a single protected operation.
    PERFORM pg_temp.stage3_provision_user(u_organizer,'organizer','Stage3 Organizer','stage3_organizer',NULL,true,NULL,NULL);
  PERFORM pg_temp.stage3_verify_phone(u_organizer,'12025550100','901001');


  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=u_organizer AND role='organizer_member'::public.app_role AND is_active
  ) THEN
    RAISE EXCEPTION 'STAGE3_ORGANIZER_ROLE_MAPPING_FAILED';
  END IF;

  PERFORM set_config('request.jwt.claim.sub',u_organizer::text,true);

  SELECT result.id,result.access_code
    INTO v_organizer_id,v_access_code
  FROM public.create_organizer('Stage 3 Regression Organizer','stage3-regression-organizer') AS result;

  IF v_organizer_id IS NULL OR nullif(v_access_code,'') IS NULL THEN
    RAISE EXCEPTION 'STAGE3_CREATE_ORGANIZER_RETURN_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizer_members
    WHERE organizer_id=v_organizer_id AND user_id=u_organizer
      AND member_role='owner' AND role='owner' AND is_active AND status='ACTIVE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organizer_plans
    WHERE organizer_id=v_organizer_id AND plan_code='FREE' AND is_active
  ) THEN
    RAISE EXCEPTION 'STAGE3_ORGANIZER_MEMBERSHIP_OR_FREE_PLAN_FAILED';
  END IF;

  v_org_hash := encode(
    extensions.digest(regexp_replace('+1 (202) 555-0100','[^0-9]+','','g'),'sha256'),
    'hex'
  );

  IF NOT EXISTS (
    SELECT 1 FROM private.organizer_free_identity_claims
    WHERE identity_hash=v_org_hash AND owner_user_id=u_organizer AND organizer_id=v_organizer_id
  ) THEN
    RAISE EXCEPTION 'STAGE3_VERIFIED_PHONE_IDENTITY_HASH_FAILED';
  END IF;

  SELECT code_hash INTO v_code_hash
  FROM private.organizer_access_codes
  WHERE organizer_id=v_organizer_id;

  IF v_code_hash IS NULL OR extensions.crypt(v_access_code,v_code_hash) IS DISTINCT FROM v_code_hash THEN
    RAISE EXCEPTION 'STAGE3_ORGANIZER_ACCESS_CODE_HASH_FAILED';
  END IF;

  -- Active and inactive viewer memberships exercise distinct resource/read and
  -- manage boundaries. They are not given owner/admin membership semantics.
    PERFORM pg_temp.stage3_provision_user(u_active_member,'student','Stage3 Active Member','stage3_active_member',NULL,true,NULL,NULL);
  PERFORM pg_temp.stage3_provision_user(u_inactive_member,'student','Stage3 Inactive Member','stage3_inactive_member',NULL,true,NULL,NULL);


  INSERT INTO public.organizer_members (
    organizer_id,user_id,member_role,is_active,role,status
  )
  VALUES
    (v_organizer_id,u_active_member,'viewer',true,'viewer','ACTIVE'),
    (v_organizer_id,u_inactive_member,'viewer',false,'viewer','INACTIVE');

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=u_active_member
      AND role='organizer_member'::public.app_role
      AND is_active=true
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id=u_inactive_member
      AND role='organizer_member'::public.app_role
      AND is_active=true
  ) THEN
    RAISE EXCEPTION 'STAGE3_ORGANIZER_MEMBER_ROLE_SYNC_FAILED';
  END IF;

  -- Same normalized phone, different raw formatting: the second FREE claim
  -- must be rejected because the verified phone hash is identical.
    PERFORM pg_temp.stage3_provision_user(u_duplicate_organizer,'organizer','Duplicate Organizer','stage3_dup_org',NULL,true,NULL,NULL);
  PERFORM pg_temp.stage3_verify_phone(u_duplicate_organizer,'12025550100','901002');


  PERFORM set_config('request.jwt.claim.sub',u_duplicate_organizer::text,true);
  v_caught := false;
  BEGIN
    PERFORM result.id FROM public.create_organizer(
      'Stage 3 Duplicate Organizer','stage3-regression-duplicate'
    ) AS result;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'FREE_ORGANIZER_ALREADY_CLAIMED' THEN
      RAISE;
    END IF;
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_DUPLICATE_FREE_ORGANIZER_PHONE_NOT_REJECTED';
  END IF;

    PERFORM pg_temp.stage3_provision_user(u_no_phone,'organizer','No Phone','stage3_no_phone',NULL,true,NULL,NULL);


  PERFORM set_config('request.jwt.claim.sub',u_no_phone::text,true);
  v_caught := false;
  BEGIN
    PERFORM result.id FROM public.create_organizer(
      'Stage 3 No Phone','stage3-regression-no-phone'
    ) AS result;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PHONE_VERIFICATION_REQUIRED' THEN
      RAISE;
    END IF;
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_UNVERIFIED_PHONE_NOT_REJECTED';
  END IF;

    PERFORM pg_temp.stage3_provision_user(u_no_email,'organizer','No Email','stage3_no_email',NULL,false,NULL,NULL);
  PERFORM pg_temp.stage3_verify_phone(u_no_email,'12025550102','901003');


  PERFORM set_config('request.jwt.claim.sub',u_no_email::text,true);
  v_caught := false;
  BEGIN
    PERFORM result.id FROM public.create_organizer(
      'Stage 3 No Email','stage3-regression-no-email'
    ) AS result;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'EMAIL_VERIFICATION_REQUIRED' THEN
      RAISE;
    END IF;
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_UNVERIFIED_EMAIL_NOT_REJECTED';
  END IF;

  -- Build one active synthetic competition with a FREE-plan entitlement.
  -- The participant registration must pass the real insert guards and preserve
  -- the referral code, registration/audit/notification, and later verification.
  INSERT INTO public.plan_entitlements(plan_code,capability,limit_value)
  VALUES
    ('FREE','participant_limit',100),
    ('FREE','certificate',10);

  INSERT INTO public.competitions (
    id,organizer_id,slug,title,status,registration_starts_at,
    registration_ends_at,visibility
  )
  VALUES (
    v_competition_id,v_organizer_id,'stage3-auth-regression',
    'Stage 3 Auth Regression','REGISTRATION_OPEN',
    clock_timestamp()-interval '1 hour',
    clock_timestamp()+interval '2 hours',
    'PUBLIC'
  );

  INSERT INTO public.registration_rules(competition_id)
  VALUES (v_competition_id);

    PERFORM pg_temp.stage3_provision_user(u_participant,'student','Stage3 Participant','stage3_participant',NULL,false,NULL,NULL);


  UPDATE private.referral_program_settings
  SET is_active=true,base_reward_amount=19,event_reward_amount=NULL,
      starts_at=NULL,ends_at=NULL
  WHERE id=true;

  PERFORM set_config('request.jwt.claim.sub',u_participant::text,true);

  SELECT result.id INTO v_registration_id
  FROM public.register_for_competition(
    v_competition_id,NULL::text,NULL::uuid,NULL::text,false,NULL::text,NULL::text,'STAGE3REF'
  ) AS result;

  IF v_registration_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.registrations
    WHERE id=v_registration_id AND competition_id=v_competition_id
      AND user_id=u_participant AND status='PENDING'
      AND coalesce((metadata->>'twibbon_completed')::boolean,false)=false
  ) THEN
    RAISE EXCEPTION 'STAGE3_COMPETITION_REGISTRATION_FAILED';
  END IF;

  SELECT re.id INTO v_event_id
  FROM public.referral_events re
  WHERE re.referred_user_id=u_participant
    AND re.referrer_user_id=u_referrer
    AND re.registration_id=v_registration_id
    AND re.competition_id=v_competition_id
    AND re.status='PENDING'
    AND re.reward_amount=19;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'STAGE3_COMPETITION_REFERRAL_ATTRIBUTION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE actor_user_id=u_participant AND action='registration.create'
      AND entity_type='registration' AND entity_id=v_registration_id::text
  ) OR NOT EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id=u_participant
      AND data->>'registration_id'=v_registration_id::text
      AND data->>'competition_id'=v_competition_id::text
  ) THEN
    RAISE EXCEPTION 'STAGE3_REGISTRATION_AUDIT_OR_NOTIFICATION_FAILED';
  END IF;

  INSERT INTO public.daily_checkins (
    user_id,checkin_date,reward_type,reward_amount,streak_day,created_at
  )
  VALUES (
    u_participant,current_date,'STAGE3_REGISTRATION',0,1,clock_timestamp()
  );

  PERFORM pg_temp.stage3_verify_email(u_participant);

  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE id=v_event_id AND status='VERIFIED' AND verified_activity='daily_checkin'
      AND verified_at IS NOT NULL AND reward_amount=19
  ) OR (SELECT edu_coin FROM public.profiles WHERE id=u_referrer) <> 49 THEN
    RAISE EXCEPTION 'STAGE3_COMPETITION_REFERRAL_EMAIL_QUALIFICATION_FAILED';
  END IF;

  -- A single active synthetic digital product lets wishlist/review policies
  -- be checked without reading or modifying any live shop product.
  INSERT INTO public.commerce_products (
    id,code,slug,name,product_type,audiences,price,currency,is_active
  )
  VALUES (
    v_product_id,'STAGE3_AUTH_REGRESSION_PRODUCT','stage3-auth-regression-product',
    'Stage 3 Synthetic Digital Item','DIGITAL_ITEM',ARRAY['student']::text[],
    1000,'IDR',true
  );

  -- Commerce owner/admin fixtures. Order stays DRAFT so payment/fulfillment
  -- side-effect triggers are not activated by this rollback-only test.
  INSERT INTO public.orders (
    id,user_id,subtotal,total
  )
  VALUES (
    v_order_id,u_participant,1000,1000
  );

  INSERT INTO public.order_items (
    order_id,product_type,product_ref,name,quantity,unit_price,line_total
  )
  VALUES (
    v_order_id,'DIGITAL',v_product_id::text,'Stage 3 test item',1,1000,1000
  );

  INSERT INTO public.payment_intents (
    id,order_id,amount,provider,status
  )
  VALUES (
    v_payment_intent_id,v_order_id,1000,'STAGE3_TEST','PENDING'
  );

  INSERT INTO public.payment_events (
    payment_intent_id,provider,provider_event_id,status,payload
  )
  VALUES (
    v_payment_intent_id,'STAGE3_TEST',
    'stage3-auth-regression-payment-event','CREATED',
    jsonb_build_object('synthetic',true)
  );

  INSERT INTO public.shipments (
    order_id,status,provider,raw_meta
  )
  VALUES (
    v_order_id,'PENDING','STAGE3_TEST',
    jsonb_build_object('synthetic',true)
  );

  -- Canonical individual participant + an active attempt. The legacy UUID
  -- participant_id and new canonical participant key both point to the same
  -- synthetic identity; no real user/roster relationship is introduced.
  INSERT INTO public.participants (
    id,competition_id,registration_id,user_id,participant_type,
    full_name,grade
  )
  VALUES (
    v_canonical_participant_id,v_competition_id,v_registration_id,
    u_participant,'INDIVIDUAL','Stage3 Participant','12'
  );

  INSERT INTO public.attempts (
    id,competition_id,participant_id,registration_id,
    canonical_participant_id,status
  )
  VALUES (
    v_attempt_id,v_competition_id,u_participant,v_registration_id,
    v_canonical_participant_id,'IN_PROGRESS'
  );

  -- Teacher roster contains only an explicit external roster entry; it does
  -- not assert a canonical teacher/student account relationship.
  INSERT INTO public.teacher_rosters (
    id,teacher_user_id,name,is_active
  )
  VALUES (
    v_roster_id,u_referrer,'Stage 3 external roster fixture',true
  );

  INSERT INTO public.roster_students (
    id,roster_id,full_name,class_name,grade,external_student_ref,is_active
  )
  VALUES (
    v_roster_student_id,v_roster_id,'Stage3 External Student',
    '12 IPA 1','12','stage3-external-student-001',true
  );

  INSERT INTO public.awards (
    id,user_id,competition_id,rank_code,title,points,visibility
  )
  VALUES (
    v_award_id,u_participant,v_competition_id,'STAGE3','Synthetic Stage 3 Award',5,'PRIVATE'
  );

  INSERT INTO public.certificates (
    id,user_id,competition_id,status,canonical_participant_id
  )
  VALUES (
    v_certificate_id,u_participant,v_competition_id,'DRAFT',v_canonical_participant_id
  );

  INSERT INTO public.certificate_assets (
    id,certificate_id,revision,public_id,asset_kind
  )
  VALUES (
    v_certificate_asset_id,v_certificate_id,1,'stage3/synthetic-certificate-preview','preview'
  );

  INSERT INTO public.commerce_product_reviews (
    id,product_id,user_id,rating,review
  )
  VALUES (
    v_review_id,v_product_id,u_participant,5,'Synthetic public review for RLS regression'
  );

  INSERT INTO public.posts (
    id,author_user_id,title,body,status
  )
  VALUES
    (v_post_published_id,u_referrer,'Stage 3 Published Post','Synthetic published content','PUBLISHED'),
    (v_post_draft_id,u_referrer,'Stage 3 Draft Post','Synthetic draft content','DRAFT');

  INSERT INTO public.comments (
    id,post_id,user_id,body,moderation_state
  )
  VALUES
    (v_comment_published_id,v_post_published_id,u_referrer,'Synthetic visible comment','PUBLISHED'),
    (v_comment_hidden_id,v_post_published_id,u_referrer,'Synthetic hidden comment','HIDDEN');

  INSERT INTO public.follows(id,follower_id,following_id,status)
  VALUES (v_follow_id,u_referrer,u_participant,'auto');

  -- Make synthetic profiles private before RLS tests below.
  UPDATE public.profiles
  SET is_public=(id = u_expired)
  WHERE id IN (
    u_referrer,u_referred,u_expired,u_fallback,u_organizer,
    u_duplicate_organizer,u_no_phone,u_no_email,u_participant,
    u_unverified_referrer,u_bad_referral,u_admin
  );

  RAISE NOTICE 'Stage 3 production-shaped behavior fixtures passed: Better Auth RPC provisioning/role mapping, trusted email/phone verification, referral lifecycle, 24-hour expiry, scheduled verifier, organizer gates, one-FREE-phone claim, registration/audit/notification.';
END;
$stage3_regression$;

-- Exercise the actual production profile guard trigger functions under
-- authenticated without letting profile RLS filter the UPDATE before a trigger
-- fires. This temporary probe table is transaction-local and uses the same
-- trigger functions installed by the schema-only production restore.
CREATE TEMP TABLE stage3_profile_guard_probe (
  id integer PRIMARY KEY,
  account_type text NOT NULL,
  edu_coin numeric NOT NULL DEFAULT 0,
  total_xp bigint NOT NULL DEFAULT 0
) ON COMMIT DROP;

CREATE TRIGGER stage3_profile_account_type_guard
BEFORE UPDATE OF account_type ON pg_temp.stage3_profile_guard_probe
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_account_type_client_mutation();

CREATE TRIGGER stage3_profile_currency_guard
BEFORE INSERT OR UPDATE OF edu_coin, total_xp ON pg_temp.stage3_profile_guard_probe
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_currency_client_mutation();

INSERT INTO pg_temp.stage3_profile_guard_probe(id, account_type, edu_coin, total_xp)
VALUES (1, 'student', 0, 0);

GRANT SELECT, INSERT, UPDATE ON TABLE pg_temp.stage3_profile_guard_probe TO authenticated;

-- RLS checks execute as the authenticated database role with actual JWT UUID
-- claims. They cover representative ownership patterns across high-risk tables.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a001',true);

DO $stage3_rls_referrer$
DECLARE
  v_count integer;
  v_affected integer;
  v_caught boolean := false;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.profiles
  WHERE id IN (
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002',
    '00000000-0000-4000-8000-00000000a009'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_PROFILE_SELF_READ_FAILED';
  END IF;

  -- Authenticated users cannot alter backend-owned profile role or wallet
  -- fields, even when they target their own row.
  v_caught := false;
  BEGIN
    UPDATE pg_temp.stage3_profile_guard_probe SET account_type='teacher' WHERE id=1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_PROFILE_ACCOUNT_TYPE_CLIENT_MUTATION_ALLOWED';
  END IF;

  v_caught := false;
  BEGIN
    UPDATE pg_temp.stage3_profile_guard_probe SET edu_coin=edu_coin+1 WHERE id=1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_PROFILE_CURRENCY_CLIENT_MUTATION_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.user_roles
  WHERE user_id IN (
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_USER_ROLE_SELF_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.follows
  WHERE id='00000000-0000-4000-8000-00000000a221';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_FOLLOWED_SIDE_RELATIONSHIP_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.referral_events
  WHERE referred_user_id='00000000-0000-4000-8000-00000000a002';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_REFERRER_SIDE_REFERRAL_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.follows WHERE id='00000000-0000-4000-8000-00000000a221';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_FOLLOWER_SIDE_RELATIONSHIP_READ_FAILED';
  END IF;
  SELECT count(*) INTO v_count FROM public.awards WHERE id='00000000-0000-4000-8000-00000000a212';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_AWARD_READ_ALLOWED';
  END IF;
  SELECT count(*) INTO v_count FROM public.certificates WHERE id='00000000-0000-4000-8000-00000000a213';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_CERTIFICATE_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_logs
  WHERE actor_user_id='00000000-0000-4000-8000-00000000a009'
    AND action='registration.create';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NON_ADMIN_AUDIT_LOG_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.collective_participants
  WHERE id='00000000-0000-4000-8000-00000000a222';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_UNRELATED_COLLECTIVE_MANAGER_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.teacher_rosters
  WHERE id='00000000-0000-4000-8000-00000000a205';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_TEACHER_ROSTER_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.roster_students
  WHERE roster_id='00000000-0000-4000-8000-00000000a205';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_TEACHER_ROSTER_STUDENTS_OWNER_READ_FAILED';
  END IF;

  -- An active teacher creates a collective participant from their own
  -- external roster. The AFTER trigger provisions a canonical collective
  -- participant with no linked student-account UUID.
  INSERT INTO public.collective_participants (
    id,competition_id,roster_student_id,managed_by_user_id,
    participant_code,full_name,class_name,grade,status
  )
  VALUES (
    '00000000-0000-4000-8000-00000000a222','00000000-0000-4000-8000-00000000a101',
    '00000000-0000-4000-8000-00000000a206',
    '00000000-0000-4000-8000-00000000a001',
    'STAGE3-COLLECTIVE-001','Stage3 External Student','12 IPA 1','12','ACTIVE'
  );

  SELECT count(*) INTO v_count
  FROM public.collective_participants
  WHERE id='00000000-0000-4000-8000-00000000a222'
    AND managed_by_user_id='00000000-0000-4000-8000-00000000a001'
    AND user_id IS NULL
    AND status='ACTIVE';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_TEACHER_COLLECTIVE_PARTICIPANT_CREATE_FAILED';
  END IF;

  UPDATE public.collective_participants
  SET full_name='Stage3 External Student Updated'
  WHERE id='00000000-0000-4000-8000-00000000a222';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_TEACHER_COLLECTIVE_PARTICIPANT_UPDATE_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.collective_participants
  WHERE id='00000000-0000-4000-8000-00000000a222'
    AND full_name='Stage3 External Student Updated'
    AND user_id IS NULL;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_COLLECTIVE_CANONICAL_SYNC_STATE_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.orders
  WHERE id='00000000-0000-4000-8000-00000000a201';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NON_OWNER_ORDER_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.attempts
  WHERE id='00000000-0000-4000-8000-00000000a203';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NON_OWNER_ATTEMPT_READ_ALLOWED';
  END IF;

  -- Referral read RPCs retain their historic columns but expose data only
  -- to authenticated referrers. NULL last_login_at avoids mirroring auth.users.
  SELECT count(*) INTO v_count
  FROM public.get_my_referrals() AS referral
  WHERE referral.referred_user_id='00000000-0000-4000-8000-00000000a002'
    AND referral.full_name='Stage3 Referred'
    AND referral.username='stage3_referred'
    AND referral.last_login_at IS NULL
    AND referral.status IN ('VERIFIED','CREDITED')
    AND referral.verified_at IS NOT NULL
    AND referral.verified_activity='daily_checkin';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_REFERRAL_V1_RETURN_CONTRACT_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.get_my_referrals_v2() AS referral
  WHERE referral.referred_user_id='00000000-0000-4000-8000-00000000a002'
    AND referral.full_name='Stage3 Referred'
    AND referral.username='stage3_referred'
    AND referral.last_login_at IS NULL
    AND referral.status IN ('VERIFIED','CREDITED')
    AND referral.verified_at IS NOT NULL
    AND referral.verified_activity='daily_checkin'
    AND referral.reward_amount=17;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_REFERRAL_V2_RETURN_CONTRACT_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.get_my_verified_referrals() AS referral
  WHERE referral.referred_user_id='00000000-0000-4000-8000-00000000a002'
    AND referral.full_name='Stage3 Referred'
    AND referral.username='stage3_referred'
    AND referral.last_login_at IS NULL;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_VERIFIED_REFERRALS_RETURN_CONTRACT_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.get_my_verified_referrals();

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'STAGE3_RLS_VERIFIED_REFERRALS_OWNER_SCOPE_FAILED';
  END IF;

  UPDATE public.profiles
  SET full_name='Cross-user tamper attempt'
  WHERE id='00000000-0000-4000-8000-00000000a002';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_PROFILE_UPDATE_ALLOWED';
  END IF;

  BEGIN
    UPDATE public.profiles SET edu_coin=edu_coin+1
    WHERE id='00000000-0000-4000-8000-00000000a001';
    RAISE EXCEPTION 'STAGE3_EXPECTED_PROFILE_CURRENCY_GUARD';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_CURRENCY_BACKEND_MANAGED' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    UPDATE public.profiles SET account_type='organizer'
    WHERE id='00000000-0000-4000-8000-00000000a001';
    RAISE EXCEPTION 'STAGE3_EXPECTED_PROFILE_ACCOUNT_TYPE_GUARD';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'ACCOUNT_TYPE_BACKEND_MANAGED' THEN
      RAISE;
    END IF;
  END;

  UPDATE public.user_settings SET theme='dark'
  WHERE user_id='00000000-0000-4000-8000-00000000a001';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_SETTINGS_OWNER_UPDATE_FAILED';
  END IF;

  UPDATE public.user_settings SET theme='light'
  WHERE user_id='00000000-0000-4000-8000-00000000a002';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_SETTINGS_UPDATE_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.organizer_plans
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_UNRELATED_ORGANIZER_PLAN_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.organizer_members
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_UNRELATED_ORGANIZER_MEMBER_READ_ALLOWED';
  END IF;

  -- Only the organizer owner can update their workspace row.
  UPDATE public.organizers SET description='RLS owner update passed'
  WHERE id IN (SELECT id FROM public.organizers WHERE owner_user_id='00000000-0000-4000-8000-00000000a005');
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NON_OWNER_ORGANIZER_UPDATE_ALLOWED';
  END IF;
END;
$stage3_rls_referrer$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a005',true);

DO $stage3_rls_organizer_owner$
DECLARE
  v_count integer;
  v_affected integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.organizer_plans
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ORGANIZER_OWNER_PLAN_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.organizer_members
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ORGANIZER_OWNER_MEMBER_READ_FAILED';
  END IF;

  UPDATE public.organizers
  SET description='Owner scope regression passed'
  WHERE owner_user_id='00000000-0000-4000-8000-00000000a005';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ORGANIZER_OWNER_UPDATE_FAILED';
  END IF;
END;
$stage3_rls_organizer_owner$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a013',true);

DO $stage3_rls_active_member$
DECLARE
  v_count integer;
  v_affected integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.organizer_plans
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ACTIVE_ORGANIZER_MEMBER_PLAN_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.organizer_members
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ACTIVE_ORGANIZER_MEMBER_LIST_READ_FAILED';
  END IF;

  UPDATE public.organizers
  SET description='Viewer must not manage organizer'
  WHERE owner_user_id='00000000-0000-4000-8000-00000000a005';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ACTIVE_VIEWER_ORGANIZER_UPDATE_ALLOWED';
  END IF;

  UPDATE public.organizer_members
  SET role='editor'
  WHERE user_id='00000000-0000-4000-8000-00000000a014';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ACTIVE_VIEWER_MEMBER_MANAGEMENT_ALLOWED';
  END IF;
END;
$stage3_rls_active_member$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a014',true);

DO $stage3_rls_inactive_member$
DECLARE
  v_count integer;
  v_affected integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.organizer_plans
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_INACTIVE_ORGANIZER_MEMBER_PLAN_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.organizer_members
  WHERE organizer_id IN (
    SELECT id FROM public.organizers
    WHERE owner_user_id='00000000-0000-4000-8000-00000000a005'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_INACTIVE_ORGANIZER_MEMBER_LIST_READ_ALLOWED';
  END IF;

  UPDATE public.organizers
  SET description='Inactive member must not manage organizer'
  WHERE owner_user_id='00000000-0000-4000-8000-00000000a005';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_INACTIVE_MEMBER_ORGANIZER_UPDATE_ALLOWED';
  END IF;
END;
$stage3_rls_inactive_member$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a002',true);

DO $stage3_rls_referred$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.profiles
  WHERE id IN (
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_RELATED_PROFILE_ISOLATION_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.referral_events
  WHERE referred_user_id='00000000-0000-4000-8000-00000000a002';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_REFERRED_SIDE_REFERRAL_READ_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.get_my_verified_referrals()) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_VERIFIED_REFERRALS_CROSS_USER_LEAK';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.teacher_rosters
  WHERE id='00000000-0000-4000-8000-00000000a205';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_UNRELATED_TEACHER_ROSTER_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.roster_students
  WHERE roster_id='00000000-0000-4000-8000-00000000a205';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_UNRELATED_ROSTER_STUDENT_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.orders
  WHERE id='00000000-0000-4000-8000-00000000a201';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_ORDER_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.payment_intents
  WHERE id='00000000-0000-4000-8000-00000000a202';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_PAYMENT_INTENT_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.daily_checkins
  WHERE user_id IN (
    '00000000-0000-4000-8000-00000000a002',
    '00000000-0000-4000-8000-00000000a004'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_DAILY_CHECKIN_OWNERSHIP_FAILED';
  END IF;
END;
$stage3_rls_referred$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a009',true);

DO $stage3_rls_participant$
DECLARE
  v_count integer;
  v_affected integer;
  v_caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.collective_participants (
      id,competition_id,roster_student_id,managed_by_user_id,
      participant_code,full_name,status
    )
    VALUES (
      '00000000-0000-4000-8000-00000000a223',
      '00000000-0000-4000-8000-00000000a101',
      '00000000-0000-4000-8000-00000000a206',
      '00000000-0000-4000-8000-00000000a009',
      'STAGE3-STUDENT-FORGED-001','Forged Student Managed Record','ACTIVE'
    );
    RAISE EXCEPTION 'STAGE3_EXPECTED_COLLECTIVE_MANAGER_GUARD';
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_RLS_STUDENT_COLLECTIVE_MANAGER_INSERT_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.collective_participants
  WHERE id='00000000-0000-4000-8000-00000000a222';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_STUDENT_COLLECTIVE_PARTICIPANT_READ_ALLOWED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.registrations
  WHERE id IN (
    SELECT id FROM public.registrations
    WHERE competition_id='00000000-0000-4000-8000-00000000a101'
  );

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_REGISTRATION_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.participants
  WHERE id='00000000-0000-4000-8000-00000000a204'
    AND user_id='00000000-0000-4000-8000-00000000a009';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CANONICAL_PARTICIPANT_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.attempts
  WHERE id='00000000-0000-4000-8000-00000000a203';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ATTEMPT_OWNER_READ_FAILED';
  END IF;

  IF v_count <> 1 THEN
  END IF;
  IF v_count <> 0 THEN
  END IF;

  SELECT count(*) INTO v_count FROM public.awards WHERE id='00000000-0000-4000-8000-00000000a212';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_AWARD_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.certificates WHERE id='00000000-0000-4000-8000-00000000a213';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CERTIFICATE_OWNER_READ_FAILED';
  END IF;
  SELECT count(*) INTO v_count FROM public.commerce_products WHERE id='00000000-0000-4000-8000-00000000a215';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ACTIVE_COMMERCE_PRODUCT_PUBLIC_READ_FAILED';
  END IF;
  SELECT count(*) INTO v_count FROM public.commerce_product_reviews WHERE id='00000000-0000-4000-8000-00000000a216';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_PRODUCT_REVIEW_PUBLIC_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.plan_entitlements
  WHERE plan_code='FREE' AND capability='certificate' AND limit_value=10;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_PLAN_ENTITLEMENT_READ_FAILED';
  END IF;
  UPDATE public.plan_entitlements SET limit_value=11
  WHERE plan_code='FREE' AND capability='certificate';
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NON_ADMIN_PLAN_ENTITLEMENT_UPDATE_ALLOWED';
  END IF;

  INSERT INTO public.commerce_product_wishlist(product_id,user_id)
  VALUES ('00000000-0000-4000-8000-00000000a215','00000000-0000-4000-8000-00000000a009');

  SELECT count(*) INTO v_count FROM public.commerce_product_wishlist
  WHERE product_id='00000000-0000-4000-8000-00000000a215' AND user_id='00000000-0000-4000-8000-00000000a009';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_WISHLIST_OWNER_INSERT_READ_FAILED';
  END IF;

  BEGIN
    INSERT INTO public.commerce_product_wishlist(product_id,user_id)
    VALUES ('00000000-0000-4000-8000-00000000a215','00000000-0000-4000-8000-00000000a001');
    RAISE EXCEPTION 'STAGE3_EXPECTED_WISHLIST_OWNER_GUARD';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  SELECT count(*) INTO v_count
  FROM public.orders
  WHERE id='00000000-0000-4000-8000-00000000a201';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ORDER_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.order_items
  WHERE order_id='00000000-0000-4000-8000-00000000a201';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ORDER_ITEM_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.payment_intents
  WHERE id='00000000-0000-4000-8000-00000000a202';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_PAYMENT_INTENT_OWNER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.shipments
  WHERE order_id='00000000-0000-4000-8000-00000000a201';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_SHIPMENT_OWNER_READ_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.payment_events
      WHERE provider_event_id='stage3-auth-regression-payment-event') <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_PAYMENT_EVENT_VISIBLE_TO_ORDER_OWNER';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.notifications
  WHERE user_id='00000000-0000-4000-8000-00000000a009';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NOTIFICATION_OWNER_READ_FAILED';
  END IF;

  UPDATE public.notifications
  SET read_at=clock_timestamp()
  WHERE user_id='00000000-0000-4000-8000-00000000a009';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NOTIFICATION_OWNER_UPDATE_FAILED';
  END IF;

  UPDATE public.notifications SET read_at=NULL
  WHERE user_id='00000000-0000-4000-8000-00000000a001';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_CROSS_USER_NOTIFICATION_UPDATE_ALLOWED';
  END IF;

  -- A caller cannot forge another participant UUID in a direct registration.
  BEGIN
    INSERT INTO public.registrations(competition_id,user_id)
    VALUES (
      '00000000-0000-4000-8000-00000000a101',
      '00000000-0000-4000-8000-00000000a001'
    );
    RAISE EXCEPTION 'STAGE3_EXPECTED_REGISTRATION_OWNER_GUARD';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'AUTHORIZATION_REQUIRED' THEN
      RAISE;
    END IF;
  END;
END;
$stage3_rls_participant$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a012',true);

DO $stage3_rls_admin$
DECLARE
  v_count integer;
  v_affected integer;
  v_caught boolean := false;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.user_roles
  WHERE user_id IN (
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002',
    '00000000-0000-4000-8000-00000000a005',
    '00000000-0000-4000-8000-00000000a009',
    '00000000-0000-4000-8000-00000000a012'
  );

  -- A business admin still uses the SQL role authenticated; role-table
  -- membership must not bypass backend-managed profile fields.
  v_caught := false;
  BEGIN
    UPDATE pg_temp.stage3_profile_guard_probe SET account_type='teacher' WHERE id=1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_PROFILE_ADMIN_ACCOUNT_TYPE_MUTATION_ALLOWED';
  END IF;

  v_caught := false;
  BEGIN
    UPDATE pg_temp.stage3_profile_guard_probe SET total_xp=total_xp+1 WHERE id=1;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_PROFILE_ADMIN_CURRENCY_MUTATION_ALLOWED';
  END IF;

  IF v_count <> 6 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_USER_ROLES_OVERLAY_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_logs
  WHERE actor_user_id='00000000-0000-4000-8000-00000000a009'
    AND action='registration.create';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_AUDIT_LOG_READ_FAILED';
  END IF;

  UPDATE public.organizers
  SET description='Admin overlay regression passed'
  WHERE owner_user_id='00000000-0000-4000-8000-00000000a005';
  GET DIAGNOSTICS v_affected=ROW_COUNT;

  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_ORGANIZER_UPDATE_FAILED';
  END IF;

  IF v_count <> 1 THEN
  END IF;
  IF v_count <> 0 THEN
  END IF;

  SELECT count(*) INTO v_count FROM public.awards WHERE id='00000000-0000-4000-8000-00000000a212';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_AWARD_READ_FAILED';
  END IF;
  SELECT count(*) INTO v_count FROM public.certificates WHERE id='00000000-0000-4000-8000-00000000a213';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_CERTIFICATE_READ_FAILED';
  END IF;
  SELECT count(*) INTO v_count FROM public.commerce_product_wishlist
  WHERE product_id='00000000-0000-4000-8000-00000000a215' AND user_id='00000000-0000-4000-8000-00000000a012';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_WISHLIST_READ_FAILED';
  END IF;
  SELECT count(*) INTO v_count FROM public.plan_entitlements
  WHERE plan_code='FREE' AND capability='certificate' AND limit_value=10;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_PLAN_ENTITLEMENT_READ_FAILED';
  END IF;
  UPDATE public.plan_entitlements SET limit_value=11
  WHERE plan_code='FREE' AND capability='certificate';
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_PLAN_ENTITLEMENT_UPDATE_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.orders
  WHERE id='00000000-0000-4000-8000-00000000a201';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_ORDER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.order_items
  WHERE order_id='00000000-0000-4000-8000-00000000a201';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_ORDER_ITEM_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.payment_intents
  WHERE id='00000000-0000-4000-8000-00000000a202';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_PAYMENT_INTENT_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.payment_events
  WHERE provider_event_id='stage3-auth-regression-payment-event';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_PAYMENT_EVENT_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.shipments
  WHERE order_id='00000000-0000-4000-8000-00000000a201';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_SHIPMENT_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.attempts
  WHERE id='00000000-0000-4000-8000-00000000a203';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_ATTEMPT_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.collective_participants
  WHERE id='00000000-0000-4000-8000-00000000a222';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_COLLECTIVE_PARTICIPANT_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.teacher_rosters
  WHERE id='00000000-0000-4000-8000-00000000a205';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_TEACHER_ROSTER_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count FROM public.roster_students
  WHERE id='00000000-0000-4000-8000-00000000a206';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_ROSTER_STUDENT_READ_FAILED';
  END IF;

  UPDATE public.orders
  SET admin_review_note='Stage 3 admin RLS check'
  WHERE id='00000000-0000-4000-8000-00000000a201';
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_ORDER_UPDATE_FAILED';
  END IF;

  UPDATE public.payment_intents
  SET raw_meta=jsonb_build_object('stage3_admin_review',true)
  WHERE id='00000000-0000-4000-8000-00000000a202';
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_PAYMENT_INTENT_UPDATE_FAILED';
  END IF;

  UPDATE public.shipments
  SET raw_meta=jsonb_build_object('stage3_admin_review',true)
  WHERE order_id='00000000-0000-4000-8000-00000000a201';
  GET DIAGNOSTICS v_affected=ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ADMIN_SHIPMENT_UPDATE_FAILED';
  END IF;
END;
$stage3_rls_admin$;

RESET ROLE;

-- An anonymous caller receives no private profile rows and cannot invoke the
-- protected organizer creation RPC.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub','',true);

DO $stage3_rls_anon$
DECLARE
  v_count integer;
  v_caught boolean := false;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.profiles
  WHERE id IN (
    '00000000-0000-4000-8000-00000000a001',
    '00000000-0000-4000-8000-00000000a002'
  );

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_PRIVATE_PROFILE_READ_ALLOWED';
  END IF;

  IF (SELECT count(*) FROM public.profiles
      WHERE id='00000000-0000-4000-8000-00000000a003') <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_PUBLIC_PROFILE_READ_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.posts WHERE id='00000000-0000-4000-8000-00000000a217') <> 1
     OR (SELECT count(*) FROM public.posts WHERE id='00000000-0000-4000-8000-00000000a218') <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_POST_PUBLIC_DRAFT_VISIBILITY_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.comments WHERE id='00000000-0000-4000-8000-00000000a219') <> 1
     OR (SELECT count(*) FROM public.comments WHERE id='00000000-0000-4000-8000-00000000a220') <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_COMMENT_MODERATION_VISIBILITY_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.commerce_product_reviews WHERE id='00000000-0000-4000-8000-00000000a216') <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_PRODUCT_REVIEW_PUBLIC_READ_FAILED';
  END IF;

  IF (SELECT count(*) FROM public.follows WHERE id='00000000-0000-4000-8000-00000000a221') <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_FOLLOW_RELATIONSHIP_LEAK';
  END IF;

  IF (SELECT count(*) FROM public.commerce_products WHERE id='00000000-0000-4000-8000-00000000a215') <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_ACTIVE_PRODUCT_READ_FAILED';
  END IF;

  -- Referral read RPCs are authenticated-only after the reviewed Stage 3
  -- ACL change. Anonymous callers cannot execute SECURITY DEFINER functions.
  v_caught := false;
  BEGIN
    PERFORM 1 FROM public.get_my_verified_referrals();
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;
  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_VERIFIED_REFERRAL_RPC_EXECUTE_ALLOWED';
  END IF;

  BEGIN
    PERFORM result.id FROM public.create_organizer(
      'Stage 3 Anonymous','stage3-anonymous-create'
    ) AS result;
  EXCEPTION WHEN insufficient_privilege THEN
    v_caught := true;
  END;

  IF NOT v_caught THEN
    RAISE EXCEPTION 'STAGE3_ANON_ORGANIZER_FUNCTION_EXECUTE_ALLOWED';
  END IF;
END;
$stage3_rls_anon$;

RESET ROLE;

ROLLBACK;

\echo 'Stage 3 production-shaped regression passed; every synthetic insert/update was rolled back.'
