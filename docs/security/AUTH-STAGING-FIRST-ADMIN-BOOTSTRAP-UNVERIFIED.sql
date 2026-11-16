-- ONE-TIME OWNER-OPERATED FIRST ADMIN BOOTSTRAP FOR TEMPORARY STAGING BYPASS.
-- STAGING ONLY. Never apply to Production.
--
-- Preconditions:
-- 1. The isolated Better Auth staging Worker is deployed.
-- 2. The owner explicitly enabled the temporary staging-only email bypass.
-- 3. Sign in at https://staging.sykabelajar.my.id using the account that the owner
--    intends to designate as the first staging administrator.
-- 4. In that same signed-in browser, open
--    https://auth.sykabelajar.my.id/api/auth/get-session and copy only user.id.
--    Confirm the email is the intended owner account and emailVerified=false.
-- 5. Replace the sentinel UUID below with that exact user.id.
-- 6. Run this script in Supabase SQL Editor for project ydamszdfsxqisanazdkb
--    as database owner (postgres). Never use the Production project.
--
-- Security properties:
-- - This is not an API and public signup cannot request the admin role.
-- - Requires an already-provisioned Better Auth identity/profile/settings row.
-- - Requires identity_origin=better_auth and rejects any auth.users shadow row.
-- - Requires email_verified_at IS NULL, so it does not forge email verification.
-- - Requires zero existing admin rows and serializes concurrent attempts.
-- - Creates exactly one active admin business role for the selected Better Auth UUID.
-- - The account remains email-unverified. The temporary Worker policy is what
--   permits its staging session; re-enabling the policy blocks it again until verified.

BEGIN;

DO $staging_first_admin_unverified$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_admin_rows integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'STAGING_FIRST_ADMIN_REQUIRES_DATABASE_OWNER';
  END IF;

  IF v_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'REPLACE_WITH_OWNER_CONFIRMED_BETTER_AUTH_UUID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sykabelajar-auth-staging-first-admin-unverified', 0)
  );

  SELECT pg_catalog.count(*)::integer
    INTO v_admin_rows
  FROM public.user_roles
  WHERE role = 'admin'::public.app_role;

  IF v_admin_rows <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'STAGING_FIRST_ADMIN_ALREADY_BOOTSTRAPPED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'STAGING_FIRST_ADMIN_SHADOW_AUTH_USER_NOT_ALLOWED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = v_user_id AND identity_origin = 'better_auth'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'STAGING_FIRST_ADMIN_REQUIRES_EXISTING_BETTER_AUTH_IDENTITY';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_id) THEN
    RAISE EXCEPTION 'STAGING_FIRST_ADMIN_PROFILE_NOT_PROVISIONED';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_settings WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'STAGING_FIRST_ADMIN_SETTINGS_NOT_PROVISIONED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = v_user_id AND email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'UNVERIFIED_BOOTSTRAP_SCRIPT_REQUIRES_UNVERIFIED_ACCOUNT';
  END IF;

  -- Retrying the trusted projection is idempotent and deliberately passes FALSE.
  -- It must not mark the address verified or replace the existing profile/role.
  PERFORM public.better_auth_provision_user(
    v_user_id,
    'student',
    (SELECT full_name FROM public.profiles WHERE id = v_user_id),
    (SELECT username FROM public.profiles WHERE id = v_user_id),
    NULL,
    FALSE,
    NULL,
    NULL,
    NULL,
    NULL
  );

  IF EXISTS (
    SELECT 1 FROM private.app_users
    WHERE id = v_user_id AND email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'STAGING_FIRST_ADMIN_BOOTSTRAP_MUST_NOT_VERIFY_EMAIL';
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
    WHERE role = 'admin'::public.app_role
      AND user_id <> v_user_id
  ) THEN
    RAISE EXCEPTION 'UNEXPECTED_SECOND_STAGING_ADMIN_ROLE';
  END IF;
END;
$staging_first_admin_unverified$;

COMMIT;

-- Read-only confirmation:
-- SELECT au.id, au.identity_origin, au.email_verified_at,
--        p.account_type, p.username, ur.role, ur.is_active
-- FROM private.app_users au
-- JOIN public.profiles p ON p.id = au.id
-- JOIN public.user_roles ur ON ur.user_id = au.id
-- WHERE au.id = '<OWNER_CONFIRMED_BETTER_AUTH_UUID>';
--
-- Expected: identity_origin=better_auth, email_verified_at IS NULL,
-- existing profile preserved, role=admin, is_active=true.
