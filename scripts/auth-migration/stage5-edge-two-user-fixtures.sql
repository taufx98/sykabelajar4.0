-- Synthetic two-user fixtures for local Edge Function authorization tests only.
-- Run after the Stage 3 full rollback draft on the schema-only disposable DB.
-- These credentials and UUIDs are test-only; no production user data is imported.

BEGIN;

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  is_super_admin, created_at, updated_at, phone, phone_confirmed_at,
  confirmed_at, is_sso_user, is_anonymous
)
VALUES
  (
    NULL,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'authenticated',
    'authenticated',
    'stage5-edge-user-a@example.test',
    extensions.crypt('Stage5-Edge-Local-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Stage 5 User A","username":"stage5_user_a"}'::jsonb,
    false, now(), now(), NULL, NULL, now(), false, false
  ),
  (
    NULL,
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'authenticated',
    'authenticated',
    'stage5-edge-user-b@example.test',
    extensions.crypt('Stage5-Edge-Local-Only-2026!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Stage 5 User B","username":"stage5_user_b"}'::jsonb,
    false, now(), now(), NULL, NULL, now(), false, false
  );

-- The Auth insert trigger normally creates the profile. Reconcile only these
-- two synthetic profile fixtures so their test namespaces are deterministic.
UPDATE public.profiles
SET username = 'stage5_user_a',
    full_name = 'Stage 5 User A',
    account_type = 'student',
    status = 'ACTIVE'
WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

UPDATE public.profiles
SET username = 'stage5_user_b',
    full_name = 'Stage 5 User B',
    account_type = 'student',
    status = 'ACTIVE'
WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

INSERT INTO public.user_roles (user_id, role, is_active)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'admin'::public.app_role, true);

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
