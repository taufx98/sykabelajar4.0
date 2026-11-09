BEGIN;
SELECT extensions.plan(10);

SELECT extensions.ok(
  current_user = 'postgres',
  'local test executes under the trusted database owner'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.user_roles
   WHERE role = 'admin'::public.app_role),
  0,
  'fixture starts with no admin role rows'
);

SELECT extensions.lives_ok(
  $bootstrap$
    DO $first_admin$
    DECLARE
      v_user_id uuid := '81818181-8181-4181-8181-818181818181';
    BEGIN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('sykabelajar-auth-staging-first-admin', 0)
      );
      IF EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE role = 'admin'::public.app_role
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
          MESSAGE = 'STAGING_FIRST_ADMIN_ALREADY_BOOTSTRAPPED';
      END IF;
      PERFORM public.better_auth_provision_user(
        v_user_id, 'student', 'Staging First Admin',
        'staging-first-admin', NULL, TRUE,
        NULL, NULL, NULL, NULL
      );
      INSERT INTO public.user_roles (user_id, role, is_active)
      VALUES (v_user_id, 'admin'::public.app_role, TRUE);
    END
    $first_admin$;
  $bootstrap$,
  'trusted database owner can provision exactly the first admin from a pre-verified Better Auth UUID'
);

SELECT extensions.is(
  (SELECT identity_origin FROM private.app_users
   WHERE id = '81818181-8181-4181-8181-818181818181'),
  'better_auth',
  'bootstrap identity root is marked Better Auth, not a legacy tombstone'
);
SELECT extensions.ok(
  (SELECT email_verified_at IS NOT NULL FROM private.app_users
   WHERE id = '81818181-8181-4181-8181-818181818181'),
  'only an owner-operated verified-session bootstrap sets trusted email state'
);
SELECT extensions.is(
  (SELECT account_type FROM public.profiles
   WHERE id = '81818181-8181-4181-8181-818181818181'),
  'student',
  'the initial application account type remains non-privileged'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.user_roles
   WHERE user_id = '81818181-8181-4181-8181-818181818181'
     AND role = 'admin'::public.app_role AND is_active),
  1,
  'the owner bootstrap grants exactly one active admin role'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.user_roles
   WHERE user_id = '81818181-8181-4181-8181-818181818181'),
  2,
  'the account retains its basic student role alongside admin'
);

SELECT extensions.throws_ok(
  $second$
    DO $second_admin$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE role = 'admin'::public.app_role
      ) THEN
        RAISE EXCEPTION USING ERRCODE = '55000',
          MESSAGE = 'STAGING_FIRST_ADMIN_ALREADY_BOOTSTRAPPED';
      END IF;
    END
    $second_admin$;
  $second$,
  '55000',
  'STAGING_FIRST_ADMIN_ALREADY_BOOTSTRAPPED',
  'a second first-admin bootstrap attempt is rejected'
);

SELECT extensions.ok(
  NOT has_table_privilege('authenticated', 'public.user_roles', 'insert'),
  'authenticated callers cannot self-assign admin via direct role insert'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM auth.users
   WHERE id = '81818181-8181-4181-8181-818181818181'),
  0,
  'Better Auth staging bootstrap does not create a shadow Supabase Auth account'
);

SELECT * FROM extensions.finish();
ROLLBACK;
