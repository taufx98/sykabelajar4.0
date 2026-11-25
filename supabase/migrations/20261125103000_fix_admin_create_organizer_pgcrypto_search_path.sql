-- Repair pgcrypto function resolution for the Admin organizer-create RPC.
-- Production pgcrypto lives in the trusted extensions schema, but this SECURITY
-- DEFINER function previously excluded extensions from its function search_path.
-- This forward migration is fail-closed and preserves the function body, owner,
-- SECURITY DEFINER mode, and EXECUTE ACLs.

BEGIN;

DO $stage7_admin_create_organizer_search_path_preflight$
DECLARE
  v_oid oid;
  v_definition_md5 text;
  v_owner oid;
  v_security_definer boolean;
  v_settings text[];
  v_acl text;
BEGIN
  v_oid := to_regprocedure('public.admin_create_organizer(uuid,text,text)');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE7_ADMIN_CREATE_ORGANIZER_FUNCTION_MISSING';
  END IF;

  SELECT
    md5(pg_get_functiondef(p.oid)),
    p.proowner,
    p.prosecdef,
    p.proconfig,
    p.proacl::text
  INTO
    v_definition_md5,
    v_owner,
    v_security_definer,
    v_settings,
    v_acl
  FROM pg_proc p
  WHERE p.oid = v_oid;

  IF v_definition_md5 IS DISTINCT FROM 'bd5b5646fdf2bee263f18323480fa7c4'
     OR v_owner IS DISTINCT FROM 'postgres'::regrole::oid
     OR v_security_definer IS DISTINCT FROM TRUE
     OR v_settings IS DISTINCT FROM ARRAY['search_path=public, private']::text[]
     OR v_acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'STAGE7_ADMIN_CREATE_ORGANIZER_FUNCTION_FINGERPRINT_OR_METADATA_DRIFT';
  END IF;

  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL
     OR to_regprocedure('extensions.crypt(text,text)') IS NULL
     OR to_regprocedure('extensions.gen_salt(text)') IS NULL THEN
    RAISE EXCEPTION 'STAGE7_ADMIN_CREATE_ORGANIZER_PGCRYPTO_FUNCTION_MISSING';
  END IF;

  IF has_schema_privilege('anon', 'extensions', 'CREATE')
     OR has_schema_privilege('authenticated', 'extensions', 'CREATE')
     OR has_schema_privilege('service_role', 'extensions', 'CREATE') THEN
    RAISE EXCEPTION 'STAGE7_EXTENSIONS_SCHEMA_CREATE_PRIVILEGE_DRIFT';
  END IF;

  IF NOT has_function_privilege('postgres', 'extensions.gen_random_bytes(integer)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'extensions.crypt(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('postgres', 'extensions.gen_salt(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_ADMIN_CREATE_ORGANIZER_PGCRYPTO_EXECUTE_MISSING';
  END IF;
END;
$stage7_admin_create_organizer_search_path_preflight$;

-- Keep the original function body and ACLs unchanged. Adding the trusted
-- extensions schema resolves gen_random_bytes(), crypt(), and gen_salt().
ALTER FUNCTION public.admin_create_organizer(uuid,text,text)
  SET search_path = public, private, extensions;

DO $stage7_admin_create_organizer_search_path_verify$
DECLARE
  v_owner oid;
  v_security_definer boolean;
  v_settings text[];
  v_acl text;
BEGIN
  SELECT p.proowner, p.prosecdef, p.proconfig, p.proacl::text
    INTO v_owner, v_security_definer, v_settings, v_acl
  FROM pg_proc p
  WHERE p.oid = to_regprocedure('public.admin_create_organizer(uuid,text,text)');

  IF v_owner IS DISTINCT FROM 'postgres'::regrole::oid
     OR v_security_definer IS DISTINCT FROM TRUE
     OR v_settings IS DISTINCT FROM ARRAY['search_path=public, private, extensions']::text[]
     OR v_acl IS DISTINCT FROM '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}' THEN
    RAISE EXCEPTION 'STAGE7_ADMIN_CREATE_ORGANIZER_SEARCH_PATH_OR_ACL_VERIFY_FAILED';
  END IF;
END;
$stage7_admin_create_organizer_search_path_verify$;

COMMIT;
