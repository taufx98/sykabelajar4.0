-- DRAFT ONLY — Stage 3 issuer restriction for the existing application RLS surface.
-- Apply only after the Better Auth identity-root draft and 69-FK cutover have
-- passed on the disposable PostgreSQL 17.6 restore.
--
-- Because legacy accounts are not migrated, the application accepts only the
-- Better Auth OIDC issuer after this Stage 3 cutover. Supabase Auth JWTs are
-- intentionally denied by the restrictive guard.
-- This adds RESTRICTIVE policies only. It does not create a permissive path,
-- change any existing policy, alter grants, or touch production by itself.
-- This is the Better Auth-only issuer gate; it does not change existing
-- permissive policies, grants or business-role authorization.

BEGIN;

DO $stage3_issuer_guard$
DECLARE
  v_table record;
  v_created integer := 0;
  v_expected_tables constant integer := 61;
  v_better_auth_issuer constant text := 'https://auth.sykabelajar.my.id/api/auth';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policy pol
    JOIN pg_class tbl ON tbl.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname IN ('public', 'private')
      AND pol.polname = 'better_auth_issuer_guard'
  ) THEN
    RAISE EXCEPTION 'STAGE3_ISSUER_GUARD_ALREADY_EXISTS';
  END IF;

  FOR v_table IN
    SELECT DISTINCT ns.nspname AS schema_name, tbl.relname AS table_name
    FROM pg_policy pol
    JOIN pg_class tbl ON tbl.oid = pol.polrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname IN ('public', 'private')
      AND tbl.relrowsecurity
      AND (
        COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') ILIKE '%auth.uid%'
        OR COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ILIKE '%auth.uid%'
      )
    ORDER BY ns.nspname, tbl.relname
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY %I ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated
       USING ((SELECT auth.jwt() ->> ''iss'') = %L)
       WITH CHECK ((SELECT auth.jwt() ->> ''iss'') = %L)',
      'better_auth_issuer_guard',
      v_table.schema_name,
      v_table.table_name,
      v_better_auth_issuer,
      v_better_auth_issuer
    );
    v_created := v_created + 1;
  END LOOP;

  IF v_created <> v_expected_tables THEN
    RAISE EXCEPTION 'STAGE3_ISSUER_GUARD_TABLE_COUNT_DRIFT: expected %, created %',
      v_expected_tables, v_created;
  END IF;
END;
$stage3_issuer_guard$;

COMMIT;

-- This file is a reviewed draft only. The Stage 3 baseline workflow applies it
-- exclusively to the disposable restored database and verifies all 61 guards.
