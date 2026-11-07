BEGIN;

SELECT extensions.plan(25);

SELECT extensions.ok(
  ARRAY['student','teacher','organizer_member','admin']::text[] <@
    (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder)
     FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
     JOIN pg_enum e ON e.enumtypid=t.oid
     WHERE n.nspname='public' AND t.typname='app_role'),
  'the business-role enum keeps admin and all existing role values'
);

SELECT extensions.ok(
  NOT has_function_privilege('anon',
    'private.complete_better_auth_phone_verification(uuid,timestamptz,text,text,text,integer)','EXECUTE'),
  'anon cannot execute the trusted phone-verification function'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'private.complete_better_auth_phone_verification(uuid,timestamptz,text,text,text,integer)','EXECUTE'),
  'authenticated cannot execute the trusted phone-verification function'
);
SELECT extensions.ok(
  has_function_privilege('service_role',
    'private.complete_better_auth_phone_verification(uuid,timestamptz,text,text,text,integer)','EXECUTE'),
  'service_role can execute the trusted phone-verification function'
);
SELECT extensions.ok(
  NOT has_function_privilege('anon',
    'public.better_auth_complete_phone_verification(uuid,timestamptz,text,text,text,integer)','EXECUTE'),
  'anon cannot execute the PostgREST phone-verification wrapper'
);
SELECT extensions.ok(
  NOT has_function_privilege('authenticated',
    'public.better_auth_complete_phone_verification(uuid,timestamptz,text,text,text,integer)','EXECUTE'),
  'authenticated cannot execute the PostgREST phone-verification wrapper'
);
SELECT extensions.ok(
  has_function_privilege('service_role',
    'public.better_auth_complete_phone_verification(uuid,timestamptz,text,text,text,integer)','EXECUTE'),
  'service_role can execute the PostgREST phone-verification wrapper'
);

INSERT INTO private.app_users(id,email_verified_at)
VALUES
 ('10101010-1010-4010-8010-101010101010',clock_timestamp()),
 ('20202020-2020-4020-8020-202020202020',clock_timestamp()),
 ('30303030-3030-4030-8030-303030303030',clock_timestamp()),
 ('40404040-4040-4040-8040-404040404040',clock_timestamp()),
 ('50505050-5050-4050-8050-505050505050',NULL),
 ('60606060-6060-4060-8060-606060606060',clock_timestamp()),
 ('70707070-7070-4070-8070-707070707070',clock_timestamp());

INSERT INTO public.profiles(id,full_name,username,account_type)
VALUES
 ('10101010-1010-4010-8010-101010101010','Organizer A','org-a','organizer'),
 ('20202020-2020-4020-8020-202020202020','Organizer B','org-b','organizer'),
 ('30303030-3030-4030-8030-303030303030','Organizer C','org-c','organizer'),
 ('40404040-4040-4040-8040-404040404040','Organizer D','org-d','organizer'),
 ('50505050-5050-4050-8050-505050505050','Unverified Email','org-e','organizer'),
 ('60606060-6060-4060-8060-606060606060','No Role','no-role','student'),
 ('70707070-7070-4070-8070-707070707070','No Phone','no-phone','organizer');

INSERT INTO public.user_roles(user_id,role,is_active)
VALUES
 ('10101010-1010-4010-8010-101010101010','organizer_member',true),
 ('20202020-2020-4020-8020-202020202020','organizer_member',true),
 ('30303030-3030-4030-8030-303030303030','organizer_member',true),
 ('40404040-4040-4040-8040-404040404040','organizer_member',true),
 ('50505050-5050-4050-8050-505050505050','organizer_member',true),
 ('70707070-7070-4070-8070-707070707070','organizer_member',true);

SET LOCAL ROLE service_role;

