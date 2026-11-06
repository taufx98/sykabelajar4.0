begin;

select extensions.plan(13);

insert into public.auth_oidc_acceptance_rows (id, owner_id, marker)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'user-a-existing'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'user-b-existing');

set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  auth.uid(),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'Better Auth UUID sub maps to auth.uid()'
);

select extensions.is(
  auth.jwt() ->> 'role',
  'authenticated',
  'Postgres role claim is authenticated, not a business role'
);

select extensions.is(
  auth.jwt() ->> 'iss',
  'https://auth.sykabelajar.my.id/api/auth',
  'Better Auth issuer claim is available to restrictive RLS'
);

select extensions.is(
  (select count(*)::integer from public.auth_oidc_acceptance_rows),
  1,
  'user A sees only their own row'
);

select extensions.is(
  (select count(*)::integer from public.auth_oidc_acceptance_rows where marker = 'user-b-existing'),
  0,
  'user A cannot read user B data'
);

select extensions.lives_ok(
  $$insert into public.auth_oidc_acceptance_rows (owner_id, marker)
    values ('11111111-1111-4111-8111-111111111111', 'user-a-new')$$,
  'user A can insert a row owned by user A'
);

select extensions.throws_ok(
  $$insert into public.auth_oidc_acceptance_rows (owner_id, marker)
    values ('22222222-2222-4222-8222-222222222222', 'user-a-forged-owner')$$,
  '42501',
  null,
  'user A cannot insert a row owned by user B'
);

select extensions.throws_ok(
  $$update public.auth_oidc_acceptance_rows
    set owner_id = '22222222-2222-4222-8222-222222222222'
    where marker = 'user-a-existing'$$,
  '42501',
  null,
  'user A cannot transfer row ownership to user B'
);

select extensions.is(
  (select count(*)::integer from public.auth_oidc_acceptance_rows),
  2,
  'only user A rows are visible after the permitted insert'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  auth.uid(),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'Better Auth UUID sub switches to user B'
);

select extensions.is(
  (select count(*)::integer from public.auth_oidc_acceptance_rows),
  1,
  'user B sees only their own row'
);

select extensions.is(
  (select count(*)::integer from public.auth_oidc_acceptance_rows where marker = 'user-a-existing'),
  0,
  'user B cannot read user A data'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://attacker.invalid"}',
  true
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  (select count(*)::integer from public.auth_oidc_acceptance_rows),
  0,
  'a valid UUID from an untrusted issuer receives no row access'
);

reset role;

select * from extensions.finish();

rollback;
