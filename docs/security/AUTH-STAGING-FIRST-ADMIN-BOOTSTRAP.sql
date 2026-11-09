-- MANUAL, STAGING-ONLY FIRST ADMIN BOOTSTRAP.
-- Never apply this file to production. It is not a migration and does not create
-- a public endpoint. Run only in the isolated FREE Supabase project:
--   ydamszdfsxqisanazdkb
--
-- Preconditions that MUST be checked outside SQL, against the real Better Auth
-- D1 account and the active staging browser session:
-- 1. The account exists in D1 and the browser can read
--    https://auth.sykabelajar.my.id/api/auth/get-session.
-- 2. The returned user.id is the UUID inserted below and user.emailVerified=true.
-- 3. The signed-in Google account is controlled by the project owner. Do not use
--    an unverified email, session cookie or copied access token in this script.
-- 4. The Worker currently uses the stable Better Auth issuer and the Supabase
--    staging Custom OIDC project. The current_user below must be postgres.
--
-- This procedure provisions the application identity through the reviewed
-- server-side wrapper, then grants the first admin business role exactly once.
-- Public Better Auth registration still cannot choose account_type=admin.
-- Replace the sentinel UUID below only after completing the external checks.

BEGIN;

DO $first_admin_bootstrap$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_full_name text := 'Staging First Admin';
  v_username text := 'staging-first-admin';
  v_admin_rows integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'STAGING_FIRST_ADMIN_REQUIRES_DATABASE_OWNER';
  END IF;

  IF v_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'REPLACE_WITH_VERIFIED_BETTER_AUTH_UUID';
  END IF;

  IF v_username !~ '^[a-z0-9][a-z0-9._-]{2,39}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'STAGING_FIRST_ADMIN_USERNAME_INVALID';
  END IF;

  -- Serialize concurrent attempts and refuse any repeat if an admin row already
  -- exists, active or inactive. A disabled admin is not silently reactivated.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sykabelajar-auth-staging-first-admin', 0)
  );

  SELECT pg_catalog.count(*)::integer
    INTO v_admin_rows
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role;

  IF v_admin_rows <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'STAGING_FIRST_ADMIN_ALREADY_BOOTSTRAPPED';
  END IF;

  -- A UUID tombstone or a legacy Supabase Auth identity must never be promoted
  -- by this Better Auth-only procedure.
  IF EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = v_user_id AND identity_origin <> 'better_auth'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'STAGING_FIRST_ADMIN_IDENTITY_NOT_BETTER_AUTH';
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'STAGING_FIRST_ADMIN_SHADOW_AUTH_USER_NOT_ALLOWED';
  END IF;

  -- This call creates private.app_users, profiles and user_settings if needed.
  -- p_email_verified=true is allowed here ONLY because the operator has just
  -- verified user.emailVerified=true from the live Better Auth session above.
  PERFORM public.better_auth_provision_user(
    v_user_id,
    'student',
    v_full_name,
    v_username,
    NULL,
    TRUE,
    NULL,
    NULL,
    NULL,
    NULL
  );

  IF NOT EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = v_user_id
      AND identity_origin = 'better_auth'
      AND email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'STAGING_FIRST_ADMIN_IDENTITY_PROJECTION_FAILED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_user_id
  ) THEN
    RAISE EXCEPTION 'STAGING_FIRST_ADMIN_PROFILE_NOT_PROVISIONED';
  END IF;

  INSERT INTO public.user_roles (user_id, role, is_active)
  VALUES (v_user_id, 'admin'::public.app_role, TRUE);

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_user_id
      AND role = 'admin'::public.app_role
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'STAGING_FIRST_ADMIN_ROLE_NOT_CONFIRMED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id <> v_user_id
      AND role = 'admin'::public.app_role
  ) THEN
    RAISE EXCEPTION 'UNEXPECTED_SECOND_STAGING_ADMIN_ROLE';
  END IF;
END;
$first_admin_bootstrap$;

COMMIT;

-- Post-run read-only confirmation:
-- SELECT au.id, au.identity_origin, au.email_verified_at,
--        p.account_type, p.username, ur.role, ur.is_active
-- FROM private.app_users au
-- JOIN public.profiles p ON p.id = au.id
-- JOIN public.user_roles ur ON ur.user_id = au.id
-- WHERE au.id = '<THE_VERIFIED_BETTER_AUTH_UUID>';
--
-- Expected: identity_origin=better_auth, email_verified_at IS NOT NULL,
-- account_type=student, role=admin and is_active=true (plus the initial student
-- role). Keep the D1 Better Auth account as credential/session authority.
