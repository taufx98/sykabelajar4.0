-- Harden only the isolated Better Auth staging fixture.
-- create_organizer is intentionally callable by authenticated users: it is the
-- application workspace-onboarding RPC and enforces caller UUID, active
-- organizer_member role, verified email, verified phone, and one free claim.
-- Anonymous execution stays revoked. Keep SECURITY DEFINER because the
-- operation writes protected organizer tables; pin the function search_path
-- to empty because every application object is schema-qualified.
-- This migration is staging/test-only and must not be applied to production.

DO $guard$
BEGIN
  IF pg_catalog.to_regprocedure('public.create_organizer(text,text)') IS NULL THEN
    RAISE EXCEPTION 'STAGE3_CREATE_ORGANIZER_FUNCTION_MISSING';
  END IF;
  IF pg_catalog.has_function_privilege('anon', 'public.create_organizer(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_CREATE_ORGANIZER_ANON_GRANT_UNEXPECTED';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.create_organizer(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE3_CREATE_ORGANIZER_AUTHENTICATED_GRANT_MISSING';
  END IF;
END;
$guard$;

ALTER FUNCTION public.create_organizer(text,text) SET search_path = '';
