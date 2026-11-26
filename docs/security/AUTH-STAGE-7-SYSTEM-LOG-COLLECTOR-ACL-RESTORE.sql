-- Stage 7 system-log collector function ACL restoration.
-- Read-only Production catalog review confirmed:
--   public.fetch_and_save_supabase_logs()
--   owner=postgres, SECURITY DEFINER, search_path=public, extensions, pg_catalog
--   EXECUTE is granted only to postgres and service_role.
-- Apply this draft only to the disposable schema-only restore, never Production.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $stage7_system_log_acl_preflight$
DECLARE
  v_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_search_path text;
  v_source_md5 text;
  v_return_type oid;
  v_argument_types oid[];
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.fetch_and_save_supabase_logs()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_FUNCTION_MISSING';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    coalesce(array_to_string(p.proconfig, ', '), ''),
    md5(p.prosrc),
    p.prorettype,
    p.proargtypes::oid[]
  INTO
    v_owner,
    v_security_definer,
    v_search_path,
    v_source_md5,
    v_return_type,
    v_argument_types
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_security_definer IS DISTINCT FROM TRUE
     OR v_search_path IS DISTINCT FROM 'search_path=public, extensions, pg_catalog'
     OR v_source_md5 IS DISTINCT FROM '5d0e79655d70a9019040ab9f4d529c88'
     OR v_return_type IS DISTINCT FROM 'void'::regtype
     OR v_argument_types IS NULL OR pg_catalog.cardinality(v_argument_types) <> 0 THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_SOURCE_OR_METADATA_DRIFT';
  END IF;
END;
$stage7_system_log_acl_preflight$;

REVOKE ALL PRIVILEGES ON FUNCTION public.fetch_and_save_supabase_logs()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fetch_and_save_supabase_logs()
  TO service_role;

DO $stage7_system_log_acl_postflight$
DECLARE
  v_oid oid;
  v_acl_count integer;
BEGIN
  v_oid := pg_catalog.to_regprocedure('public.fetch_and_save_supabase_logs()');

  SELECT
    (SELECT count(*) FROM pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ))
  INTO v_acl_count
  FROM pg_catalog.pg_proc p
  WHERE p.oid = v_oid;

  IF v_acl_count <> 2
     OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('postgres',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_ACL_RESTORE_FAILED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
    ) acl
    LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
    LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl.grantor
    WHERE p.oid=v_oid
      AND (
        grantee.rolname NOT IN ('postgres','service_role')
        OR grantor.rolname IS DISTINCT FROM 'postgres'
        OR acl.privilege_type IS DISTINCT FROM 'EXECUTE'
        OR acl.is_grantable
      )
  ) THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_ACL_GRANTEE_DRIFT';
  END IF;
END;
$stage7_system_log_acl_postflight$;

COMMIT;
