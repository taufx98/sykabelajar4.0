-- DISPOSABLE LOCAL DATABASE ONLY.
-- Reconstruct the reviewed Production ACL boundary omitted by schema-only restore.
-- Mounted only by .github/workflows/auth-schema-baseline.yml into PostgreSQL 17.6.
-- NEVER execute on Production or any shared/staging database.
--
-- The 17 public tables below have RLS enabled, zero policies, and Production ACLs
-- for postgres + service_role only. Three broad-grant tables are intentionally
-- excluded: Stage 5's reviewed ACL draft validates and revokes those separately.

BEGIN;

DO $stage7_restore_disposable_table_acl$
DECLARE
  v_table record;
  v_oid oid;
  v_owner text;
  v_rls boolean;
  v_policy_count integer;
  v_privilege text;
BEGIN
  FOR v_table IN
    SELECT *
    FROM (VALUES
      ('public', 'chat_group_collective_reads'),
      ('public', 'chat_group_invites'),
      ('public', 'chat_group_members'),
      ('public', 'chat_group_reads'),
      ('public', 'chat_groups'),
      ('public', 'collective_portal_credentials'),
      ('public', 'collective_portal_identities'),
      ('public', 'collective_portal_sessions'),
      ('public', 'exam_attempt_events'),
      ('public', 'exam_attempt_questions'),
      ('public', 'exam_attempt_runtime'),
      ('public', 'payment_gateway_configs'),
      ('public', 'payment_gateway_state'),
      ('public', 'shop_promo_banner_events'),
      ('public', 'shop_promo_banners'),
      ('public', 'shop_user_vouchers'),
      ('public', 'shop_voucher_definitions')
    ) AS expected(schema_name, table_name)
    ORDER BY schema_name, table_name
  LOOP
    v_oid := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', v_table.schema_name, v_table.table_name)
    );
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_TABLE_MISSING:%', v_table.schema_name || '.' || v_table.table_name;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relrowsecurity
      INTO v_owner, v_rls
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = v_oid;

    IF v_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_OWNER_DRIFT:%:%',
        v_table.schema_name || '.' || v_table.table_name, v_owner;
    END IF;
    IF v_rls IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_RLS_DISABLED:%',
        v_table.schema_name || '.' || v_table.table_name;
    END IF;

    SELECT count(*)::integer INTO v_policy_count
    FROM pg_catalog.pg_policy AS p
    WHERE p.polrelid = v_oid;
    IF v_policy_count <> 0 THEN
      RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_POLICY_DRIFT:%:%',
        v_table.schema_name || '.' || v_table.table_name, v_policy_count;
    END IF;

    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ] LOOP
      IF NOT pg_catalog.has_table_privilege('service_role', v_oid, v_privilege) THEN
        RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_TRUSTED_GRANT_MISSING:%:%',
          v_table.schema_name || '.' || v_table.table_name, v_privilege;
      END IF;
    END LOOP;

    EXECUTE pg_catalog.format(
      'REVOKE ALL PRIVILEGES ON TABLE %I.%I FROM PUBLIC, anon, authenticated',
      v_table.schema_name,
      v_table.table_name
    );
  END LOOP;

  FOR v_table IN
    SELECT *
    FROM (VALUES
      ('public', 'chat_group_collective_reads'),
      ('public', 'chat_group_invites'),
      ('public', 'chat_group_members'),
      ('public', 'chat_group_reads'),
      ('public', 'chat_groups'),
      ('public', 'collective_portal_credentials'),
      ('public', 'collective_portal_identities'),
      ('public', 'collective_portal_sessions'),
      ('public', 'exam_attempt_events'),
      ('public', 'exam_attempt_questions'),
      ('public', 'exam_attempt_runtime'),
      ('public', 'payment_gateway_configs'),
      ('public', 'payment_gateway_state'),
      ('public', 'shop_promo_banner_events'),
      ('public', 'shop_promo_banners'),
      ('public', 'shop_user_vouchers'),
      ('public', 'shop_voucher_definitions')
    ) AS expected(schema_name, table_name)
  LOOP
    v_oid := pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', v_table.schema_name, v_table.table_name)
    );

    FOREACH v_privilege IN ARRAY ARRAY[
      'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
    ] LOOP
      IF pg_catalog.has_table_privilege('anon', v_oid, v_privilege)
         OR pg_catalog.has_table_privilege('authenticated', v_oid, v_privilege) THEN
        RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_BROWSER_GRANT_REMAINS:%:%',
          v_table.schema_name || '.' || v_table.table_name, v_privilege;
      END IF;
      IF NOT pg_catalog.has_table_privilege('service_role', v_oid, v_privilege) THEN
        RAISE EXCEPTION 'STAGE7_DISPOSABLE_ACL_TRUSTED_GRANT_LOST:%:%',
          v_table.schema_name || '.' || v_table.table_name, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$stage7_restore_disposable_table_acl$;

COMMIT;
