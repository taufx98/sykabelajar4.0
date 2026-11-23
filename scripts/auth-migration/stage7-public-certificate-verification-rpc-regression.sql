\set ON_ERROR_STOP on

BEGIN;

DO $certificate_rpc_acl$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure(
    'public.get_certificate_verification(text)'
  );
  v_view oid := pg_catalog.to_regclass('public.certificate_verifications_public');
  v_columns text[];
  v_policy text;
BEGIN
  IF v_function IS NULL OR v_view IS NULL THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_OBJECT_MISSING';
  END IF;

  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_BROWSER_EXECUTE_REMAINS';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_VERIFICATION_SERVICE_ROLE_EXECUTE_MISSING';
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

  SELECT array_agg(a.attname::text ORDER BY a.attnum)
    INTO v_columns
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = v_view
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_columns IS DISTINCT FROM ARRAY[
    'certificate_id',
    'verification_code',
    'status',
    'public_name',
    'competition_title',
    'achievement_title',
    'issued_at',
    'revoked_at'
  ]::text[] THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_COLUMNS_DRIFT:%', v_columns;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = v_view
      AND c.relkind = 'v'
      AND coalesce(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=true']::text[]
  ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_NOT_SECURITY_INVOKER';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = pg_catalog.to_regclass('public.certificate_verifications')
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_BASE_TABLE_RLS_DISABLED';
  END IF;

  SELECT p.qual
    INTO v_policy
  FROM pg_catalog.pg_policies AS p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'certificate_verifications'
    AND p.policyname = 'certificate_verifications_public_select'
    AND p.cmd = 'SELECT'
    AND p.roles @> ARRAY['anon', 'authenticated']::name[];

  IF v_policy IS NULL
     OR position('PUBLISHED' IN v_policy) = 0
     OR position('REVOKED' IN v_policy) = 0 THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_STATUS_POLICY_DRIFT:%', v_policy;
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'anon', 'public.certificate_verifications_public', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.certificate_verifications_public', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_CLIENT_GRANT_MISSING';
  END IF;
END;
$certificate_rpc_acl$;

-- Anonymous verification remains available through the intended public
-- projection. The fabricated code has no matching row in the empty restore.
SET LOCAL ROLE anon;
DO $certificate_view_anon$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.certificate_verifications_public
  WHERE verification_code = 'STAGE7-NONEXISTENT-CERTIFICATE-CODE';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_RETURNED_UNSEEDED_ROW';
  END IF;

  BEGIN
    PERFORM public.get_certificate_verification(
      'STAGE7-NONEXISTENT-CERTIFICATE-CODE'
    );
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_LEGACY_RPC_EXECUTED_AS_ANON';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$certificate_view_anon$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $certificate_view_authenticated$
DECLARE
  v_count bigint;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.certificate_verifications_public
  WHERE verification_code = 'STAGE7-NONEXISTENT-CERTIFICATE-CODE';

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_PUBLIC_VIEW_RETURNED_UNSEEDED_ROW';
  END IF;

  BEGIN
    PERFORM public.get_certificate_verification(
      'STAGE7-NONEXISTENT-CERTIFICATE-CODE'
    );
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_LEGACY_RPC_EXECUTED_AS_AUTHENTICATED';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$certificate_view_authenticated$;

RESET ROLE;
ROLLBACK;
