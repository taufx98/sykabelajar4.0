\set ON_ERROR_STOP on
BEGIN;

-- Disposable PostgreSQL 17 integration fixture. It models the profile/RLS
-- boundary used by the migration without connecting to production.

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;

CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, auth, private TO anon, authenticated, service_role;

CREATE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$function$;

CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid;
$function$;

CREATE TYPE public.app_role AS ENUM ('student', 'teacher', 'organizer_member', 'admin');

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE FUNCTION private.current_user_has_role(p_role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = (SELECT auth.uid())
      AND ur.role = p_role
      AND ur.is_active = true
  );
$function$;

CREATE FUNCTION private.current_user_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private'
AS $function$
  SELECT private.current_user_has_role('admin'::public.app_role);
$function$;

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  verification_type text NOT NULL,
  school_id uuid,
  created_at timestamptz NOT NULL,
  last_name_change timestamptz,
  full_name text NOT NULL,
  bio text,
  is_public boolean NOT NULL DEFAULT false
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_public_read
ON public.profiles
FOR SELECT
TO anon, authenticated
USING (is_public OR (SELECT auth.uid()) = id);

CREATE POLICY profiles_self_update
ON public.profiles
FOR UPDATE
TO authenticated
USING ((SELECT auth.uid()) = id)
WITH CHECK ((SELECT auth.uid()) = id);

