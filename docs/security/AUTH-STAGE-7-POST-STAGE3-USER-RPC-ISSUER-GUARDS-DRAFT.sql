-- Stage 7 post-Stage-3 user-bound RPC issuer hardening.
-- Exact Production source fingerprints are read from the live catalog by CI.
-- This file is only mounted into the isolated PostgreSQL 17.6 schema restore.
-- Never execute this draft against a Production database.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

CREATE TEMP TABLE stage7_post_stage3_user_rpc_before ON COMMIT DROP AS
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
  pg_catalog.to_regprocedure('create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)'),
  pg_catalog.to_regprocedure('create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)'),
  pg_catalog.to_regprocedure('create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])'),
  pg_catalog.to_regprocedure('create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])'),
  pg_catalog.to_regprocedure('create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])'),
  pg_catalog.to_regprocedure('list_my_shop_vouchers()'),
  pg_catalog.to_regprocedure('list_shop_checkout_vouchers(uuid,integer,numeric,numeric)'),
  pg_catalog.to_regprocedure('mark_my_shop_vouchers_seen()')
);

CREATE TEMP TABLE stage7_voucher_trigger_before ON COMMIT DROP AS
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
WHERE p.oid = pg_catalog.to_regprocedure('private.sync_shop_voucher_order_status()');

DO $stage7_post_stage3_user_rpc_preflight$
DECLARE
  v_expected record;
  v_oid oid;
  v_owner text;
  v_security_definer boolean;
  v_search_path text;
  v_source_md5 text;
BEGIN
  IF (SELECT count(*) FROM stage7_post_stage3_user_rpc_before) <> 8 THEN
    RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_COUNT_MISMATCH';
  END IF;

  FOR v_expected IN
    SELECT * FROM (VALUES
      ('create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)', '8efe8ac377bf4eb71698eee52c61d03c', 'search_path=public, private, pg_catalog'),
      ('create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)', '55e3959c23dfc492155807f230ed16e4', 'search_path=""'),
      ('create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])', 'ed717139d1d9ec7053e25064b928bdf8', 'search_path=""'),
      ('create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])', '01148b79df5aaa2556c80cbb63a71c68', 'search_path=""'),
      ('create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])', 'b3ff32e6f6ba86b371221a987ec9015a', 'search_path=""'),
      ('list_my_shop_vouchers()', '99e46c89ba9adf33447f2ba4bfc75cd5', 'search_path=""'),
      ('list_shop_checkout_vouchers(uuid,integer,numeric,numeric)', '2486c9c78abd60ada2c21fecec57fa81', 'search_path=""'),
      ('mark_my_shop_vouchers_seen()', '0761d56bbfee9ad3932ed5ba06e90dba', 'search_path=""')
    ) AS expected(signature, source_md5, search_path_config)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_MISSING:%', v_expected.signature;
    END IF;

    SELECT
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      coalesce(array_to_string(p.proconfig, ', '), ''),
      md5(p.prosrc)
    INTO v_owner, v_security_definer, v_search_path, v_source_md5
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_source_md5 IS DISTINCT FROM v_expected.source_md5
       OR v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM TRUE
       OR v_search_path IS DISTINCT FROM v_expected.search_path_config THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_SOURCE_OR_METADATA_DRIFT:%', v_expected.signature;
    END IF;

  END LOOP;

  IF (SELECT count(*) FROM stage7_voucher_trigger_before) <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_FUNCTION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM stage7_voucher_trigger_before b
    JOIN pg_catalog.pg_proc p ON p.oid = b.oid
    WHERE b.signature = 'sync_shop_voucher_order_status()'
      AND b.source_md5 = '70302d030b5cae3af7f978afdae3cea3'
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef
      AND coalesce(array_to_string(p.proconfig, ', '), '') = 'search_path=""'
      AND p.prorettype = 'trigger'::regtype
      AND p.proargtypes::oid[] = ARRAY[]::oid[]
      AND p.proacl IS NULL
      AND pg_catalog.has_function_privilege(p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_FUNCTION_FINGERPRINT_OR_ACL_DRIFT';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgname = 'trg_sync_shop_voucher_order_status'
      AND t.tgrelid = 'public.orders'::regclass
      AND t.tgfoid = 'private.sync_shop_voucher_order_status()'::regprocedure
      AND t.tgenabled = 'O'
  ) <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_ATTACHMENT_DRIFT';
  END IF;
