BEGIN;

-- The application verifies certificates through the narrowly projected,
-- security-invoker view public.certificate_verifications_public. The old
-- get_certificate_verification RPC has no in-repository callers and still
-- inherits PUBLIC EXECUTE despite the earlier role-specific revocation.
-- Fail closed if the live definition or grant baseline has drifted.
DO $preflight$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.get_certificate_verification(text)'
  );
  v_owner text;
  v_is_definer boolean;
  v_source_md5 text;
  v_config text;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_RPC_MISSING';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    md5(p.prosrc),
    coalesce(array_to_string(p.proconfig, '; '), '')
  INTO v_owner, v_is_definer, v_source_md5, v_config
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_function;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_is_definer IS DISTINCT FROM TRUE
     OR v_source_md5 IS DISTINCT FROM '84c0d4d474efa4077b1cdebd7f8503fb'
     OR v_config IS DISTINCT FROM 'search_path=public, private' THEN
    RAISE EXCEPTION
      'STAGE7_CERTIFICATE_VERIFICATION_RPC_FINGERPRINT_DRIFT: owner=%, definer=%, source_md5=%, config=%',
      v_owner, v_is_definer, v_source_md5, v_config;
  END IF;

  IF NOT pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_RPC_GRANT_BASELINE_DRIFT';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'anon', 'public.certificate_verifications_public', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.certificate_verifications_public', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_GRANT_MISSING';
  END IF;
END;
$preflight$;

-- Remove both the inherited PUBLIC grant and the redundant direct browser-role
-- grants. Preserve the explicit service_role and owner privileges.
REVOKE EXECUTE ON FUNCTION public.get_certificate_verification(text)
  FROM PUBLIC, anon, authenticated;

DO $postflight$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.get_certificate_verification(text)'
  );
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_BROWSER_EXECUTE_REMAINS';
  END IF;

  IF NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_SERVICE_ROLE_GRANT_CHANGED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p,
         LATERAL pg_catalog.aclexplode(
           coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
         ) AS acl
    WHERE p.oid = v_function
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_PUBLIC_EXECUTE_REMAINS';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'anon', 'public.certificate_verifications_public', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.certificate_verifications_public', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_GRANT_CHANGED';
  END IF;
END;
$postflight$;

COMMIT;