-- Model the existing admin RPC pattern: SECURITY DEFINER plus a database
-- authorization check, updating a different user's profile row.
CREATE FUNCTION public.profile_test_admin_update(
  p_user_id uuid,
  p_status text,
  p_verification_type text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT coalesce(private.current_user_is_admin(), false) THEN
    RAISE EXCEPTION 'ACCESS_DENIED' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET status = p_status,
      verification_type = p_verification_type
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.profile_test_admin_update(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_test_admin_update(uuid, text, text) TO authenticated;

-- Start broad: the migration must remove excessive client grants.
GRANT ALL ON TABLE public.profiles TO anon, authenticated, service_role;

INSERT INTO public.profiles
  (id, status, verification_type, school_id, created_at, last_name_change, full_name, bio, is_public)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'ACTIVE', 'NONE',
   '10000000-0000-0000-0000-000000000001', clock_timestamp() - interval '1 day',
   clock_timestamp() - interval '2 days', 'Student A', 'Original A', false),
  ('00000000-0000-0000-0000-000000000002', 'ACTIVE', 'NONE',
   '10000000-0000-0000-0000-000000000002', clock_timestamp() - interval '1 day',
   null, 'Student B', 'Private B', false),
  ('00000000-0000-0000-0000-000000000003', 'ACTIVE', 'NONE',
   null, clock_timestamp() - interval '1 day', null, 'Admin A', 'Admin', false),
  ('00000000-0000-0000-0000-000000000004', 'ACTIVE', 'NONE',
   null, clock_timestamp() - interval '1 day', null, 'Public Profile', 'Public', true);

INSERT INTO public.user_roles (user_id, role, is_active)
VALUES ('00000000-0000-0000-0000-000000000003', 'admin', true);

\ir ../supabase/migrations/20261104040000_profile_managed_fields_guard.sql

DO $test$
BEGIN
  IF NOT has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR has_table_privilege('anon', 'public.profiles', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.profiles', 'REFERENCES')
     OR has_table_privilege('anon', 'public.profiles', 'TRIGGER') THEN
    RAISE EXCEPTION 'TEST_FAILED: anon must be read-only on profiles';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.profiles', 'TRIGGER') THEN
    RAISE EXCEPTION 'TEST_FAILED: authenticated must retain only SELECT and UPDATE';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.profiles', 'UPDATE')
     OR NOT has_table_privilege('service_role', 'public.profiles', 'INSERT') THEN
    RAISE EXCEPTION 'TEST_FAILED: service_role privileges must remain intact';
  END IF;
END;
$test$;

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
DO $test$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST_FAILED: anonymous users should see only the one public profile';
  END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
DO $test$
DECLARE
  v_count integer;
  v_rows integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST_FAILED: User A should see their own profile and the public profile';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.profiles
  WHERE id = '00000000-0000-0000-0000-000000000002';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: User A must not read User B profile';
  END IF;

  UPDATE public.profiles SET bio = 'Allowed self edit' WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_FAILED: ordinary self profile update should work';
  END IF;

  UPDATE public.profiles
  SET bio = 'Attempted cross-user edit'
  WHERE id = '00000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED: User A must not update User B profile';
  END IF;
END;
$test$;

DO $test$
BEGIN
  BEGIN
    UPDATE public.profiles SET status = 'SUSPENDED' WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: status update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_FIELD_MANAGED_BY_BACKEND' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.profiles SET verification_type = 'VERIFIED' WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: verification_type update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_FIELD_MANAGED_BY_BACKEND' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.profiles
    SET school_id = '10000000-0000-0000-0000-000000000099'
    WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: school_id update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_FIELD_MANAGED_BY_BACKEND' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.profiles SET created_at = clock_timestamp() WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: created_at update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_FIELD_MANAGED_BY_BACKEND' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.profiles
    SET id = '00000000-0000-0000-0000-000000000002'
    WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: id update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_FIELD_MANAGED_BY_BACKEND' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.profiles
    SET last_name_change = clock_timestamp() - interval '100 days'
    WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: independent cooldown timestamp update unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'PROFILE_NAME_CHANGE_TIMESTAMP_MANAGED_BY_BACKEND' THEN RAISE; END IF;
  END;

  BEGIN
    UPDATE public.profiles
    SET full_name = 'Too Soon',
        last_name_change = clock_timestamp() - interval '100 days'
    WHERE id = auth.uid();
    RAISE EXCEPTION 'TEST_FAILED: display name cooldown was bypassed';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'PROFILE_NAME_CHANGE_COOLDOWN' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.profile_test_admin_update(
      '00000000-0000-0000-0000-000000000002',
      'ADMIN_FORGED',
      'ADMIN_VERIFIED'
    );
    RAISE EXCEPTION 'TEST_FAILED: non-admin caller executed admin profile RPC';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'ACCESS_DENIED' THEN RAISE; END IF;
  END;
END;
$test$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);

UPDATE public.profiles
SET last_name_change = clock_timestamp() - interval '8 days'
WHERE id = '00000000-0000-0000-0000-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
DO $test$
DECLARE v_last_name_change timestamptz;
BEGIN
  UPDATE public.profiles
  SET full_name = 'Allowed Rename',
      last_name_change = '2000-01-01 00:00:00+00'
  WHERE id = auth.uid();

  SELECT last_name_change INTO v_last_name_change
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_last_name_change < statement_timestamp() - interval '1 minute' THEN
    RAISE EXCEPTION 'TEST_FAILED: database did not replace the client timestamp';
  END IF;
END;
$test$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
DO $test$
BEGIN
  UPDATE public.profiles
  SET status = 'SUSPENDED',
      verification_type = 'ADMIN_VERIFIED',
      school_id = '10000000-0000-0000-0000-000000000003'
  WHERE id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_FAILED: authorized admin profile update should work';
  END IF;
END;
$test$;
RESET ROLE;

-- The same style of SECURITY DEFINER RPC can update another user's row when
-- the caller's admin role is verified from the JWT-backed user_roles source.
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);
SELECT public.profile_test_admin_update(
  '00000000-0000-0000-0000-000000000001',
  'ADMIN_RPC_STATUS',
  'ADMIN_VERIFIED'
);
RESET ROLE;
SELECT set_config('request.jwt.claims', '{}', true);
DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '00000000-0000-0000-0000-000000000001'
      AND status = 'ADMIN_RPC_STATUS'
      AND verification_type = 'ADMIN_VERIFIED'
  ) THEN
    RAISE EXCEPTION 'TEST_FAILED: authorized admin RPC could not update another profile';
  END IF;
END;
$test$;

SET LOCAL ROLE service_role;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"service_role"}',
  true
);
UPDATE public.profiles
SET status = 'SERVICE_UPDATED'
WHERE id = '00000000-0000-0000-0000-000000000001';
RESET ROLE;

ROLLBACK;
