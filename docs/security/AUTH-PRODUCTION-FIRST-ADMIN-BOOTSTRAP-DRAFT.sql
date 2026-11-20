-- MANUAL, OWNER-OPERATED PRODUCTION FIRST ADMIN GRANT.
-- DRAFT ONLY: do not run until the Production Stage 3 identity/FK/issuer
-- migration, Production email delivery, and genuine Better Auth verification
-- have all passed. This is not a migration and creates no public endpoint.
--
-- Exact target: Supabase Production DB2 project mvdczyitbkxkldjughor.
-- This procedure NEVER creates an identity, changes email verification,
-- writes auth.users, alters existing role rows, or copies a legacy account.
--
-- Required external checks immediately before execution:
-- 1. Sign in to https://auth-prod.sykabelajar.my.id using the owner-controlled
--    Better Auth account.
-- 2. In that same browser session open
--    https://auth-prod.sykabelajar.my.id/api/auth/get-session.
-- 3. Confirm user.id is the UUID below and user.emailVerified is exactly true.
--    Do not use a copied token, cookie, client-supplied claim or email address.
-- 4. Verify the Production SendPulse test/OTP was received and completed.
-- 5. Verify the SQL Editor is connected to project mvdczyitbkxkldjughor and
--    executes as postgres. Never run this file in staging or another project.
--
-- Legacy compatibility:
-- DB2 currently has an existing legacy admin role attached to auth.users.
-- It remains untouched. This bootstrap counts only admin roles linked to
-- identity_origin='better_auth'; a legacy admin row cannot block or receive
-- this grant. Existing users, profiles, role rows, sessions and FKs are kept.

BEGIN;

