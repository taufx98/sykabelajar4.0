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

ROLLBACK;