END;
$stage7_post_stage3_user_rpc_preflight$;

-- Schema-only export omits grants for these functions because they are
-- outside the original Stage 3 ACL allowlist. A read-only Production catalog
-- check verified: postgres owner + EXECUTE for authenticated/service_role;
-- no PUBLIC or anon EXECUTE. Rebuild that exact boundary on disposable restore.
REVOKE ALL PRIVILEGES ON FUNCTION public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.list_my_shop_vouchers()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_shop_vouchers()
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)
  TO authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.mark_my_shop_vouchers_seen()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_my_shop_vouchers_seen()
  TO authenticated, service_role;

UPDATE stage7_post_stage3_user_rpc_before b
SET proacl = p.proacl
FROM pg_catalog.pg_proc p
WHERE p.oid = b.oid;

DO $stage7_post_stage3_user_rpc_acl_postflight$
DECLARE
  v_expected record;
  v_acl_count integer;
  v_public_execute boolean;
  v_anon_execute boolean;
  v_authenticated_execute boolean;
  v_service_role_execute boolean;
  v_postgres_execute boolean;
BEGIN
  FOR v_expected IN SELECT oid, signature FROM stage7_post_stage3_user_rpc_before
  LOOP
    SELECT
      (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f',p.proowner)))),
      EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE'),
      pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE'),
      pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE'),
      pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE'),
      pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')
    INTO v_acl_count,v_public_execute,v_anon_execute,v_authenticated_execute,v_service_role_execute,v_postgres_execute
    FROM pg_catalog.pg_proc p WHERE p.oid=v_expected.oid;

    IF v_acl_count <> 3 OR v_public_execute OR v_anon_execute
       OR NOT v_authenticated_execute OR NOT v_service_role_execute OR NOT v_postgres_execute THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_ACL_RESTORE_POSTCONDITION_FAILED:%',v_expected.signature;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=acl.grantee
      LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=acl.grantor
      WHERE p.oid=v_expected.oid
        AND (grantee.rolname NOT IN ('postgres','authenticated','service_role')
          OR grantor.rolname IS DISTINCT FROM 'postgres'
          OR acl.privilege_type IS DISTINCT FROM 'EXECUTE'
          OR acl.is_grantable)
    ) THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_ACL_GRANTEE_SET_DRIFT:%',v_expected.signature;
    END IF;
  END LOOP;
END;
$stage7_post_stage3_user_rpc_acl_postflight$;

DO $stage7_post_stage3_user_rpc_patch$
DECLARE
  v_expected record;
  v_definition text;
  v_begin_position integer;
  v_after_begin text;
  v_replacement text;
  v_oid oid;
  v_guard text := E'IF NOT private.current_user_is_better_auth() THEN\n'
    || E'    RAISE EXCEPTION ''BETTER_AUTH_ISSUER_REQUIRED'';\n'
    || E'  END IF;';
