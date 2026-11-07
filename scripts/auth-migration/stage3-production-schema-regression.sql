\set ON_ERROR_STOP on

-- Production-shaped Stage 3 regression against the schema-only disposable restore.
-- This script inserts only fixed synthetic identities and business fixtures.
-- It must run only after the baseline restore has proven auth.users/profiles empty.
-- The entire test suite is rolled back; never run it against a hosted project.

BEGIN;

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
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
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
     OR EXISTS (SELECT 1 FROM public.payment_events WHERE provider_event_id='stage3-auth-regression-payment-event') THEN
    RAISE EXCEPTION 'STAGE3_FIXTURE_BUSINESS_UUID_COLLISION';
  END IF;

  IF (SELECT count(*) FROM auth.users) <> 0
     OR (SELECT count(*) FROM public.profiles) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RESTORE_MUST_START_WITH_ZERO_AUTH_AND_PROFILE_ROWS';
  END IF;

  v_auth_create_organizer := has_function_privilege(
    'authenticated','public.create_organizer(text,text)','EXECUTE');
  v_anon_create_organizer := has_function_privilege(
    'anon','public.create_organizer(text,text)','EXECUTE');
  v_auth_register := has_function_privilege(
    'authenticated','public.register_for_competition(uuid,text,uuid,text,boolean,text,text,text)','EXECUTE');
  v_auth_apply_referral := has_function_privilege(
    'authenticated','private.apply_referral_qualification(uuid,text,timestamptz)','EXECUTE');

  IF v_auth_create_organizer IS DISTINCT FROM true
     OR v_anon_create_organizer IS DISTINCT FROM false
     OR v_auth_register IS DISTINCT FROM true
     OR v_auth_apply_referral IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'STAGE3_FUNCTION_GRANT_CONTRACT_DRIFT: authenticated_create_organizer=%, anon_create_organizer=%, authenticated_register=%, authenticated_apply_referral=%',
      v_auth_create_organizer,v_anon_create_organizer,v_auth_register,v_auth_apply_referral;
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

  -- Verified teacher referrer; signup trigger must normalize profile fields and
  -- map the teacher business role without placing it in the PostgreSQL JWT role.
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_referrer,'authenticated','authenticated','stage3-referrer@example.invalid','',
    clock_timestamp(),'{}'::jsonb,
    jsonb_build_object(
      'account_type','teacher',
      'full_name','  Stage3 Teacher Referrer  ',
      'username','  Stage3_Referrer  ',
      'institution','  sekolah uji  ',
      'grade','12'
    ),
    clock_timestamp(),clock_timestamp()
  );

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

  -- A client-supplied privileged account type must be normalized to student.
  -- The signup referral trigger also snapshots the current reward and creates
  -- exactly one PENDING event, but does not grant any privileged role.
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_referred,'authenticated','authenticated','stage3-referred@example.invalid','',
    NULL,'{}'::jsonb,
    jsonb_build_object(
      'account_type','admin',
      'full_name','Stage3 Referred',
      'username','stage3_referred',
      'referral_id',u_referrer::text
    ),
    clock_timestamp(),clock_timestamp()
  );

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

  -- A settings change after signup must not alter the snapshotted reward.
  UPDATE private.referral_program_settings SET base_reward_amount=99 WHERE id=true;

  UPDATE auth.users
  SET email_confirmed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=u_referred AND email_confirmed_at IS NULL;

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
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_expired,'authenticated','authenticated','stage3-expired@example.invalid','',
    clock_timestamp(),'{}'::jsonb,
    jsonb_build_object('account_type','student','full_name','Stage3 Expired','username','stage3_expired'),
    clock_timestamp(),clock_timestamp()
  );

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
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_fallback,'authenticated','authenticated','stage3-fallback@example.invalid','',
    clock_timestamp(),'{}'::jsonb,
    jsonb_build_object('account_type','student','full_name','Stage3 Fallback','username','stage3_fallback'),
    clock_timestamp(),clock_timestamp()
  );

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

  -- The unverified referrer must not be accepted for signup attribution.
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_unverified_referrer,'authenticated','authenticated','stage3-unverified-ref@example.invalid','',
    NULL,'{}'::jsonb,
    jsonb_build_object('account_type','teacher','full_name','Unverified Referrer','username','stage3_unverified_ref'),
    clock_timestamp(),clock_timestamp()
  );

  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_bad_referral,'authenticated','authenticated','stage3-bad-referral@example.invalid','',
    NULL,'{}'::jsonb,
    jsonb_build_object(
      'account_type','student','full_name','Bad Referral','username','stage3_bad_referral',
      'referral_id',u_unverified_referrer::text
    ),
    clock_timestamp(),clock_timestamp()
  );

  IF EXISTS (SELECT 1 FROM public.referral_events WHERE referred_user_id=u_bad_referral) THEN
    RAISE EXCEPTION 'STAGE3_UNVERIFIED_REFERRER_WAS_ACCEPTED';
  END IF;

  -- Simulate an already-approved admin assigned by a trusted database owner.
  -- Signup metadata itself remains student-only and cannot self-assign admin.
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_admin,'authenticated','authenticated','stage3-admin@example.invalid','',
    clock_timestamp(),'{}'::jsonb,
    jsonb_build_object(
      'account_type','student',
      'full_name','Stage3 Admin Fixture',
      'username','stage3_admin_fixture'
    ),
    clock_timestamp(),clock_timestamp()
  );

  INSERT INTO public.user_roles(user_id,role,is_active)
  VALUES (u_admin,'admin'::public.app_role,true);


  -- Trusted organizer path: both verification timestamps are required, the
  -- phone hash is based on normalized verified phone digits, and all related
  -- business rows must be created as a single protected operation.
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_organizer,'authenticated','authenticated','stage3-organizer@example.invalid','',
    clock_timestamp(),'+1 (202) 555-0100',clock_timestamp(),'{}'::jsonb,
    jsonb_build_object('account_type','organizer','full_name','Stage3 Organizer','username','stage3_organizer'),
    clock_timestamp(),clock_timestamp()
  );

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
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES
    (
      u_active_member,'authenticated','authenticated','stage3-active-member@example.invalid','',
      clock_timestamp(),'{}'::jsonb,
      jsonb_build_object('account_type','student','full_name','Stage3 Active Member','username','stage3_active_member'),
      clock_timestamp(),clock_timestamp()
    ),
    (
      u_inactive_member,'authenticated','authenticated','stage3-inactive-member@example.invalid','',
      clock_timestamp(),'{}'::jsonb,
      jsonb_build_object('account_type','student','full_name','Stage3 Inactive Member','username','stage3_inactive_member'),
      clock_timestamp(),clock_timestamp()
    );

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
  -- must be rejected even though the raw auth.users.phone strings differ.
  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_duplicate_organizer,'authenticated','authenticated','stage3-organizer-duplicate@example.invalid','',
    clock_timestamp(),'+1-202-555-0100',clock_timestamp(),'{}'::jsonb,
    jsonb_build_object('account_type','organizer','full_name','Duplicate Organizer','username','stage3_dup_org'),
    clock_timestamp(),clock_timestamp()
  );

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

  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_no_phone,'authenticated','authenticated','stage3-no-phone@example.invalid','',
    clock_timestamp(),'+1 (202) 555-0101',NULL,'{}'::jsonb,
    jsonb_build_object('account_type','organizer','full_name','No Phone','username','stage3_no_phone'),
    clock_timestamp(),clock_timestamp()
  );

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

  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    phone,phone_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_no_email,'authenticated','authenticated','stage3-no-email@example.invalid','',
    NULL,'+1 (202) 555-0102',clock_timestamp(),'{}'::jsonb,
    jsonb_build_object('account_type','organizer','full_name','No Email','username','stage3_no_email'),
    clock_timestamp(),clock_timestamp()
  );

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
  VALUES ('FREE','participant_limit',100);

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

  INSERT INTO auth.users (
    id,aud,role,email,encrypted_password,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  )
  VALUES (
    u_participant,'authenticated','authenticated','stage3-participant@example.invalid','',
    NULL,'{}'::jsonb,
    jsonb_build_object('account_type','student','full_name','Stage3 Participant','username','stage3_participant'),
    clock_timestamp(),clock_timestamp()
  );

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

  UPDATE auth.users
  SET email_confirmed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE id=u_participant AND email_confirmed_at IS NULL;

  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE id=v_event_id AND status='VERIFIED' AND verified_activity='daily_checkin'
      AND verified_at IS NOT NULL AND reward_amount=19
  ) OR (SELECT edu_coin FROM public.profiles WHERE id=u_referrer) <> 49 THEN
    RAISE EXCEPTION 'STAGE3_COMPETITION_REFERRAL_EMAIL_QUALIFICATION_FAILED';
  END IF;

  -- Commerce owner/admin fixtures. Order stays DRAFT so payment/fulfillment
  -- side-effect triggers are not activated by this rollback-only test.
  INSERT INTO public.orders (
    id,user_id,subtotal,total
  )
  VALUES (
    v_order_id,u_participant,1000,1000
  );

  INSERT INTO public.order_items (
    order_id,product_type,name,quantity,unit_price,line_total
  )
  VALUES (
    v_order_id,'DIGITAL','Stage 3 test item',1,1000,1000
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

  -- Make synthetic profiles private before RLS tests below.
  UPDATE public.profiles
  SET is_public=(id = u_expired)
  WHERE id IN (
    u_referrer,u_referred,u_expired,u_fallback,u_organizer,
    u_duplicate_organizer,u_no_phone,u_no_email,u_participant,
    u_unverified_referrer,u_bad_referral,u_admin
  );

  RAISE NOTICE 'Stage 3 production-shaped behavior fixtures passed: signup/role mapping, email/referral lifecycle, 24-hour expiry, scheduled referral verifier, organizer phone/email gates, one-FREE-phone claim, registration/referral/audit/notification.';
END;
$stage3_regression$;

-- RLS checks execute as the authenticated database role with actual JWT UUID
-- claims. They cover representative ownership patterns across high-risk tables.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a001',true);

DO $stage3_rls_referrer$
DECLARE
  v_count integer;
  v_affected integer;
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
  FROM public.referral_events
  WHERE referred_user_id='00000000-0000-4000-8000-00000000a002';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_RLS_REFERRER_SIDE_REFERRAL_READ_FAILED';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.audit_logs
  WHERE actor_user_id='00000000-0000-4000-8000-00000000a009'
    AND action='registration.create';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_NON_ADMIN_AUDIT_LOG_READ_ALLOWED';
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

  -- This legacy RPC is intentionally executable by PUBLIC/anon in production.
  -- Its auth.uid() predicate must still scope results to the calling referrer.
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
BEGIN
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

  -- PUBLIC/anon has EXECUTE by production design, but no auth.uid() means
  -- the SECURITY DEFINER RPC must return no private referral rows.
  IF (SELECT count(*) FROM public.get_my_verified_referrals()) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_RLS_ANON_VERIFIED_REFERRAL_LEAK';
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