SELECT extensions.is(
  public.better_auth_complete_phone_verification(
    '10101010-1010-4010-8010-101010101010',
    clock_timestamp(),
    'dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725',
    'telegram','987654321',13
  ),
  true,
  'a trusted Telegram verification projects the phone hash'
);
SELECT extensions.is(
  public.better_auth_complete_phone_verification(
    '10101010-1010-4010-8010-101010101010',
    clock_timestamp(),
    'dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725',
    'telegram','987654321',13
  ),
  false,
  'the same trusted verification event is idempotent'
);
SELECT extensions.throws_ok(
  $$SELECT private.complete_better_auth_phone_verification(
    '20202020-2020-4020-8020-202020202020',clock_timestamp(),
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'telegram','987654321',13)$$,
  '23505','PHONE_PROVIDER_IDENTITY_ALREADY_LINKED',
  'one Telegram identity cannot be linked to two Better Auth users'
);
SELECT extensions.throws_ok(
  $$SELECT private.complete_better_auth_phone_verification(
    '30303030-3030-4030-8030-303030303030',clock_timestamp(),
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'telegram','333333333',7)$$,
  '22023','PHONE_VERIFICATION_INPUT_INVALID',
  'phone number claims shorter than eight digits are rejected'
);
SELECT extensions.throws_ok(
  $$SELECT private.complete_better_auth_phone_verification(
    '30303030-3030-4030-8030-303030303030',clock_timestamp(),
    'not-a-sha256-hash','telegram','333333333',13)$$,
  '22023','PHONE_VERIFICATION_INPUT_INVALID',
  'untrusted or malformed phone hashes are rejected'
);
SELECT extensions.is(
  (SELECT verified_phone_identity_hash FROM private.app_users
   WHERE id='10101010-1010-4010-8010-101010101010'),
  'dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725',
  'only the digits-only SHA-256 hash is persisted, not the raw phone'
);
SELECT extensions.is(
  (SELECT phone_verification_provider || ':' || phone_verification_subject
   FROM private.app_users WHERE id='10101010-1010-4010-8010-101010101010'),
  'telegram:987654321',
  'the verified external provider subject is bound to the app identity'
);

SELECT extensions.lives_ok(
  $$SELECT public.better_auth_complete_phone_verification(
    '20202020-2020-4020-8020-202020202020',clock_timestamp(),
    'dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725',
    'telegram','222222222',13)$$,
  'a separate Telegram subject can prove possession of the same phone number'
);
SELECT extensions.lives_ok(
  $$SELECT public.better_auth_complete_phone_verification(
    '30303030-3030-4030-8030-303030303030',clock_timestamp(),
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'telegram','333333333',13)$$,
  'a separate account can receive a separate trusted phone identity'
);
SELECT extensions.lives_ok(
  $$SELECT public.better_auth_complete_phone_verification(
    '50505050-5050-4050-8050-505050505050',clock_timestamp(),
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'telegram','555555555',13)$$,
  'phone verification can complete independently of email verification'
);

SELECT extensions.is(
  (SELECT count(*)::integer FROM public.organizers),
  0,
  'verification alone does not create an organizer workspace'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"70707070-7070-4070-8070-707070707070","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','70707070-7070-4070-8070-707070707070',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.create_organizer('No Phone','no-phone')$$,
  'P0001','PHONE_VERIFICATION_REQUIRED',
  'organizer creation remains blocked until a trusted phone claim exists'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"50505050-5050-4050-8050-505050505050","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','50505050-5050-4050-8050-505050505050',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.create_organizer('No Email','no-email')$$,
  'P0001','EMAIL_VERIFICATION_REQUIRED',
  'organizer creation still requires verified email'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"60606060-6060-4060-8060-606060606060","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','60606060-6060-4060-8060-606060606060',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.create_organizer('No Role','no-role')$$,
  'P0001','ORGANIZER_ROLE_REQUIRED',
  'organizer creation still requires an active organizer_member role'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"10101010-1010-4010-8010-101010101010","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','10101010-1010-4010-8010-101010101010',true);
SELECT extensions.lives_ok(
  $$SELECT * FROM public.create_organizer('Organizer Alpha','organizer-alpha')$$,
  'verified organizer can create the first workspace'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM private.organizer_free_identity_claims
   WHERE identity_hash='dd752605096029a73495a91862983963e1947a834a4300808074185af10bb725'),
  1,
  'one free organizer identity claim is created for the verified phone hash'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.create_organizer('Organizer Alpha Again','organizer-alpha-again')$$,
  'P0001','ORGANIZER_LIMIT_REACHED',
  'one account cannot create a second organizer workspace'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"20202020-2020-4020-8020-202020202020","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','20202020-2020-4020-8020-202020202020',true);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.create_organizer('Organizer Beta','organizer-beta')$$,
  'P0001','FREE_ORGANIZER_ALREADY_CLAIMED',
  'a verified phone cannot claim a second free organizer workspace'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT extensions.throws_ok(
  $$SELECT private.complete_better_auth_phone_verification(
    '40404040-4040-4040-8040-404040404040',clock_timestamp(),
    'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'telegram','444444444',13)$$,
  '42501',NULL,
  'signed-in clients cannot forge trusted phone verification'
);

RESET ROLE;
SELECT * FROM extensions.finish(true);
ROLLBACK;
