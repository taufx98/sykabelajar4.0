begin;

select extensions.plan(7);

insert into private.auth_identity_rls_fixture (user_id, marker)
values
  ('11111111-1111-4111-8111-111111111111', 'user-a-existing'),
  ('22222222-2222-4222-8222-222222222222', 'user-b-existing');

set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","iss":"https://auth.example.test"}',
  true
);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  auth.uid(),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'auth.uid() resolves the JWT sub UUID'
);

select extensions.is(
  (select count(*)::integer from private.auth_identity_rls_fixture),
  1,
  'user A sees only the row owned by user A'
);

select extensions.is(
  (select count(*)::integer from private.auth_identity_rls_fixture where marker = 'user-b-existing'),
  0,
  'user A cannot read user B data'
);

select extensions.lives_ok(
  $$insert into private.auth_identity_rls_fixture (user_id, marker)
    values ('11111111-1111-4111-8111-111111111111', 'user-a-new')$$,
  'user A can insert a row owned by user A'
);

select extensions.throws_ok(
  $$insert into private.auth_identity_rls_fixture (user_id, marker)
    values ('22222222-2222-4222-8222-222222222222', 'user-a-forged-owner')$$,
  '42501',
  null,
  'user A cannot insert a row owned by user B'
);

select extensions.throws_ok(
  $$update private.auth_identity_rls_fixture
    set user_id = '22222222-2222-4222-8222-222222222222'
    where marker = 'user-a-existing'$$,
  '42501',
  null,
  'user A cannot transfer ownership of their row to user B'
);

select extensions.is(
  (select count(*)::integer from private.auth_identity_rls_fixture),
  2,
  'only user A owned rows are visible after the permitted insert'
);

reset role;

select * from extensions.finish();

rollback;
