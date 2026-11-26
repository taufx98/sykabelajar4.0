-- Stage 7 owner-scoped checkout issuer hardening.
-- Applies only to the disposable PostgreSQL 17.6 schema restore in
-- auth-schema-baseline.yml. Never apply this draft to Production directly.
--
-- The two functions remain SECURITY DEFINER and retain their owner, EXECUTE
-- ACL, argument/return signature and search_path. The only behavior change is
-- an exact Better Auth issuer + private.app_users identity-origin check before
-- any owner/admin lookup or gateway/certificate configuration read.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TEMP TABLE stage7_owner_scoped_payment_rpc_before ON COMMIT DROP AS
SELECT
  p.oid,
  p.proowner,
  p.prosecdef,
  p.proconfig,
  p.proacl,
  p.prorettype,
  p.proargtypes::oid[] AS proargtypes,
  p.oid::regprocedure::text AS signature,
  md5(p.prosrc) AS source_md5
FROM pg_catalog.pg_proc p
WHERE p.oid IN (
  pg_catalog.to_regprocedure(
    'public.create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text)'
  ),
  pg_catalog.to_regprocedure(
    'public.create_organizer_plan_order(uuid,text,text,text,text,text,text,jsonb,uuid,text,text,integer,integer,text,text,text)'
  )
);

DO $stage7_owner_scoped_payment_rpc_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_search_path text[];
  v_source_md5 text;
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_role_execute boolean;
  v_count integer;
BEGIN
  IF (SELECT count(*) FROM stage7_owner_scoped_payment_rpc_before) <> 2 THEN
    RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_COUNT_MISMATCH';
  END IF;

  FOR v_expected IN
    SELECT *
    FROM (VALUES
      (
        'public.create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text)',
        'fa5e3bb6726bdf8d8b6768871c71ef97'
      ),
      (
        'public.create_organizer_plan_order(uuid,text,text,text,text,text,text,jsonb,uuid,text,text,integer,integer,text,text,text)',
        '7fae7e641d7bed2a24bacaf3724139e7'
      )
    ) AS expected(signature, source_md5)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_MISSING:%', v_expected.signature;
    END IF;

    SELECT
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      p.proconfig,
      md5(p.prosrc),
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ),
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
    INTO
      v_owner,
      v_security_definer,
      v_search_path,
      v_source_md5,
      v_public_execute,
      v_anon_execute,
      v_authenticated_execute,
      v_service_role_execute
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_source_md5 IS DISTINCT FROM v_expected.source_md5
       OR v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM TRUE
       OR v_search_path IS DISTINCT FROM ARRAY['search_path=public, private']::text[] THEN
      RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_FINGERPRINT_OR_METADATA_DRIFT:%', v_expected.signature;
    END IF;

    IF v_public_execute OR v_anon_execute
       OR NOT v_authenticated_execute OR NOT v_service_role_execute THEN
      RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_ACL_DRIFT:%', v_expected.signature;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count
  FROM stage7_owner_scoped_payment_rpc_before b
  WHERE (b.signature = 'create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text)'
         AND b.source_md5 = 'fa5e3bb6726bdf8d8b6768871c71ef97')
     OR (b.signature = 'create_organizer_plan_order(uuid,text,text,text,text,text,text,jsonb,uuid,text,text,integer,integer,text,text,text)'
         AND b.source_md5 = '7fae7e641d7bed2a24bacaf3724139e7');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_EXPECTED_SOURCE_FINGERPRINTS_MISSING';
  END IF;
END;
$stage7_owner_scoped_payment_rpc_preflight$;

