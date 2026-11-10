BEGIN;

SELECT extensions.plan(16);

INSERT INTO private.app_users (id, identity_origin)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'better_auth'),
  ('22222222-2222-4222-8222-222222222222', 'better_auth')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, username, account_type)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'User A', 'profile-owner-a', 'student'),
  ('22222222-2222-4222-8222-222222222222', 'User B', 'profile-owner-b', 'student')
ON CONFLICT (id) DO NOTHING;

SET LOCAL ROLE authenticated;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.profiles),
  1,
  'Better Auth user A can read exactly their own profile'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.profiles WHERE id = '22222222-2222-4222-8222-222222222222'),
  0,
  'Better Auth user A cannot read user B profile'
);

SELECT extensions.is(
  has_table_privilege('authenticated', 'public.profiles', 'SELECT'),
  true,
  'authenticated role has the minimum profile SELECT grant'
);

SELECT extensions.is(
  has_table_privilege('authenticated', 'public.profiles', 'INSERT'),
  false,
  'authenticated role cannot insert profiles directly'
);

SELECT extensions.is(
  has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  false,
  'authenticated role cannot update profiles directly'
);

SELECT extensions.is(
  has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  false,
  'authenticated role cannot delete profiles directly'
);

SELECT extensions.is(
  has_table_privilege('anon', 'public.profiles', 'SELECT'),
  false,
  'anonymous role cannot read application profiles'
);

SELECT extensions.is(
  has_table_privilege('service_role', 'public.profiles', 'SELECT'),
  true,
  'server-side provisioning role retains profile SELECT'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://attacker.example"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.profiles),
  0,
  'a token with the wrong issuer cannot read its own profile'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.profiles WHERE id = auth.uid()),
  1,
  'restoring the exact Better Auth issuer restores owner-only profile read'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'bio' AND data_type = 'text'
  ),
  'profile hydration bio column matches the runtime contract'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'avatar_url' AND data_type = 'text'
  ),
  'profile hydration avatar_url column matches the runtime contract'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'cover_url' AND data_type = 'text'
  ),
  'profile hydration cover_url column matches the runtime contract'
);

SELECT extensions.ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name = 'badge_showcase' AND data_type = 'jsonb'
  ),
  'profile hydration badge showcase column matches the runtime contract'
);

RESET ROLE;

SELECT * FROM extensions.finish();

ROLLBACK;