DO $production_first_admin$
DECLARE
  v_user_id uuid := '00000000-0000-0000-0000-000000000000';
  v_identity_origin text;
  v_email_verified_at timestamptz;
  v_profile_count integer;
  v_existing_user_admin_rows integer;
  v_better_auth_admin_rows integer;
  v_fk_to_app_users integer;
  v_fk_to_auth_users integer;
  v_issuer_guard_rows integer;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PRODUCTION_FIRST_ADMIN_REQUIRES_DATABASE_OWNER';
  END IF;

  IF v_user_id = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'REPLACE_WITH_OWNER_VERIFIED_PRODUCTION_BETTER_AUTH_UUID';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sykabelajar-auth-production-first-admin', 0)
  );

  IF to_regclass('private.app_users') IS NULL THEN
    RAISE EXCEPTION 'PRODUCTION_STAGE3_IDENTITY_ROOT_NOT_APPLIED';
  END IF;

  IF to_regprocedure('public.better_auth_provision_user(uuid,text,text,text,text,boolean,date,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PRODUCTION_STAGE3_PROVISIONING_RPC_NOT_INSTALLED';
  END IF;

  SELECT count(*)::integer INTO v_fk_to_app_users
  FROM pg_constraint c
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
  WHERE c.contype = 'f'
    AND src_ns.nspname IN ('public', 'private')
    AND dst_ns.nspname = 'private'
    AND dst.relname = 'app_users';

  SELECT count(*)::integer INTO v_fk_to_auth_users
  FROM pg_constraint c
  JOIN pg_class src ON src.oid = c.conrelid
  JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN pg_namespace dst_ns ON dst_ns.oid = dst.relnamespace
  WHERE c.contype = 'f'
    AND src_ns.nspname IN ('public', 'private')
    AND dst_ns.nspname = 'auth'
    AND dst.relname = 'users';

  IF v_fk_to_app_users <> 69 OR v_fk_to_auth_users <> 0 THEN
    RAISE EXCEPTION 'PRODUCTION_STAGE3_FK_STATE_MISMATCH: app_users=%, auth_users=%',
      v_fk_to_app_users, v_fk_to_auth_users;
  END IF;

  SELECT count(*)::integer INTO v_issuer_guard_rows
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard'
    AND NOT pol.polpermissive
    AND pol.polcmd = '*'
    AND pol.polroles = ARRAY['authenticated'::regrole::oid]
    AND COALESCE(pg_catalog.pg_get_expr(pol.polqual, pol.polrelid), '') LIKE
      '%https://auth-prod.sykabelajar.my.id/api/auth%'
    AND COALESCE(pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid), '') LIKE
      '%https://auth-prod.sykabelajar.my.id/api/auth%';

  IF v_issuer_guard_rows <> 61 THEN
    RAISE EXCEPTION 'PRODUCTION_STAGE3_ISSUER_GUARDS_MISMATCH: expected 61, found %',
      v_issuer_guard_rows;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PRODUCTION_FIRST_ADMIN_SHADOW_AUTH_USER_NOT_ALLOWED';
  END IF;

  SELECT identity_origin, email_verified_at
    INTO v_identity_origin, v_email_verified_at
  FROM private.app_users
  WHERE id = v_user_id
  FOR UPDATE;

  IF NOT FOUND OR v_identity_origin <> 'better_auth' THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PRODUCTION_FIRST_ADMIN_IDENTITY_NOT_BETTER_AUTH';
  END IF;

  -- The trusted Worker must already have projected a genuine Better Auth
  -- verification event. This script never sets or fabricates that timestamp.
  IF v_email_verified_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'PRODUCTION_FIRST_ADMIN_EMAIL_NOT_VERIFIED';
  END IF;

  SELECT count(*)::integer INTO v_profile_count
  FROM public.profiles
  WHERE id = v_user_id;

  IF v_profile_count <> 1 THEN
    RAISE EXCEPTION 'PRODUCTION_FIRST_ADMIN_PROFILE_NOT_FOUND';
  END IF;

  SELECT count(*)::integer INTO v_existing_user_admin_rows
  FROM public.user_roles
  WHERE user_id = v_user_id
    AND role = 'admin'::public.app_role;

  IF v_existing_user_admin_rows <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PRODUCTION_FIRST_ADMIN_USER_ALREADY_HAS_ADMIN_ROW';
  END IF;

  -- Existing legacy admins are deliberately excluded and preserved.
  SELECT count(*)::integer INTO v_better_auth_admin_rows
  FROM public.user_roles ur
  JOIN private.app_users au ON au.id = ur.user_id
  WHERE ur.role = 'admin'::public.app_role
    AND au.identity_origin = 'better_auth';

  IF v_better_auth_admin_rows <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '55000',
      MESSAGE = 'PRODUCTION_FIRST_BETTER_AUTH_ADMIN_ALREADY_BOOTSTRAPPED';
  END IF;

  INSERT INTO public.user_roles (user_id, role, is_active)
  VALUES (v_user_id, 'admin'::public.app_role, TRUE);

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN private.app_users au ON au.id = ur.user_id
    WHERE ur.user_id = v_user_id
      AND ur.role = 'admin'::public.app_role
      AND ur.is_active = TRUE
      AND au.identity_origin = 'better_auth'
      AND au.email_verified_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PRODUCTION_FIRST_ADMIN_ROLE_NOT_CONFIRMED';
  END IF;

  SELECT count(*)::integer INTO v_better_auth_admin_rows
  FROM public.user_roles ur
  JOIN private.app_users au ON au.id = ur.user_id
  WHERE ur.role = 'admin'::public.app_role
    AND au.identity_origin = 'better_auth';

  IF v_better_auth_admin_rows <> 1 THEN
    RAISE EXCEPTION 'PRODUCTION_FIRST_BETTER_AUTH_ADMIN_COUNT_MISMATCH';
  END IF;
END;
$production_first_admin$;

COMMIT;

-- Post-run, read-only confirmation for the exact owner-selected UUID:
-- SELECT au.id, au.identity_origin, au.email_verified_at,
--        p.account_type, p.username, ur.role, ur.is_active
-- FROM private.app_users au
-- JOIN public.profiles p ON p.id = au.id
-- JOIN public.user_roles ur ON ur.user_id = au.id
-- WHERE au.id = '<THE_OWNER_VERIFIED_PRODUCTION_BETTER_AUTH_UUID>';
--
-- Expected: identity_origin=better_auth, email_verified_at IS NOT NULL,
-- one active admin row for this Better Auth identity. Existing legacy admin
-- rows and all historical Auth/application data remain unchanged.