BEGIN
  FOR v_expected IN
    SELECT * FROM (VALUES
      ('create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)', E'begin\n  if v_uid is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)', E'begin if v_uid is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])', E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])', E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])', E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('list_my_shop_vouchers()', E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('list_shop_checkout_vouchers(uuid,integer,numeric,numeric)', E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;'),
      ('mark_my_shop_vouchers_seen()', E'begin\n  if auth.uid() is null then raise exception ''AUTH_REQUIRED''; end if;')
    ) AS expected(signature, auth_anchor)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    SELECT pg_catalog.pg_get_functiondef(v_oid)
    INTO v_definition
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_oid;

    IF v_definition IS NULL
       OR pg_catalog.strpos(v_definition, v_expected.auth_anchor) = 0 THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_AUTH_ANCHOR_DRIFT:%', v_expected.signature;
    END IF;

    v_begin_position := pg_catalog.strpos(v_expected.auth_anchor, 'begin');
    IF v_begin_position <> 1 THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_BEGIN_ANCHOR_DRIFT:%', v_expected.signature;
    END IF;

    v_after_begin := pg_catalog.regexp_replace(
      pg_catalog.substring(v_expected.auth_anchor FROM v_begin_position + 5),
      '^[[:space:]]+',
      ''
    );
    v_replacement := 'begin' || E'\n  ' || v_guard || E'\n  ' || v_after_begin;

    v_definition := pg_catalog.replace(
      v_definition,
      v_expected.auth_anchor,
      v_replacement
    );

    IF pg_catalog.strpos(v_definition, 'private.current_user_is_better_auth()') = 0
       OR pg_catalog.strpos(v_definition, 'private.current_user_is_better_auth()')
          > pg_catalog.strpos(v_definition, 'AUTH_REQUIRED') THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_ISSUER_GUARD_POSTCONDITION_FAILED:%', v_expected.signature;
    END IF;

    EXECUTE v_definition;
  END LOOP;
END;
$stage7_post_stage3_user_rpc_patch$;

-- The private voucher status trigger is created already and is invoked by
-- PostgreSQL as a trigger, not as a user-callable RPC. Remove the default
-- PUBLIC EXECUTE grant without changing the enabled trigger attachment.
REVOKE ALL PRIVILEGES ON FUNCTION private.sync_shop_voucher_order_status()
  FROM PUBLIC, anon, authenticated, service_role;

DO $stage7_post_stage3_user_rpc_postflight$
DECLARE
  v_expected record;
  v_source text;
  v_owner text;
  v_security_definer boolean;
  v_search_path text[];
  v_acl aclitem[];
  v_argtypes oid[];
  v_return_type oid;
  v_oid oid;
BEGIN
  FOR v_expected IN SELECT * FROM stage7_post_stage3_user_rpc_before
  LOOP
    SELECT
      p.prosrc,
      pg_catalog.pg_get_userbyid(p.proowner),
      p.prosecdef,
      p.proconfig,
      p.proacl,
      p.proargtypes::oid[],
      p.prorettype
    INTO
      v_source,
      v_owner,
      v_security_definer,
      v_search_path,
      v_acl,
      v_argtypes,
      v_return_type
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_expected.oid;

    IF v_owner IS DISTINCT FROM 'postgres'
       OR v_security_definer IS DISTINCT FROM TRUE
       OR v_search_path IS DISTINCT FROM v_expected.proconfig
       OR v_acl IS DISTINCT FROM v_expected.proacl
       OR v_argtypes IS DISTINCT FROM v_expected.proargtypes
       OR v_return_type IS DISTINCT FROM v_expected.prorettype THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_METADATA_OR_ACL_MUTATED:%', v_expected.signature;
    END IF;

    IF pg_catalog.strpos(v_source, 'private.current_user_is_better_auth()') = 0
       OR pg_catalog.strpos(v_source, 'private.current_user_is_better_auth()')
          > pg_catalog.strpos(v_source, 'AUTH_REQUIRED') THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_ISSUER_GUARD_MISSING:%', v_expected.signature;
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_expected.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_expected.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_expected.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', v_expected.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_RPC_EXECUTE_BOUNDARY_MUTATED:%', v_expected.signature;
    END IF;
  END LOOP;

  SELECT b.oid INTO v_oid FROM stage7_voucher_trigger_before b;
  IF (
    SELECT count(*)
    FROM pg_catalog.aclexplode(
      coalesce(
        (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid),
        pg_catalog.acldefault('f', (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_oid))
      )
    )
  ) <> 1
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('postgres', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_ACL_NOT_RESTRICTED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgname = 'trg_sync_shop_voucher_order_status'
      AND t.tgrelid = 'public.orders'::regclass
      AND t.tgfoid = v_oid
      AND t.tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_DISABLED_OR_DETACHED';
  END IF;

  IF md5((SELECT p.prosrc FROM pg_catalog.pg_proc p WHERE p.oid = v_oid))
     IS DISTINCT FROM '70302d030b5cae3af7f978afdae3cea3' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_BODY_MUTATED';
  END IF;
END;
$stage7_post_stage3_user_rpc_postflight$;

COMMIT;
