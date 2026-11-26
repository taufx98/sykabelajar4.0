-- DRAFT TEST ONLY — Run only on the PostgreSQL 17.6 disposable schema restore
-- AFTER AUTH-STAGE-5-NO-POLICY-TABLE-ACL-DRAFT.sql has been applied.
-- This script is read-only. It creates no policy, grant, row, or table change.
-- It verifies the reviewed 23 application tables remain default-deny to browser
-- roles while service_role backend access and intentionally narrow RPC access
-- are preserved.

\set ON_ERROR_STOP on
BEGIN READ ONLY;

DO $stage7_private_schema_api_boundary$
BEGIN
  -- Private helper EXECUTE catalog flags do not make these routines browser-callable:
  -- anon/authenticated must not have schema USAGE or CREATE on the private namespace.
  IF pg_catalog.has_schema_privilege('anon','private','USAGE') THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_ANON_PRIVATE_SCHEMA_USAGE_REMAINS';
  END IF;
  IF pg_catalog.has_schema_privilege('authenticated','private','USAGE') THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_AUTHENTICATED_PRIVATE_SCHEMA_USAGE_REMAINS';
  END IF;
  IF pg_catalog.has_schema_privilege('anon','private','CREATE') THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_ANON_PRIVATE_SCHEMA_CREATE_REMAINS';
  END IF;
  IF pg_catalog.has_schema_privilege('authenticated','private','CREATE') THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_AUTHENTICATED_PRIVATE_SCHEMA_CREATE_REMAINS';
  END IF;
  IF pg_catalog.has_schema_privilege('service_role','private','USAGE') THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_SERVICE_ROLE_PRIVATE_SCHEMA_USAGE_REMAINS';
  END IF;
  IF pg_catalog.has_schema_privilege('service_role','private','CREATE') THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_SERVICE_ROLE_PRIVATE_SCHEMA_CREATE_REMAINS';
  END IF;
END;
$stage7_private_schema_api_boundary$;

DO $stage7_rls_table_review$
DECLARE
  v_item record;
  v_oid oid;
  v_owner text;
  v_rls boolean;
  v_policy_count integer;
  v_privilege text;
  v_acl text;
  v_anon_inherited_roles text;
  v_authenticated_inherited_roles text;
  v_default_acl text;
  v_checked integer := 0;
BEGIN
  FOR v_item IN
    SELECT *
    FROM (VALUES
      ('private','organizer_free_identity_claims',false),
      ('private','referral_program_settings',false),
      ('private','referral_tier_awards',false),
      ('public','chat_group_collective_reads',true),
      ('public','chat_group_invites',true),
      ('public','chat_group_members',true),
      ('public','chat_group_reads',true),
      ('public','chat_groups',true),
      ('public','collective_portal_credentials',true),
      ('public','collective_portal_identities',true),
      ('public','collective_portal_sessions',true),
      ('public','competition_status_history',true),
      ('public','exam_attempt_events',true),
      ('public','exam_attempt_questions',true),
      ('public','exam_attempt_runtime',true),
      ('public','notification_deliveries',true),
      ('public','payment_gateway_configs',true),
      ('public','payment_gateway_state',true),
      ('public','shop_promo_banner_events',true),
      ('public','shop_promo_banners',true),
      ('public','shop_user_vouchers',true),
      ('public','shop_voucher_definitions',true),
      ('public','supabase_system_logs',true)
    ) AS expected(schema_name,table_name,service_role_table_access)
    ORDER BY schema_name,table_name
  LOOP
    v_checked := v_checked + 1;
    v_oid := pg_catalog.to_regclass(pg_catalog.format('%I.%I',v_item.schema_name,v_item.table_name));
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_RLS_REVIEW_TABLE_MISSING:%',v_item.schema_name||'.'||v_item.table_name;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(c.relowner),c.relrowsecurity,
           (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)
    INTO v_owner,v_rls,v_policy_count
    FROM pg_catalog.pg_class c WHERE c.oid=v_oid;

    SELECT COALESCE(c.relacl::text, '<NULL>')
    INTO v_acl
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = v_oid;

    SELECT COALESCE(string_agg(r.rolname, ',' ORDER BY r.rolname), '<none>')
    INTO v_anon_inherited_roles
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname <> 'anon'
      AND pg_catalog.pg_has_role('anon', r.oid, 'USAGE');

    SELECT COALESCE(string_agg(r.rolname, ',' ORDER BY r.rolname), '<none>')
    INTO v_authenticated_inherited_roles
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname <> 'authenticated'
      AND pg_catalog.pg_has_role('authenticated', r.oid, 'USAGE');

    SELECT COALESCE(
      string_agg(d.defaclobjtype::text || ':' || COALESCE(d.defaclacl::text, '<NULL>'), ',' ORDER BY d.defaclobjtype),
      '<none>'
    )
    INTO v_default_acl
    FROM pg_catalog.pg_default_acl AS d
    JOIN pg_catalog.pg_class AS c ON c.oid = v_oid
    WHERE d.defaclrole = c.relowner
      AND d.defaclnamespace IN (0, (SELECT n.oid FROM pg_catalog.pg_namespace AS n WHERE n.nspname = v_item.schema_name));

    RAISE NOTICE
      'STAGE7_ACL_DIAGNOSTIC:%:relacl=%:anon_effective_select=%:authenticated_effective_select=%:anon_inherited_roles=%:authenticated_inherited_roles=%:owner_default_acl=%',
      v_item.schema_name || '.' || v_item.table_name,
      v_acl,
      pg_catalog.has_table_privilege('anon', v_oid, 'SELECT'),
      pg_catalog.has_table_privilege('authenticated', v_oid, 'SELECT'),
      v_anon_inherited_roles,
      v_authenticated_inherited_roles,
      v_default_acl;

    IF v_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'STAGE7_RLS_REVIEW_OWNER_DRIFT:%:%',v_item.table_name,v_owner;
    END IF;
    IF v_rls IS DISTINCT FROM true OR v_policy_count <> 0 THEN
      RAISE EXCEPTION 'STAGE7_RLS_REVIEW_POLICY_OR_RLS_DRIFT:%:rls=%:policies=%',v_item.table_name,v_rls,v_policy_count;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ] LOOP
      IF pg_catalog.has_table_privilege('anon',v_oid,v_privilege) THEN
        RAISE EXCEPTION 'STAGE7_RLS_REVIEW_ANON_DIRECT_GRANT_REMAINS:%:%',v_item.table_name,v_privilege;
      END IF;
      IF pg_catalog.has_table_privilege('authenticated',v_oid,v_privilege) THEN
        RAISE EXCEPTION 'STAGE7_RLS_REVIEW_AUTHENTICATED_DIRECT_GRANT_REMAINS:%:%',v_item.table_name,v_privilege;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class acl_table
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(acl_table.relacl,pg_catalog.acldefault('r',acl_table.relowner))
      ) acl
      WHERE acl_table.oid=v_oid AND acl.grantee=0
    ) THEN
      RAISE EXCEPTION 'STAGE7_RLS_REVIEW_PUBLIC_ACL_REMAINS:%',v_item.table_name;
    END IF;

    IF v_item.service_role_table_access THEN
      IF NOT pg_catalog.has_table_privilege('service_role',v_oid,'SELECT')
         OR NOT pg_catalog.has_table_privilege('service_role',v_oid,'INSERT')
         OR NOT pg_catalog.has_table_privilege('service_role',v_oid,'UPDATE')
         OR NOT pg_catalog.has_table_privilege('service_role',v_oid,'DELETE') THEN
        RAISE EXCEPTION 'STAGE7_RLS_REVIEW_SERVICE_ROLE_ACCESS_LOST:%',v_item.table_name;
      END IF;
    ELSE
      IF pg_catalog.has_table_privilege('service_role',v_oid,'SELECT')
         OR pg_catalog.has_table_privilege('service_role',v_oid,'INSERT')
         OR pg_catalog.has_table_privilege('service_role',v_oid,'UPDATE')
         OR pg_catalog.has_table_privilege('service_role',v_oid,'DELETE') THEN
        RAISE EXCEPTION 'STAGE7_RLS_REVIEW_PRIVATE_TABLE_SERVICE_GRANT_UNEXPECTED:%',v_item.table_name;
      END IF;
    END IF;
  END LOOP;

  IF v_checked <> 23 THEN
    RAISE EXCEPTION 'STAGE7_RLS_REVIEW_TABLE_COUNT_MISMATCH:%',v_checked;
  END IF;
