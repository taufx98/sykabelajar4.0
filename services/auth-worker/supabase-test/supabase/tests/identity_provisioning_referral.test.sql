begin;

select extensions.plan(49);

select extensions.ok(
  not has_function_privilege('anon',
    'private.provision_better_auth_user(uuid,text,text,text,text)', 'EXECUTE'),
  'anonymous cannot execute the trusted provisioning function'
);
select extensions.ok(
  not has_function_privilege('authenticated',
    'private.provision_better_auth_user(uuid,text,text,text,text)', 'EXECUTE'),
  'authenticated users cannot execute the trusted provisioning function'
);
select extensions.ok(
  has_function_privilege('service_role',
    'private.provision_better_auth_user(uuid,text,text,text,text)', 'EXECUTE'),
  'service_role can execute the trusted provisioning function'
);
select extensions.ok(
  not has_function_privilege('anon',
    'private.complete_better_auth_email_verification(uuid,timestamptz)', 'EXECUTE'),
  'anonymous cannot mark an email as verified'
);
select extensions.ok(
  not has_function_privilege('authenticated',
    'private.complete_better_auth_email_verification(uuid,timestamptz)', 'EXECUTE'),
  'authenticated users cannot mark an email as verified'
);
select extensions.ok(
  has_function_privilege('service_role',
    'private.complete_better_auth_email_verification(uuid,timestamptz)', 'EXECUTE'),
  'service_role can process trusted email verification events'
);

insert into private.app_users (id, email_verified_at)
values ('99999999-9999-4999-8999-999999999999', clock_timestamp()),
       ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', null);
insert into public.profiles (id, full_name, username, account_type, edu_coin)
values ('99999999-9999-4999-8999-999999999999', 'Referrer', 'referrer', 'student', 10),
       ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Unverified', 'unverified', 'student', 0);
insert into public.referral_codes (user_id, code)
values ('99999999-9999-4999-8999-999999999999', 'REF-VALID'),
       ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'REF-UNVERIFIED');

set local role service_role;

