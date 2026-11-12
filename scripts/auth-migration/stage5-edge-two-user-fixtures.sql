-- Synthetic two-user fixtures for local Edge Function authorization tests only.
-- This SQL is executed only after a schema-only Production export is restored
-- into local Supabase. It never runs against Production and uses no live rows.

BEGIN;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, phone, phone_confirmed_at,
  is_sso_user, is_anonymous
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'authenticated',
    'authenticated',
    'stage5-edge-user-a@example.test',
    extensions.crypt('Stage5-Edge-Local-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Stage 5 User A","username":"stage5_user_a"}'::jsonb,
    false, now(), now(), NULL, NULL, false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'authenticated',
    'authenticated',
    'stage5-edge-user-b@example.test',
    extensions.crypt('Stage5-Edge-Local-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Stage 5 User B","username":"stage5_user_b"}'::jsonb,
    false, now(), now(), NULL, NULL, false, false
  );

-- GoTrue expects a matching email identity for password sign-in. The email
-- column in auth.identities is generated and deliberately not inserted.
INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","email":"stage5-edge-user-a@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email', now(), now(), now()
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","email":"stage5-edge-user-b@example.test","email_verified":true,"phone_verified":false}'::jsonb,
    'email', now(), now(), now()
  );

-- The Auth insert trigger normally creates profiles. Reconcile these exact
-- disposable users so their namespaces are deterministic.
INSERT INTO public.profiles (id, username, full_name, account_type, status)
VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'stage5_user_a', 'Stage 5 User A', 'student', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'stage5_user_b', 'Stage 5 User B', 'student', 'ACTIVE')
ON CONFLICT (id) DO UPDATE
SET username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    account_type = EXCLUDED.account_type,
    status = EXCLUDED.status;

INSERT INTO public.user_roles (user_id, role, is_active)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'::public.app_role, true)
ON CONFLICT (user_id, role) DO UPDATE
SET is_active = true;

INSERT INTO public.organizer_payment_methods (id, name, payment_type, details, is_active)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Stage 5 Local Global Gateway',
  'SNAP',
  '{"global_gateway":true}'::jsonb,
  true
);

INSERT INTO public.payment_gateway_state (id, active_provider, automatic_payments_enabled)
VALUES (true, 'MANUAL', false)
ON CONFLICT (id) DO UPDATE
SET active_provider = EXCLUDED.active_provider,
    automatic_payments_enabled = EXCLUDED.automatic_payments_enabled,
    updated_at = now();

INSERT INTO public.orders (
  id, user_id, status, subtotal, discount, shipping_cost, total, currency,
  payment_method, payment_provider, payment_method_id
)
VALUES
  (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'PENDING_PAYMENT',
    1000, 0, 0, 1000, 'IDR',
    'SNAP', 'MIDTRANS', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'PENDING_PAYMENT',
    1000, 0, 0, 1000, 'IDR',
    'SNAP', 'MIDTRANS', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  );

INSERT INTO public.payment_intents (
  id, order_id, provider, provider_reference, amount, status, raw_meta
)
VALUES (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'MIDTRANS',
  'stage5-local-fixture-reference',
  1000,
  'PENDING',
  '{"environment":"sandbox"}'::jsonb
);

COMMIT;