END;
$stage7_rls_table_review$;

DO $stage7_log_table_caller_boundary$
DECLARE
  v_oid oid;
  v_acl_count integer;
BEGIN
  -- notification_deliveries is retained for compatibility, but the live
  -- Production catalog/repository review found no database or realtime
  -- entrypoint. The only supported table boundary is service_role after Stage 5.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE position('notification_deliveries' IN lower(p.prosrc)) > 0
  ) THEN
    RAISE EXCEPTION 'STAGE7_NOTIFICATION_DELIVERIES_UNREVIEWED_FUNCTION_CALLER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgrelid = 'public.notification_deliveries'::regclass
  ) THEN
    RAISE EXCEPTION 'STAGE7_NOTIFICATION_DELIVERIES_UNREVIEWED_TRIGGER';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_rewrite r ON r.oid=d.objid
    JOIN pg_catalog.pg_class dependent ON dependent.oid=r.ev_class
    WHERE d.refobjid='public.notification_deliveries'::regclass
      AND dependent.relkind IN ('v','m')
  ) THEN
    RAISE EXCEPTION 'STAGE7_NOTIFICATION_DELIVERIES_UNREVIEWED_VIEW';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables pt
    WHERE pt.schemaname='public'
      AND pt.tablename='notification_deliveries'
  ) THEN
    RAISE EXCEPTION 'STAGE7_NOTIFICATION_DELIVERIES_REALTIME_PUBLICATION_FOUND';
  END IF;

  -- supabase_system_logs has one trusted collector. It must remain callable
  -- by service_role only; no browser or PUBLIC EXECUTE path is accepted.
  v_oid := pg_catalog.to_regprocedure('public.fetch_and_save_supabase_logs()');
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_FUNCTION_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE p.oid=v_oid
      AND n.nspname='public'
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef
      AND coalesce(array_to_string(p.proconfig,', '),'')='search_path=public, extensions, pg_catalog'
      AND md5(p.prosrc)='5d0e79655d70a9019040ab9f4d529c88'
      AND p.prorettype='void'::regtype
      AND p.proargtypes::oid[]=ARRAY[]::oid[]
      AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
      AND pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_TRUSTED_CALLER_BOUNDARY_FAILED';
  END IF;

  SELECT count(*)
  INTO v_acl_count
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
  ) acl
  WHERE p.oid=v_oid;

  IF v_acl_count <> 2 THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOG_COLLECTOR_ACL_COUNT_DRIFT';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgrelid='public.supabase_system_logs'::regclass
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables pt
    WHERE pt.schemaname='public'
      AND pt.tablename='supabase_system_logs'
  ) THEN
    RAISE EXCEPTION 'STAGE7_SYSTEM_LOGS_UNREVIEWED_TRIGGER_OR_REALTIME_ENTRYPOINT';
  END IF;
END;
$stage7_log_table_caller_boundary$;

ROLLBACK;
