-- Stage 5 targeted Data API privilege hardening draft.
-- Deliberately stored outside supabase/migrations. Do not apply to Production
-- before separate Stage 5/6/7 acceptance and explicit cutover authorization.
--
-- Scope: only these three public tables were confirmed to have RLS enabled,
-- zero policies, and broad anon/authenticated table ACLs:
--   competition_status_history
--   notification_deliveries
--   supabase_system_logs
--
-- The Auth Production Schema Baseline workflow runs the contract test and applies
-- this draft only after restoring a disposable schema-only copy of Production.
-- No credentials, table rows or user data are restored into that disposable project.
-- Current application access uses trusted database functions/triggers and
-- server-side service_role paths. This draft preserves service_role and
-- postgres access, leaves RLS enabled, and creates no new row policies.

BEGIN;

DO $preflight$
DECLARE
  v_table record;
  v_checked integer := 0;
BEGIN
  FOR v_table IN
    SELECT n.nspname,
           c.relname,
           c.oid,
           pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
           c.relrowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'competition_status_history',
        'notification_deliveries',
        'supabase_system_logs'
      ]::text[])
    ORDER BY c.relname
  LOOP
    v_checked := v_checked + 1;

    IF v_table.table_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_OWNER_DRIFT:%:%', v_table.relname, v_table.table_owner;
    END IF;

    IF v_table.relrowsecurity IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_RLS_DISABLED:%', v_table.relname;
    END IF;
    IF v_table.policy_count <> 0 THEN
      RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_POLICY_DRIFT:%', v_table.relname;
    END IF;

    -- Require the exact grants observed in the Production catalog review, including
    -- the PostgreSQL 17 MAINTAIN privilege that controls maintenance operations.
    -- If a future schema change alters these assumptions, stop instead of
    -- silently applying a stale privilege draft.
    IF NOT has_table_privilege('anon', v_table.oid, 'SELECT')
       OR NOT has_table_privilege('anon', v_table.oid, 'INSERT')
       OR NOT has_table_privilege('anon', v_table.oid, 'UPDATE')
       OR NOT has_table_privilege('anon', v_table.oid, 'DELETE')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'SELECT')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'INSERT')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'UPDATE')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'DELETE')
       OR NOT has_table_privilege('anon', v_table.oid, 'TRUNCATE')
       OR NOT has_table_privilege('anon', v_table.oid, 'REFERENCES')
       OR NOT has_table_privilege('anon', v_table.oid, 'TRIGGER')
       OR NOT has_table_privilege('anon', v_table.oid, 'MAINTAIN')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'TRUNCATE')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'REFERENCES')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'TRIGGER')
       OR NOT has_table_privilege('authenticated', v_table.oid, 'MAINTAIN') THEN
      RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_GRANT_DRIFT:%', v_table.relname;
    END IF;

    -- This reviewed Production baseline has no explicit PUBLIC table ACL.
    -- If one appears before cutover, stop for a fresh ACL review rather than
    -- silently accepting an inherited grant that could bypass RLS.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS acl_table
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(acl_table.relacl, pg_catalog.acldefault('r', acl_table.relowner))
      ) AS acl
      WHERE acl_table.oid = v_table.oid
        AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_PUBLIC_GRANT_DRIFT:%', v_table.relname;
    END IF;

    -- Trusted backend and migration-owner grants are prerequisites.
    IF NOT has_table_privilege('service_role', v_table.oid, 'SELECT')
       OR NOT has_table_privilege('service_role', v_table.oid, 'INSERT')
       OR NOT has_table_privilege('service_role', v_table.oid, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_table.oid, 'DELETE')
       OR NOT has_table_privilege('postgres', v_table.oid, 'SELECT')
       OR NOT has_table_privilege('postgres', v_table.oid, 'INSERT')
       OR NOT has_table_privilege('postgres', v_table.oid, 'UPDATE')
       OR NOT has_table_privilege('postgres', v_table.oid, 'DELETE')
       OR NOT has_table_privilege('service_role', v_table.oid, 'MAINTAIN')
       OR NOT has_table_privilege('postgres', v_table.oid, 'MAINTAIN') THEN
      RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_TRUSTED_ROLE_GRANT_MISSING:%', v_table.relname;
    END IF;
  END LOOP;

  IF v_checked <> 3 THEN
    RAISE EXCEPTION 'STAGE5_ACL_PREFLIGHT_TABLE_COUNT:%', v_checked;
  END IF;
