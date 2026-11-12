begin;
select plan(16);

-- Four disposable Better Auth identities cover every preserved application
-- role. These rows exist only inside the isolated local Supabase test database.
insert into private.app_users (id)
values
  ('81818181-8181-4181-8181-818181818181'),
  ('82828282-8282-4282-8282-828282828282'),
  ('83838383-8383-4383-8383-838383838383'),
  ('84848484-8484-4484-8484-848484848484');

insert into public.user_roles (user_id, role, is_active)
values
  ('81818181-8181-4181-8181-818181818181', 'student', true),
  ('82828282-8282-4282-8282-828282828282', 'teacher', true),
  ('83838383-8383-4383-8383-838383838383', 'organizer_member', true),
  ('84848484-8484-4484-8484-848484848484', 'admin', true);

set local role authenticated;

-- Student: the JWT keeps the Postgres role while RLS exposes only the
-- separately stored business role belonging to the verified subject.
select set_config(
  'request.jwt.claims',
  '{"sub":"81818181-8181-4181-8181-818181818181","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
select is((select count(*)::integer from public.user_roles), 1,
  'student sees exactly one own role row');
select is((select role::text from public.user_roles limit 1), 'student',
  'student business role remains student');
select is((select auth.jwt() ->> 'role'), 'authenticated',
  'student JWT role remains the Postgres authenticated role');
select is((select count(*)::integer from public.user_roles
  where user_id <> '81818181-8181-4181-8181-818181818181'), 0,
  'student cannot read another business role');

-- Teacher.
select set_config(
  'request.jwt.claims',
  '{"sub":"82828282-8282-4282-8282-828282828282","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
select is((select count(*)::integer from public.user_roles), 1,
  'teacher sees exactly one own role row');
select is((select role::text from public.user_roles limit 1), 'teacher',
  'teacher business role remains teacher');
select is((select auth.jwt() ->> 'role'), 'authenticated',
  'teacher JWT role remains the Postgres authenticated role');
select is((select count(*)::integer from public.user_roles
  where user_id <> '82828282-8282-4282-8282-828282828282'), 0,
  'teacher cannot read another business role');

-- Organizer account: the existing enum name remains organizer_member.
select set_config(
  'request.jwt.claims',
  '{"sub":"83838383-8383-4383-8383-838383838383","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
select is((select count(*)::integer from public.user_roles), 1,
  'organizer member sees exactly one own role row');
select is((select role::text from public.user_roles limit 1), 'organizer_member',
  'organizer business role remains organizer_member');
select is((select auth.jwt() ->> 'role'), 'authenticated',
  'organizer JWT role remains the Postgres authenticated role');
select is((select count(*)::integer from public.user_roles
  where user_id <> '83838383-8383-4383-8383-838383838383'), 0,
  'organizer member cannot read another business role');

-- Admin is a protected grant, not a JWT role and not a public-signup value.
select set_config(
  'request.jwt.claims',
  '{"sub":"84848484-8484-4484-8484-848484848484","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);
select is((select count(*)::integer from public.user_roles), 1,
  'admin sees exactly one own role row');
select is((select role::text from public.user_roles limit 1), 'admin',
  'admin business role remains admin');
select is((select auth.jwt() ->> 'role'), 'authenticated',
  'admin JWT role remains the Postgres authenticated role');
select is((select count(*)::integer from public.user_roles
  where user_id <> '84848484-8484-4484-8484-848484848484'), 0,
  'admin cannot read another business role');

reset role;
select * from extensions.finish();
rollback;
