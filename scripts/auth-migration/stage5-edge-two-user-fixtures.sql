-- Synthetic business fixtures for local Edge Function authorization tests only.
-- Auth users are created by the local Auth signup API first; their UUIDs are
-- passed in as psql variables. This avoids hand-writing GoTrue identity rows.
-- Run only against the full-schema disposable database.

BEGIN;

INSERT INTO public.profiles (id, username, full_name, account_type, status)
VALUES
  (:'user_a'::uuid, 'stage5_user_a', 'Stage 5 User A', 'student', 'ACTIVE'),
  (:'user_b'::uuid, 'stage5_user_b', 'Stage 5 User B', 'student', 'ACTIVE')
ON CONFLICT (id) DO UPDATE
SET username = EXCLUDED.username,
    full_name = EXCLUDED.full_name,
    account_type = EXCLUDED.account_type,
    status = EXCLUDED.status;

INSERT INTO public.user_roles (user_id, role, is_active)
VALUES (:'user_b'::uuid, 'admin'::public.app_role, true)
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
    :'user_a'::uuid,
    'PENDING_PAYMENT',
    1000, 0, 0, 1000, 'IDR',
    'SNAP', 'MIDTRANS', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    :'user_b'::uuid,
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
