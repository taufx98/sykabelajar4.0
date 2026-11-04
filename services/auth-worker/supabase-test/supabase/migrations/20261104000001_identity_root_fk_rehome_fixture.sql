-- Synthetic fixture for testing a safe auth identity-root FK rehome.
-- This deliberately uses private.legacy_auth_users instead of auth.users.
-- No production schema or user records are referenced.

create table private.legacy_auth_users (
  id uuid primary key,
  email_verified_at timestamptz,
  phone text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table private.app_users (
  id uuid primary key,
  email_verified_at timestamptz,
  phone text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now()
);

insert into private.legacy_auth_users (id, email_verified_at, phone, phone_verified_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', now(), null, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now(), null, null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', now(), null, null),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', now(), null, null);

create table public.auth_rehome_cascade_fixture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  marker text not null
);
alter table public.auth_rehome_cascade_fixture
  add constraint auth_rehome_cascade_fixture_user_id_fkey
  foreign key (user_id) references private.legacy_auth_users(id) on delete cascade;

create table public.auth_rehome_set_null_fixture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  marker text not null
);
alter table public.auth_rehome_set_null_fixture
  add constraint auth_rehome_set_null_fixture_user_id_fkey
  foreign key (user_id) references private.legacy_auth_users(id) on delete set null;

create table public.auth_rehome_no_action_fixture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  marker text not null
);
alter table public.auth_rehome_no_action_fixture
  add constraint auth_rehome_no_action_fixture_user_id_fkey
  foreign key (user_id) references private.legacy_auth_users(id) on delete no action;

create table public.auth_rehome_restrict_fixture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  marker text not null
);
alter table public.auth_rehome_restrict_fixture
  add constraint auth_rehome_restrict_fixture_user_id_fkey
  foreign key (user_id) references private.legacy_auth_users(id) on delete restrict;

insert into public.auth_rehome_cascade_fixture (user_id, marker)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cascade-child');

insert into public.auth_rehome_set_null_fixture (user_id, marker)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'set-null-audit');

insert into public.auth_rehome_no_action_fixture (user_id, marker)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'no-action-child');

insert into public.auth_rehome_restrict_fixture (user_id, marker)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'restrict-child');
