begin;
select plan(9);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.user_roles'::regclass),
  'user_roles has row-level security enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.user_roles', 'select'),
  'authenticated may select its caller-scoped role projection'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'insert'),
  'authenticated cannot insert application roles'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'update'),
  'authenticated cannot update application roles'
);
select ok(
  not has_table_privilege('authenticated', 'public.user_roles', 'delete'),
  'authenticated cannot delete application roles'
);
select ok(
  has_type_privilege('authenticated', 'public.app_role', 'usage'),
  'authenticated may decode the role enum in its own read result'
);

insert into private.app_users (id)
values
  ('91919191-9191-4191-8191-919191919191'),
  ('92929292-9292-4292-8292-929292929292');
insert into public.user_roles (user_id, role, is_active)
values
  ('91919191-9191-4191-8191-919191919191', 'admin', true),
  ('92929292-9292-4292-8292-929292929292', 'student', true);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"91919191-9191-4191-8191-919191919191","role":"authenticated","iss":"https://auth.sykabelajar.my.id/api/auth"}',
  true
);

select is(
  (select count(*)::integer from public.user_roles),
  1,
  'Better Auth user sees exactly one user_roles row'
);
select is(
  (select role::text from public.user_roles limit 1),
  'admin',
  'Better Auth user sees its own trusted admin role'
);

reset role;
select * from finish();
rollback;