select extensions.lives_ok(
  $$select private.provision_better_auth_user(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organizer',
    'Organizer One', 'organizer-one', null)$$,
  'organizer signup creates identity and application records'
);
select extensions.is(
  (select full_name from public.profiles
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'Organizer One', 'initial profile is provisioned'
);
select extensions.is(
  (select account_type from public.profiles
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'organizer', 'organizer account type is stored in the profile'
);
select extensions.is(
  (select role::text from public.user_roles
   where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'organizer_member', 'organizer account maps only to organizer_member business role'
);
select extensions.is(
  (select count(*)::integer from public.user_roles
   where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and role = 'admin'),
  0, 'self-registration never assigns admin'
);
select extensions.is(
  (select count(*)::integer from public.user_settings
   where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'default settings are provisioned exactly once'
);

update public.profiles set full_name = 'Edited Name'
where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.user_roles set is_active = false
where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  and role = 'organizer_member';
select extensions.lives_ok(
  $$select private.provision_better_auth_user(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'organizer',
    'Attempted Rewrite', 'organizer-one', null)$$,
  'repeating provisioning for the same UUID is safe'
);
select extensions.is(
  (select full_name from public.profiles
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'Edited Name', 'provisioning retry does not overwrite an existing profile'
);
select extensions.is(
  (select is_active from public.user_roles
   where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and role = 'organizer_member'),
  false, 'provisioning retry does not reactivate a role disabled by an administrator'
);
select extensions.is(
  (select email_verified_at is null from private.app_users
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  true, 'registration does not mark email as verified'
);
select extensions.is(
  (select phone_verified_at is null and verified_phone_identity_hash is null
   from private.app_users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  true, 'registration cannot assert phone verification or a verified-phone hash'
);
-- Inspect auth.users as the database owner; service_role intentionally has no read grant.
reset role;
select extensions.is(
  (select count(*)::integer from auth.users
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0, 'Better Auth provisioning does not create a shadow auth.users row'
);
set local role service_role;
select extensions.is(
  (select count(*)::integer from information_schema.columns
   where table_schema = 'private' and table_name = 'app_users'
     and column_name in ('password_hash', 'encrypted_password', 'session_token', 'oauth_access_token')),
  0, 'application identity projection stores no credentials or session tokens'
);

select extensions.throws_ok(
  $$select private.provision_better_auth_user(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin',
    'Attacker', 'attacker-admin', null)$$,
  '22023', 'UNSUPPORTED_ACCOUNT_TYPE',
  'admin account type is rejected at the database boundary'
);
select extensions.is(
  (select count(*)::integer from private.app_users
   where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0, 'rejected privileged registration leaves no identity row'
);

select extensions.throws_ok(
  $$select private.provision_better_auth_user(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'student',
    'Username Collision', 'organizer-one', null)$$,
  '23505', null,
  'username uniqueness failure aborts the whole provisioning transaction'
);
select extensions.is(
  (select count(*)::integer from private.app_users
   where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0, 'failed profile insert rolls back the new identity root'
);
select extensions.is(
  (select count(*)::integer from public.user_settings
   where user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  0, 'failed provisioning does not leave partial settings'
);

select extensions.lives_ok(
  $$select private.provision_better_auth_user(
    '33333333-3333-4333-8333-333333333333', 'teacher',
    'Teacher One', 'teacher-one', 'REF-VALID')$$,
  'teacher signup provisions successfully with a valid referral code'
);
select extensions.is(
  (select account_type from public.profiles
   where id = '33333333-3333-4333-8333-333333333333'),
  'teacher', 'teacher account type is preserved'
);
select extensions.is(
  (select role::text from public.user_roles
   where user_id = '33333333-3333-4333-8333-333333333333'),
  'teacher', 'teacher account maps to the teacher business role'
);
select extensions.is(
  (select count(*)::integer from public.referral_events
   where referrer_user_id = '99999999-9999-4999-8999-999999999999'
     and referred_user_id = '33333333-3333-4333-8333-333333333333'
     and status = 'PENDING' and reward_amount = 5),
  1, 'valid referral code resolves to a verified referrer and creates one pending event'
);

select extensions.lives_ok(
  $$insert into public.daily_checkins (user_id, created_at)
    values ('33333333-3333-4333-8333-333333333333', clock_timestamp())$$,
  'a qualifying daily check-in can be recorded before email verification'
);
select extensions.is(
  (select status || ':' || coalesce(verified_activity, '')
   from public.referral_events
   where referred_user_id = '33333333-3333-4333-8333-333333333333'),
  'PENDING:daily_checkin',
  'unverified email records the eligible activity but keeps referral pending'
);
select extensions.is(
  (select count(*)::integer from public.edu_coin_ledger
   where user_id = '99999999-9999-4999-8999-999999999999'),
  0, 'referrer receives no reward before referred email verification'
);

select extensions.is(
  private.complete_better_auth_email_verification(
    '33333333-3333-4333-8333-333333333333', clock_timestamp()),
  true, 'trusted email verification event is accepted once'
);
select extensions.ok(
  (select email_verified_at is not null from private.app_users
   where id = '33333333-3333-4333-8333-333333333333'),
  'verified timestamp is recorded in the identity root'
);
select extensions.is(
  (select status from public.referral_events
   where referred_user_id = '33333333-3333-4333-8333-333333333333'),
  'VERIFIED', 'email verification completes the eligible referral'
);
select extensions.is(
  (select count(*)::integer from public.edu_coin_ledger
   where user_id = '99999999-9999-4999-8999-999999999999'
     and event_type = 'REFERRAL_REGISTRATION'),
  1, 'referral qualification creates exactly one Edu Coin ledger row'
);
select extensions.is(
  (select amount::integer from public.edu_coin_ledger
   where user_id = '99999999-9999-4999-8999-999999999999'
     and event_type = 'REFERRAL_REGISTRATION'),
  5, 'ledger records the reward amount captured at referral creation'
);
select extensions.is(
  (select edu_coin from public.profiles
   where id = '99999999-9999-4999-8999-999999999999'),
  15::bigint, 'referrer profile is credited once after email verification'
);
select extensions.is(
  private.complete_better_auth_email_verification(
    '33333333-3333-4333-8333-333333333333', clock_timestamp()),
  false, 'replayed email verification event is idempotent'
);
select extensions.is(
  (select count(*)::integer from public.edu_coin_ledger
   where user_id = '99999999-9999-4999-8999-999999999999'
     and event_type = 'REFERRAL_REGISTRATION'),
  1, 'replayed verification does not create a second ledger entry'
);
select extensions.is(
  (select edu_coin from public.profiles
   where id = '99999999-9999-4999-8999-999999999999'),
  15::bigint, 'replayed verification does not double-credit Edu Coin'
);

select extensions.lives_ok(
  $$select private.provision_better_auth_user(
    '55555555-5555-4555-8555-555555555555', 'student',
    'No Referral', 'no-referral', 'UNKNOWN-CODE')$$,
  'unknown referral code does not block account provisioning'
);
select extensions.is(
  (select count(*)::integer from public.referral_events
   where referred_user_id = '55555555-5555-4555-8555-555555555555'),
  0, 'unknown referral code creates no attribution'
);
select extensions.lives_ok(
  $$select private.provision_better_auth_user(
    '66666666-6666-4666-8666-666666666666', 'student',
    'Unverified Referrer Case', 'unverified-referral-case', 'REF-UNVERIFIED')$$,
  'a referral code owned by an unverified account does not block signup'
);
select extensions.is(
  (select count(*)::integer from public.referral_events
   where referred_user_id = '66666666-6666-4666-8666-666666666666'),
  0, 'unverified referrer cannot create a pending attribution'
);

insert into private.app_users (id, email_verified_at)
values ('77777777-7777-4777-8777-777777777777', clock_timestamp());
insert into public.profiles (id, full_name, username, account_type)
values ('77777777-7777-4777-8777-777777777777', 'Expired Case', 'expired-case', 'student');
insert into public.referral_events
  (referrer_user_id, referred_user_id, reward_amount, status, created_at)
values
  ('99999999-9999-4999-8999-999999999999',
   '77777777-7777-4777-8777-777777777777', 5, 'PENDING',
   clock_timestamp() - interval '26 hours');
select extensions.lives_ok(
  $$insert into public.daily_checkins (user_id, created_at)
    values ('77777777-7777-4777-8777-777777777777',
      clock_timestamp() - interval '25 hours')$$,
  'expired referral activity can be observed without awarding a reward'
);
select extensions.is(
  (select status from public.referral_events
   where referred_user_id = '77777777-7777-4777-8777-777777777777'),
  'PENDING', 'activity after the 24-hour qualification window does not verify referral'
);
select extensions.is(
  (select count(*)::integer from public.edu_coin_ledger
   where user_id = '99999999-9999-4999-8999-999999999999'
     and event_id in (select id::text from public.referral_events
                      where referred_user_id = '77777777-7777-4777-8777-777777777777')),
  0, 'expired referral creates no Edu Coin ledger entry'
);

reset role;
set local role authenticated;
select extensions.throws_ok(
  $$select private.provision_better_auth_user(
    '88888888-8888-4888-8888-888888888888', 'student',
    'Client Caller', 'client-caller', null)$$,
  '42501', null, 'signed-in clients cannot provision identities directly'
);
select extensions.throws_ok(
  $$select private.complete_better_auth_email_verification(
    '33333333-3333-4333-8333-333333333333', clock_timestamp())$$,
  '42501', null, 'signed-in clients cannot forge email verification events'
);

reset role;
select * from extensions.finish();
rollback;
