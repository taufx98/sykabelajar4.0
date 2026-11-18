-- Rollback-only acceptance for the Stage 3 restrictive issuer guard.
-- Run only against the complete disposable schema restore after the guard draft.
\set ON_ERROR_STOP on
BEGIN;

DO $verify_policy_catalog$
DECLARE
  v_authenticated oid;
  v_guard_count integer;
  v_guard_table_count integer;
  v_bad_count integer;
BEGIN
  SELECT oid INTO v_authenticated FROM pg_roles WHERE rolname = 'authenticated';

  SELECT count(*), count(DISTINCT pol.polrelid)
    INTO v_guard_count, v_guard_table_count
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard'
    AND pol.polpermissive = false
    AND pol.polcmd = '*'
    AND pol.polroles @> ARRAY[v_authenticated]::oid[]
    AND pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%auth.jwt%'
    AND pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%auth.jwt%';

  IF v_guard_count <> 61 OR v_guard_table_count <> 61 THEN
    RAISE EXCEPTION 'STAGE3_ISSUER_GUARD_COVERAGE_FAILED: policies %, tables %',
      v_guard_count, v_guard_table_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM pg_policy pol
  JOIN pg_class tbl ON tbl.oid = pol.polrelid
  JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname IN ('public', 'private')
    AND pol.polname = 'better_auth_issuer_guard'
    AND (
      pg_get_expr(pol.polqual, pol.polrelid) NOT LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) NOT LIKE '%https://auth-prod.sykabelajar.my.id/api/auth%'
      OR pg_get_expr(pol.polqual, pol.polrelid) LIKE '%https://mvdczyitbkxkldjughor.supabase.co/auth/v1%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) LIKE '%https://mvdczyitbkxkldjughor.supabase.co/auth/v1%'
    );
  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'STAGE3_ISSUER_GUARD_ALLOWED_ISSUER_DRIFT: %', v_bad_count;
  END IF;
END;
$verify_policy_catalog$;

CREATE TABLE public.auth_issuer_guard_probe (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  marker text NOT NULL
);
ALTER TABLE public.auth_issuer_guard_probe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_issuer_guard_probe FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_issuer_guard_probe FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auth_issuer_guard_probe TO authenticated;

CREATE POLICY auth_issuer_guard_probe_owner
  ON public.auth_issuer_guard_probe
  FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = owner_id)
  WITH CHECK ((SELECT auth.uid()) = owner_id);

CREATE POLICY better_auth_issuer_guard
  ON public.auth_issuer_guard_probe
  AS RESTRICTIVE
  FOR ALL TO authenticated
  USING ((SELECT auth.jwt() ->> 'iss') = 'https://auth-prod.sykabelajar.my.id/api/auth')
  WITH CHECK ((SELECT auth.jwt() ->> 'iss') = 'https://auth-prod.sykabelajar.my.id/api/auth');

-- Simulate one retained legacy Admin UUID and one new Better Auth Admin.
-- The legacy role row is kept, but must not satisfy any authenticated Admin helper.
INSERT INTO private.app_users (id, identity_origin)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy_reference'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'better_auth');
INSERT INTO public.user_roles (user_id, role, is_active)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'admin'::public.app_role, TRUE),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'::public.app_role, TRUE);

INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
VALUES
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner-a'),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner-b');

SET LOCAL ROLE authenticated;

-- Supabase Auth is not a trusted application login after this cutover.
-- Even a legacy Auth subject that was previously valid is now denied.
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $legacy_issuer$
DECLARE
  v_count integer;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_READ_ALLOWED'; END IF;
  IF private.current_user_is_admin() THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_ADMIN_HELPER_ALLOWED';
  END IF;
  IF public.is_active_admin('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_IS_ACTIVE_ADMIN_ALLOWED';
  END IF;
  v_denied := false;
  BEGIN
    PERFORM public.admin_set_collective_certificate_price(12);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'FORBIDDEN' THEN
      v_denied := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_DIRECT_ADMIN_RPC_ALLOWED';
  END IF;
  IF private.current_user_organizer_role('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_ORGANIZER_ROLE_ALLOWED';
  END IF;
  IF private.current_user_is_active_organizer_member('cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_ORGANIZER_MEMBERSHIP_ALLOWED';
  END IF;
  BEGIN
    INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy-insert');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_LEGACY_ISSUER_INSERT_ALLOWED'; END IF;
END;
$legacy_issuer$;

-- Better Auth issuer is also valid and still sees only its own UUID.
SELECT set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
DO $better_auth_issuer$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 1 THEN RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ISSUER_OWNER_READ_FAILED'; END IF;
  IF NOT private.current_user_is_admin() THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_ADMIN_HELPER_DENIED';
  END IF;
  IF NOT public.is_active_admin('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid) THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_IS_ACTIVE_ADMIN_DENIED';
  END IF;
  IF public.admin_set_collective_certificate_price(0) <> 0 THEN
    RAISE EXCEPTION 'STAGE3_BETTER_AUTH_DIRECT_ADMIN_RPC_DENIED';
  END IF;
  INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
  VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'better-auth-insert');
END;
$better_auth_issuer$;

-- A syntactically valid UUID from an untrusted issuer receives no row access
-- and cannot insert even when its sub matches a real owner UUID.
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","iss":"https://attacker.invalid"}',
  true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
DO $untrusted_issuer$
DECLARE
  v_count integer;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_count FROM public.auth_issuer_guard_probe;
  IF v_count <> 0 THEN RAISE EXCEPTION 'STAGE3_UNTRUSTED_ISSUER_READ_ALLOWED'; END IF;
  BEGIN
    INSERT INTO public.auth_issuer_guard_probe(id, owner_id, marker)
    VALUES ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'untrusted-insert');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'STAGE3_UNTRUSTED_ISSUER_INSERT_ALLOWED'; END IF;
END;
$untrusted_issuer$;

RESET ROLE;
ROLLBACK;