DO $stage7_owner_scoped_payment_rpc_patch$
DECLARE
  v_oid oid;
  v_definition text;
  v_error text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(
    'public.create_collective_certificate_order_with_proof(uuid,text,text,text,integer,integer,text,text,text)'
  );
  v_definition := pg_catalog.pg_get_functiondef(v_oid);

  IF pg_catalog.position(
       'v_price numeric := public.get_collective_certificate_price();' IN v_definition
     ) = 0
     OR pg_catalog.position(
       E'begin\n  if v_uid is null then raise exception ''AUTH_REQUIRED''; end if;' IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_ORDER_PATCH_ANCHOR_DRIFT';
  END IF;

  -- Move the price lookup out of DECLARE so issuer validation happens first.
  v_definition := pg_catalog.replace(
    v_definition,
    'v_price numeric := public.get_collective_certificate_price();',
    'v_price numeric;'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    E'begin\n  if v_uid is null then raise exception ''AUTH_REQUIRED''; end if;',
    E'begin\n  IF NOT private.current_user_is_better_auth() THEN\n'
      || E'    RAISE EXCEPTION ''BETTER_AUTH_ISSUER_REQUIRED'';\n'
      || E'  END IF;\n\n'
      || E'  v_price := public.get_collective_certificate_price();\n'
      || E'  if v_uid is null then raise exception ''AUTH_REQUIRED''; end if;'
  );

  IF pg_catalog.position('private.current_user_is_better_auth()' IN v_definition) = 0
     OR pg_catalog.position(
          'private.current_user_is_better_auth()' IN v_definition
        ) > pg_catalog.position(
          'public.get_collective_certificate_price()' IN v_definition
        ) THEN
    RAISE EXCEPTION 'STAGE7_CERTIFICATE_ORDER_PATCH_POSTCONDITION_FAILED';
  END IF;

  EXECUTE v_definition;

  v_oid := pg_catalog.to_regprocedure(
    'public.create_organizer_plan_order(uuid,text,text,text,text,text,text,jsonb,uuid,text,text,integer,integer,text,text,text)'
  );
  v_definition := pg_catalog.pg_get_functiondef(v_oid);

  IF pg_catalog.position(
       E'begin\n if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;' IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'STAGE7_ORGANIZER_PLAN_PATCH_ANCHOR_DRIFT';
  END IF;

  v_definition := pg_catalog.replace(
    v_definition,
    E'begin\n if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;',
    E'begin\n IF NOT private.current_user_is_better_auth() THEN\n'
      || E'   RAISE EXCEPTION ''BETTER_AUTH_ISSUER_REQUIRED'';\n'
      || E' END IF;\n'
      || E' if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;'
  );

  IF pg_catalog.position('private.current_user_is_better_auth()' IN v_definition) = 0
     OR pg_catalog.position('private.current_user_is_better_auth()' IN v_definition)
        > pg_catalog.position('private.current_user_is_organizer_for(' IN v_definition) THEN
    RAISE EXCEPTION 'STAGE7_ORGANIZER_PLAN_PATCH_POSTCONDITION_FAILED';
  END IF;

  EXECUTE v_definition;
END;
$stage7_owner_scoped_payment_rpc_patch$;

DO $stage7_owner_scoped_payment_rpc_postflight$
DECLARE
  v_expected record;
  v_owner text;
  v_security_definer boolean;
  v_search_path text[];
  v_acl aclitem[];
  v_argtypes oid[];
  v_return_type oid;
  v_definition text;
  v_source text;
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_role_execute boolean;
BEGIN
  FOR v_expected IN SELECT * FROM stage7_owner_scoped_payment_rpc_before
  LOOP
    SELECT
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      p.proconfig,
      p.proacl,
      p.proargtypes::oid[],
      p.prorettype,
      p.prosrc,
      pg_catalog.pg_get_functiondef(p.oid),
      EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(
          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
        ) acl
        WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
      ),
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
    INTO
      v_owner,
      v_security_definer,
      v_search_path,
      v_acl,
      v_argtypes,
      v_return_type,
      v_source,
      v_definition,
      v_public_execute,
      v_anon_execute,
      v_authenticated_execute,
      v_service_role_execute
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_expected.oid;

    IF v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM TRUE
       OR v_search_path IS DISTINCT FROM ARRAY['search_path=public, private']::text[]
       OR v_acl IS DISTINCT FROM v_expected.proacl
       OR v_argtypes IS DISTINCT FROM v_expected.proargtypes
       OR v_return_type IS DISTINCT FROM v_expected.prorettype THEN
      RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_METADATA_OR_ACL_MUTATED:%', v_expected.signature;
    END IF;

    IF v_public_execute OR v_anon_execute
       OR NOT v_authenticated_execute OR NOT v_service_role_execute THEN
      RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_EXECUTE_BOUNDARY_MUTATED:%', v_expected.signature;
    END IF;

    IF pg_catalog.position('private.current_user_is_better_auth()' IN v_source) = 0 THEN
      RAISE EXCEPTION 'STAGE7_PAYMENT_RPC_ISSUER_GUARD_MISSING:%', v_expected.signature;
    END IF;

    IF v_expected.signature LIKE 'create_collective_certificate_order_with_proof(%'
       AND (
         pg_catalog.position('private.current_user_is_better_auth()' IN v_source)
         > pg_catalog.position('public.get_collective_certificate_price()' IN v_source)
         OR pg_catalog.position('v_price numeric := public.get_collective_certificate_price()' IN v_definition) > 0
       ) THEN
      RAISE EXCEPTION 'STAGE7_CERTIFICATE_PRICE_READ_PRECEDES_ISSUER_GUARD';
    END IF;

    IF v_expected.signature LIKE 'create_organizer_plan_order(%'
       AND pg_catalog.position('private.current_user_is_better_auth()' IN v_source)
         > pg_catalog.position('private.current_user_is_organizer_for(' IN v_source) THEN
      RAISE EXCEPTION 'STAGE7_ORGANIZER_MEMBERSHIP_READ_PRECEDES_ISSUER_GUARD';
    END IF;
  END LOOP;
END;
$stage7_owner_scoped_payment_rpc_postflight$;

COMMIT;
