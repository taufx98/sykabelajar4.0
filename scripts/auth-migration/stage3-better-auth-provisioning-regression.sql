-- Full-schema disposable acceptance for Better Auth Stage 3 provisioning.
-- Synthetic UUIDs only. Run only after AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql
-- and the generated 69-FK cutover have been applied to a disposable restore.
-- Everything is inside one transaction and is rolled back.

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO private.referral_program_settings (
  id, is_active, base_reward_amount, event_reward_amount, starts_at, ends_at
)
VALUES (true, true, 5, NULL, NULL, NULL)
ON CONFLICT (id) DO UPDATE
SET is_active = true,
    base_reward_amount = 5,
    event_reward_amount = NULL,
    starts_at = NULL,
    ends_at = NULL;

SET LOCAL ROLE service_role;

DO $stage3_better_auth_provisioning$
DECLARE
  u_referrer constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  u_referred constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  u_student constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  u_teacher constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  u_organizer_one constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';
  u_organizer_two constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6';
  u_rejected constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7';
  v_role public.app_role;
  v_count integer;
  v_amount numeric;
  v_result boolean;
  v_message text;
  v_hash constant text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
BEGIN
  IF has_function_privilege(
       'anon',
       'public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'service_role',
       'public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PROVISION_RPC_PRIVILEGE_BOUNDARY_FAILED';
  END IF;

  -- A public registration cannot bootstrap the admin role.
  BEGIN
    PERFORM public.better_auth_provision_user(
      u_rejected, 'admin', 'Rejected Admin', 'ba-rejected-admin',
      NULL, false, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_SELF_PROVISION_ALLOWED';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'UNSUPPORTED_ACCOUNT_TYPE' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = u_rejected)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = u_rejected) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REJECTED_ACCOUNT_PERSISTED';
  END IF;

  -- Basic account-type mapping is performed in Postgres, not from JWT role.
  PERFORM public.better_auth_provision_user(
    u_student, 'student', 'Better Auth Student', 'ba-student',
    NULL, false, NULL, NULL, NULL, NULL
  );
  PERFORM public.better_auth_provision_user(
    u_teacher, 'teacher', 'Better Auth Teacher', 'ba-teacher',
    NULL, true, NULL, NULL, NULL, NULL
  );
  PERFORM public.better_auth_provision_user(
    u_organizer_one, 'organizer', 'Better Auth Organizer One', 'ba-organizer-one',
    NULL, true, NULL, NULL, NULL, NULL
  );
  PERFORM public.better_auth_provision_user(
    u_organizer_two, 'organizer', 'Better Auth Organizer Two', 'ba-organizer-two',
    NULL, true, NULL, NULL, NULL, NULL
  );

  IF EXISTS (
    SELECT ids.user_id
    FROM (VALUES
      (u_student), (u_teacher), (u_organizer_one), (u_organizer_two)
    ) AS ids(user_id)
    LEFT JOIN public.profiles p ON p.id = ids.user_id
    LEFT JOIN public.user_settings us ON us.user_id = ids.user_id
    WHERE p.id IS NULL OR us.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_IDENTITY_PROFILE_SETTINGS_UUID_MISMATCH';
  END IF;

  SELECT role INTO v_role FROM public.user_roles WHERE user_id = u_student;
  IF v_role IS DISTINCT FROM 'student'::public.app_role THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_STUDENT_ROLE_MAPPING_FAILED';
  END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = u_teacher;
  IF v_role IS DISTINCT FROM 'teacher'::public.app_role THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_TEACHER_ROLE_MAPPING_FAILED';
  END IF;
  SELECT role INTO v_role FROM public.user_roles WHERE user_id = u_organizer_one;
  IF v_role IS DISTINCT FROM 'organizer_member'::public.app_role THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ORGANIZER_ROLE_MAPPING_FAILED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id IN (u_student,u_teacher,u_organizer_one,u_organizer_two)
      AND role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PUBLIC_PROVISION_GRANTED_ADMIN';
  END IF;


  -- A retry must not overwrite an edited profile, add a second role, or
  -- reactivate a disabled role, even if a repeated payload changes accountType.
  UPDATE public.profiles SET full_name = 'Admin Edited Profile'
  WHERE id = u_student;
  UPDATE public.user_roles SET is_active = false
  WHERE user_id = u_student AND role = 'student'::public.app_role;

  PERFORM public.better_auth_provision_user(
    u_student, 'teacher', 'Retry Must Not Overwrite', 'ba-student',
    NULL, false, NULL, NULL, NULL, NULL
  );

  SELECT count(*) INTO v_count FROM public.user_roles WHERE user_id = u_student;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_RETRY_ADDED_SECOND_ROLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = u_student
      AND role = 'student'::public.app_role
      AND is_active = false
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_RETRY_REACTIVATED_OR_REPLACED_ROLE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = u_student AND full_name = 'Admin Edited Profile'
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_RETRY_OVERWROTE_PROFILE';
  END IF;

  -- Referral remains pending until a qualifying activity and email verification
  -- both exist inside the original 24-hour window.
  PERFORM public.better_auth_provision_user(
    u_referrer, 'student', 'Referral Referrer', 'ba-referrer',
    NULL, true, NULL, NULL, NULL, NULL
  );
  INSERT INTO public.referral_codes(user_id,code)
  VALUES (u_referrer, 'STAGE3-BA-REFERRER');

  PERFORM public.better_auth_provision_user(
    u_referred, 'student', 'Referral Referred', 'ba-referred',
    'STAGE3-BA-REFERRER', false, NULL, NULL, NULL, NULL
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE referrer_user_id = u_referrer
      AND referred_user_id = u_referred
      AND status = 'PENDING'
      AND verified_at IS NULL
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_PENDING_EVENT_MISSING';
  END IF;

  -- Re-running the Better Auth provisioning hook must not create a second
  -- legacy/referral signup event, overwrite the first profile, or change role.
  PERFORM public.better_auth_provision_user(
    u_referred, 'teacher', 'Retry Must Not Replace Referral Profile',
    'ba-referred-retry', 'UNKNOWN-RETRY-CODE', false,
    NULL, NULL, NULL, NULL
  );
  SELECT count(*) INTO v_count
  FROM public.referral_events
  WHERE referred_user_id = u_referred;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_PROVISION_RETRY_DUPLICATED_EVENT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = u_referred
      AND full_name = 'Referral Referred'
      AND username = 'ba-referred'
      AND account_type = 'student'
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_PROVISION_RETRY_OVERWROTE_PROFILE';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.user_roles
  WHERE user_id = u_referred AND role = 'student'::public.app_role;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_PROVISION_RETRY_CHANGED_ROLE';
  END IF;

  INSERT INTO public.daily_checkins (
    user_id, checkin_date, reward_type, reward_amount, streak_day
  )
  VALUES (u_referred, current_date, 'STAGE3_AUTH_REGRESSION', 0, 1);

  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE referred_user_id = u_referred
      AND status = 'PENDING'
      AND verified_at IS NULL
      AND verified_activity = 'daily_checkin'
      AND last_checked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_ACTIVITY_NOT_RECORDED';
  END IF;

  SELECT public.better_auth_complete_email_verification(
    u_referred, clock_timestamp()
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_EMAIL_VERIFICATION_NOT_APPLIED';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.referral_events
    WHERE referred_user_id = u_referred
      AND status = 'VERIFIED'
      AND verified_at IS NOT NULL
      AND verified_activity = 'daily_checkin'
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_NOT_QUALIFIED_AFTER_EMAIL';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.edu_coin_ledger
  WHERE user_id = u_referrer
    AND event_type = 'REFERRAL_REGISTRATION';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_LEDGER_NOT_IDEMPOTENT';
  END IF;
  SELECT edu_coin INTO v_amount FROM public.profiles WHERE id = u_referrer;
  IF v_amount <> 5 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_REWARD_AMOUNT_WRONG';
  END IF;

  SELECT public.better_auth_complete_email_verification(
    u_referred, clock_timestamp()
  ) INTO v_result;
  IF v_result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_EMAIL_VERIFICATION_RETRY_NOT_IDEMPOTENT';
  END IF;
  SELECT count(*) INTO v_count
  FROM public.edu_coin_ledger
  WHERE user_id = u_referrer
    AND event_type = 'REFERRAL_REGISTRATION';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REFERRAL_DUPLICATE_REWARD';
  END IF;

  -- Trusted Telegram phone verification stores only hash + provider subject.
  SELECT public.better_auth_complete_phone_verification(
    u_organizer_one, clock_timestamp(), v_hash, 'telegram', '881234567801', 13
  ) INTO v_result;
  IF v_result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PHONE_VERIFICATION_NOT_APPLIED';
  END IF;
  IF has_function_privilege(
       'authenticated',
       'public.better_auth_complete_phone_verification(uuid,timestamptz,text,text,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_CLIENT_CAN_FORGE_PHONE_VERIFICATION';
  END IF;
  PERFORM public.better_auth_complete_phone_verification(
    u_organizer_two, clock_timestamp(), v_hash, 'telegram', '881234567802', 13
  );

  RAISE NOTICE 'Better Auth identity provisioning, role, referral/email, phone verification and no-shadow-user assertions passed.';
END;
$stage3_better_auth_provisioning$;

-- private.app_users is intentionally inaccessible through the service_role
-- schema path, exactly like production. Inspect the private projection only
-- as postgres in this disposable restore; never grant the Worker direct access.
RESET ROLE;
SET LOCAL ROLE postgres;
DO $stage3_better_auth_private_projection$
DECLARE
  u_referrer constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  u_referred constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  u_student constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  u_teacher constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  u_organizer_one constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';
  u_organizer_two constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6';
  u_rejected constant uuid := 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7';
  v_hash constant text := 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
BEGIN
  IF has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_SERVICE_ROLE_PRIVATE_SCHEMA_USAGE_UNEXPECTED';
  END IF;

  IF EXISTS (SELECT 1 FROM private.app_users WHERE id = u_rejected) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_REJECTED_PRIVATE_IDENTITY_PERSISTED';
  END IF;

  IF EXISTS (
    SELECT ids.user_id
    FROM (VALUES (u_student),(u_teacher),(u_organizer_one),(u_organizer_two))
      AS ids(user_id)
    LEFT JOIN private.app_users au ON au.id = ids.user_id
    LEFT JOIN public.profiles p ON p.id = ids.user_id
    LEFT JOIN public.user_settings us ON us.user_id = ids.user_id
    WHERE au.id IS NULL OR p.id IS NULL OR us.user_id IS NULL
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PRIVATE_IDENTITY_PROFILE_SETTINGS_UUID_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (u_student,u_teacher,u_organizer_one,u_organizer_two)
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_SHADOW_AUTH_USER_CREATED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = u_referred AND email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_EMAIL_VERIFICATION_PROJECTION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = u_organizer_one
      AND phone_verified_at IS NOT NULL
      AND verified_phone_identity_hash = v_hash
      AND phone_verification_provider = 'telegram'
      AND phone_verification_subject = '881234567801'
  ) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PHONE_PROJECTION_INVALID';
  END IF;
END;
$stage3_better_auth_private_projection$;


-- create_organizer must run as a normal authenticated JWT caller.
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}', true);
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

DO $stage3_better_auth_organizer_one$
BEGIN
  PERFORM * FROM public.create_organizer('Better Auth Organizer One','ba-organizer-one-workspace');
END;
$stage3_better_auth_organizer_one$;

SELECT set_config('request.jwt.claims',
  '{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}', true);
SELECT set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);

DO $stage3_better_auth_organizer_two$
DECLARE
  v_message text;
BEGIN
  BEGIN
    PERFORM * FROM public.create_organizer('Better Auth Organizer Two','ba-organizer-two-workspace');
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_PHONE_REUSE_WAS_ALLOWED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'FREE_ORGANIZER_ALREADY_CLAIMED' THEN
      RAISE;
    END IF;
  END;
END;
$stage3_better_auth_organizer_two$;

RESET ROLE;
ROLLBACK;