END;
$preflight$;

REVOKE ALL ON TABLE
  public.competition_status_history,
  public.notification_deliveries,
  public.supabase_system_logs
FROM PUBLIC, anon, authenticated;

DO $postcondition$
DECLARE
  v_table record;
  v_checked integer := 0;
BEGIN
  FOR v_table IN
    SELECT c.relname,
           c.oid,
           pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
           c.relrowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY (ARRAY[
        'competition_status_history',
        'notification_deliveries',
        'supabase_system_logs'
      ]::text[])
    ORDER BY c.relname
  LOOP
    v_checked := v_checked + 1;

    IF v_table.table_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'STAGE5_ACL_POSTCONDITION_OWNER_DRIFT:%:%', v_table.relname, v_table.table_owner;
    END IF;

    IF v_table.relrowsecurity IS DISTINCT FROM true OR v_table.policy_count <> 0 THEN
      RAISE EXCEPTION 'STAGE5_ACL_POSTCONDITION_SCHEMA_CHANGED:%', v_table.relname;
    END IF;

    IF has_table_privilege('anon', v_table.oid, 'SELECT')
       OR has_table_privilege('anon', v_table.oid, 'INSERT')
       OR has_table_privilege('anon', v_table.oid, 'UPDATE')
       OR has_table_privilege('anon', v_table.oid, 'DELETE')
       OR has_table_privilege('authenticated', v_table.oid, 'SELECT')
       OR has_table_privilege('authenticated', v_table.oid, 'INSERT')
       OR has_table_privilege('authenticated', v_table.oid, 'UPDATE')
       OR has_table_privilege('authenticated', v_table.oid, 'DELETE')
       OR has_table_privilege('anon', v_table.oid, 'TRUNCATE')
       OR has_table_privilege('anon', v_table.oid, 'REFERENCES')
       OR has_table_privilege('anon', v_table.oid, 'TRIGGER')
       OR has_table_privilege('anon', v_table.oid, 'MAINTAIN')
       OR has_table_privilege('authenticated', v_table.oid, 'TRUNCATE')
       OR has_table_privilege('authenticated', v_table.oid, 'REFERENCES')
       OR has_table_privilege('authenticated', v_table.oid, 'TRIGGER')
       OR has_table_privilege('authenticated', v_table.oid, 'MAINTAIN') THEN
      RAISE EXCEPTION 'STAGE5_ACL_POSTCONDITION_BROWSER_GRANT_REMAINS:%', v_table.relname;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS acl_table
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(acl_table.relacl, pg_catalog.acldefault('r', acl_table.relowner))
      ) AS acl
      WHERE acl_table.oid = v_table.oid
        AND acl.grantee = 0
    ) THEN
      RAISE EXCEPTION 'STAGE5_ACL_POSTCONDITION_PUBLIC_GRANT_REMAINS:%', v_table.relname;
    END IF;

    IF NOT has_table_privilege('service_role', v_table.oid, 'SELECT')
       OR NOT has_table_privilege('service_role', v_table.oid, 'INSERT')
       OR NOT has_table_privilege('service_role', v_table.oid, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_table.oid, 'DELETE')
       OR NOT has_table_privilege('postgres', v_table.oid, 'SELECT')
       OR NOT has_table_privilege('postgres', v_table.oid, 'INSERT')
       OR NOT has_table_privilege('postgres', v_table.oid, 'UPDATE')
       OR NOT has_table_privilege('postgres', v_table.oid, 'DELETE')
       OR NOT has_table_privilege('service_role', v_table.oid, 'MAINTAIN')
       OR NOT has_table_privilege('postgres', v_table.oid, 'MAINTAIN') THEN
      RAISE EXCEPTION 'STAGE5_ACL_POSTCONDITION_TRUSTED_ROLE_ACCESS_LOST:%', v_table.relname;
    END IF;
  END LOOP;

  IF v_checked <> 3 THEN
    RAISE EXCEPTION 'STAGE5_ACL_POSTCONDITION_TABLE_COUNT:%', v_checked;
  END IF;
END;
$postcondition$;

COMMIT;
