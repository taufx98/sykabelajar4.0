-- STAGE 7 RLS NO-POLICY BROWSER-GRANT HARDENING DRAFT
-- Production DB2 only. DO NOT RUN until:
--   1) the owner-verified off-GitHub full backup checksum is recorded;
--   2) the current catalog is re-read and matches this exact table/ACL baseline;
--   3) a disposable PostgreSQL 17.6 restore passes the SQL and caller tests;
--   4) the owner approves this exact privilege-only DDL operation.
--
-- Scope is deliberately limited to three public tables which currently have:
--   * RLS enabled;
--   * zero policies (therefore browser table access is already default-deny);
--   * explicit ALL table grants to anon, authenticated and service_role.
--
-- This draft removes only the redundant browser-role table grants. It does not
-- create RLS policies, alter RLS enablement, revoke service_role, change PUBLIC
-- or postgres ownership, edit rows, change triggers/functions, or touch auth,
-- storage, application records, FK relationships, or staging resources.
--
-- Reviewed caller notes (live catalog/source inspection, 21 Nov 2026):
--   competition_status_history:
--     used by postgres-owned SECURITY DEFINER functions
--     public.track_competition_status(), public.transition_competition(...),
--     public.get_public_competition_results(...),
--     public.admin_get_monitoring_dashboard(...), and
--     private.monthly_organizer_competition_quota(...).
--   notification_deliveries:
--     no PostgreSQL function body reference was found in the current pg_proc
--     source scan. Keep service_role CRUD intact for trusted backend delivery
--     recording; no browser policy or direct browser access is approved.
--   supabase_system_logs:
--     written by postgres-owned SECURITY DEFINER
--     public.fetch_and_save_supabase_logs().
--
-- All three tables remain RLS-enabled with no policies after this change.
-- Direct browser-role access therefore stays denied at both ACL and RLS layers.
-- service_role retains all four CRUD privileges for backend use.

BEGIN;

DO $preflight$
DECLARE
  v_table regclass;
  v_name text;
  v_owner text;
  v_rls boolean;
  v_policy_count integer;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.competition_status_history',
    'public.notification_deliveries',
    'public.supabase_system_logs'
  ]
  LOOP
    v_table := pg_catalog.to_regclass(v_name);
    IF v_table IS NULL THEN
      RAISE EXCEPTION 'RLS_HARDENING_TABLE_MISSING: %', v_name;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(c.relowner), c.relrowsecurity
      INTO v_owner, v_rls
    FROM pg_catalog.pg_class c
    WHERE c.oid = v_table;

    IF v_owner IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'RLS_HARDENING_UNEXPECTED_OWNER: % owner=%', v_name, v_owner;
    END IF;
    IF v_rls IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'RLS_HARDENING_RLS_DISABLED: %', v_name;
    END IF;

    SELECT count(*)::integer INTO v_policy_count
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = split_part(v_name, '.', 1)
      AND p.tablename = split_part(v_name, '.', 2);

    IF v_policy_count <> 0 THEN
      RAISE EXCEPTION 'RLS_HARDENING_POLICY_DRIFT: % has % policies', v_name, v_policy_count;
    END IF;

    IF NOT pg_catalog.has_table_privilege('anon', v_table, 'SELECT')
       OR NOT pg_catalog.has_table_privilege('anon', v_table, 'INSERT')
       OR NOT pg_catalog.has_table_privilege('anon', v_table, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege('anon', v_table, 'DELETE')
       OR NOT pg_catalog.has_table_privilege('authenticated', v_table, 'SELECT')
       OR NOT pg_catalog.has_table_privilege('authenticated', v_table, 'INSERT')
       OR NOT pg_catalog.has_table_privilege('authenticated', v_table, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege('authenticated', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'RLS_HARDENING_GRANT_DRIFT: expected broad browser grants on %', v_name;
    END IF;

    IF NOT pg_catalog.has_table_privilege('service_role', v_table, 'SELECT')
       OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'INSERT')
       OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege('service_role', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'RLS_HARDENING_SERVICE_ROLE_BASELINE_MISMATCH: %', v_name;
    END IF;
  END LOOP;
END;
$preflight$;

REVOKE ALL PRIVILEGES ON TABLE
  public.competition_status_history,
  public.notification_deliveries,
  public.supabase_system_logs
FROM anon, authenticated;

DO $postflight$
DECLARE
  v_table regclass;
  v_name text;
  v_privilege text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'public.competition_status_history',
    'public.notification_deliveries',
    'public.supabase_system_logs'
  ]
  LOOP
    v_table := pg_catalog.to_regclass(v_name);

    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
    LOOP
      IF pg_catalog.has_table_privilege('anon', v_table, v_privilege) THEN
        RAISE EXCEPTION 'RLS_HARDENING_ANON_GRANT_REMAINS: % %', v_name, v_privilege;
      END IF;
      IF pg_catalog.has_table_privilege('authenticated', v_table, v_privilege) THEN
        RAISE EXCEPTION 'RLS_HARDENING_AUTHENTICATED_GRANT_REMAINS: % %', v_name, v_privilege;
      END IF;
      IF NOT pg_catalog.has_table_privilege('service_role', v_table, v_privilege) THEN
        RAISE EXCEPTION 'RLS_HARDENING_SERVICE_ROLE_GRANT_MISSING: % %', v_name, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
END;
$postflight$;

COMMIT;
