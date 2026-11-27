-- Rollback-only acceptance for post-Stage-3 user RPC issuer boundaries.
-- Runs only after the guard draft has been applied to the disposable local restore.
BEGIN;
SET LOCAL statement_timeout = '120s';

DO $stage7_post_stage3_user_rpc_runtime$
DECLARE
  v_call text;
  v_error text;
  v_better_auth_calls text[] := ARRAY[
    'SELECT public.create_ad_banner_payment_order(''77777777-7777-4777-8777-777777777801''::uuid,''77777777-7777-4777-8777-777777777802''::uuid,NULL,NULL,NULL,NULL,NULL,NULL,0)',
    'SELECT public.create_collective_registration_order(''77777777-7777-4777-8777-777777777803''::uuid,ARRAY[]::uuid[],NULL,''NONE'',NULL,NULL,NULL,NULL,''77777777-7777-4777-8777-777777777804''::uuid,NULL,NULL,NULL,NULL,NULL,NULL,''77777777-7777-4777-8777-777777777805''::uuid)',
    'SELECT public.create_shop_collective_certificate_order_with_vouchers(''77777777-7777-4777-8777-777777777806''::uuid,''77777777-7777-4777-8777-777777777807''::uuid,''BANK_TRANSFER'',NULL,NULL,NULL,NULL,NULL,NULL,''081234567890'',ARRAY[]::uuid[])',
    'SELECT public.create_shop_product_order_with_edu_coin_vouchers(''77777777-7777-4777-8777-777777777808''::uuid,0,''081234567890'',NULL,ARRAY[]::uuid[])',
    'SELECT public.create_shop_product_order_with_vouchers(''77777777-7777-4777-8777-777777777809''::uuid,0,''081234567890'',''BANK_TRANSFER'',NULL,NULL,NULL,NULL,NULL,NULL,NULL,ARRAY[]::uuid[])',
    'SELECT * FROM public.list_my_shop_vouchers()',
    'SELECT * FROM public.list_shop_checkout_vouchers(''77777777-7777-4777-8777-777777777810''::uuid,0,0,0)',
    'SELECT public.mark_my_shop_vouchers_seen()'
  ];
  v_expected_better_auth_errors text[] := ARRAY[
    'AD_BANNER_REQUEST_NOT_FOUND',
    'COMPETITION_NOT_FOUND',
    'PRODUCT_NOT_AVAILABLE',
    'INVALID_QUANTITY',
    'INVALID_QUANTITY',
    NULL,
    'INVALID_QUANTITY',
    NULL
  ];
  v_index integer := 0;
  v_seen integer;
BEGIN
  -- The preceding Stage 3 regression rolls its own fixtures back. Seed a
  -- minimal Better Auth identity inside this independent rollback transaction.
  INSERT INTO private.app_users (id, identity_origin)
  VALUES ('ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid, 'better_auth')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://mvdczyitbkxkldjughor.supabase.co/auth/v1"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-fffffffffff6',TRUE);

  FOREACH v_call IN ARRAY v_better_auth_calls LOOP
    v_error := NULL;
    BEGIN
      EXECUTE v_call;
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
    END;
    IF v_error IS DISTINCT FROM 'BETTER_AUTH_ISSUER_REQUIRED' THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_LEGACY_ISSUER_NOT_DENIED:%:%',
        v_index + 1, coalesce(v_error,'<no error>');
    END IF;
    v_index := v_index + 1;
  END LOOP;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-fffffffffff6',TRUE);

  FOR v_index IN 1..array_length(v_better_auth_calls,1) LOOP
    v_error := NULL;
    BEGIN
      EXECUTE v_better_auth_calls[v_index];
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;
    END;
    IF v_expected_better_auth_errors[v_index] IS NULL THEN
      IF v_error IS NOT NULL THEN
        RAISE EXCEPTION 'STAGE7_POST_STAGE3_BETTER_AUTH_POSITIVE_FAILED:%:%',
          v_index, v_error;
      END IF;
    ELSIF v_error IS DISTINCT FROM v_expected_better_auth_errors[v_index] THEN
      RAISE EXCEPTION 'STAGE7_POST_STAGE3_BETTER_AUTH_SCOPE_FAILED:%:expected=%:actual=%',
        v_index, v_expected_better_auth_errors[v_index], coalesce(v_error,'<no error>');
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal
      AND t.tgname = 'trg_sync_shop_voucher_order_status'
      AND t.tgrelid = 'public.orders'::regclass
      AND t.tgfoid = 'private.sync_shop_voucher_order_status()'::regprocedure
      AND t.tgenabled = 'O'
  ) <> 1 THEN
    RAISE EXCEPTION 'STAGE7_POST_STAGE3_VOUCHER_TRIGGER_NOT_ACTIVE';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon', 'private.sync_shop_voucher_order_status()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', 'private.sync_shop_voucher_order_status()', 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'private.sync_shop_voucher_order_status()', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STAGE7_POST_STAGE3_VOUCHER_TRIGGER_EXECUTE_OVERBROAD';
  END IF;
END;
$stage7_post_stage3_user_rpc_runtime$;


DO $stage7_payment_and_voucher_owner_runtime$
DECLARE
  v_user_a constant uuid := 'ffffffff-ffff-4fff-8fff-fffffffffff6'::uuid;
  v_user_b constant uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid;
  v_admin constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid;
  v_checkout_product_id constant uuid := 'e8000000-0000-4000-8000-000000000003'::uuid;
  v_organizer constant uuid := 'e8000000-0000-4000-8000-000000000080'::uuid;
  v_definition constant uuid := 'e7000000-0000-4000-8000-000000000000'::uuid;
  v_voucher_a constant uuid := 'e7000000-0000-4000-8000-000000000001'::uuid;
  v_voucher_b constant uuid := 'e7000000-0000-4000-8000-000000000002'::uuid;
  v_ad_request_a constant uuid := 'e8000000-0000-4000-8000-000000000001'::uuid;
  v_ad_request_b constant uuid := 'e8000000-0000-4000-8000-000000000002'::uuid;
  v_missing_method constant uuid := 'e8000000-0000-4000-8000-000000000099'::uuid;
  v_global_method constant uuid := 'e8000000-0000-4000-8000-000000000098'::uuid;
  v_order public.orders%rowtype;
  v_checkout_order public.orders%rowtype;
  v_admin_product public.commerce_products%rowtype;
  v_admin_definition jsonb;
  v_admin_issue_a jsonb;
  v_admin_issue_b jsonb;
  v_checkout_definition_id uuid;
  v_checkout_voucher_a uuid;
  v_checkout_voucher_b uuid;
  v_order_a_id uuid;
  v_order_b_id uuid;
  v_count integer;
  v_seen integer;
  v_error text;
BEGIN
  -- Both actors and all rows below are synthetic; the enclosing transaction
  -- rolls profiles, vouchers, organizer/request fixtures and seen-state back.
  INSERT INTO private.app_users (id, identity_origin)
  VALUES
    (v_user_a, 'better_auth'),
    (v_user_b, 'better_auth'),
    (v_admin, 'better_auth')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, username, full_name, is_public)
  VALUES
    (v_user_a, 'stage7_owner_boundary_a', 'Stage 7 Voucher Owner A', false),
    (v_user_b, 'stage7_owner_boundary_b', 'Stage 7 Voucher Owner B', false),
    (v_admin, 'stage7_owner_boundary_admin', 'Stage 7 Voucher Admin', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role, is_active)
  VALUES
    (v_user_a, 'student'::public.app_role, true),
    (v_user_b, 'student'::public.app_role, true),
    (v_admin, 'admin'::public.app_role, true)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM public.organizers WHERE id = v_organizer
  ) OR EXISTS (
    SELECT 1 FROM public.shop_voucher_definitions
    WHERE id = v_definition OR name = 'Stage 7 Checkout Voucher Definition'
  ) OR EXISTS (
    SELECT 1 FROM public.commerce_products
    WHERE id = v_checkout_product_id
       OR code = 'STAGE7-VOUCHER-CHECKOUT'
       OR slug = 'stage7-voucher-checkout'
  ) OR EXISTS (
    SELECT 1 FROM public.shop_user_vouchers WHERE id IN (v_voucher_a, v_voucher_b)
  ) OR EXISTS (
    SELECT 1 FROM public.ad_banner_requests WHERE id IN (v_ad_request_a, v_ad_request_b)
  ) OR EXISTS (
    SELECT 1 FROM public.organizer_payment_methods
    WHERE id IN (v_missing_method, v_global_method)
       OR details->>'global_gateway'='true'
  ) THEN
    RAISE EXCEPTION 'STAGE7_PAYMENT_VOUCHER_FIXTURE_UUID_COLLISION';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, TRUE);

  INSERT INTO public.organizers (
    id, name, slug, owner_user_id, status, access_code
  ) VALUES (
    v_organizer,
    'Stage 7 Payment Owner Boundary',
    'stage7-payment-owner-boundary',
    v_user_a,
    'ACTIVE',
    'DEPRECATED'
  );

  INSERT INTO public.organizer_members (
    organizer_id, user_id, member_role, is_active, role, status
  ) VALUES (
    v_organizer, v_user_a, 'owner', true, 'owner', 'ACTIVE'
  );

  -- Build a real product and voucher definition through the Admin SECURITY
  -- DEFINER entrypoints. Both actors are synthetic and this transaction rolls back.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, TRUE);

  SELECT * INTO v_admin_product
  FROM public.admin_save_product(
    NULL::uuid,
    'STAGE7-VOUCHER-CHECKOUT',
    'stage7-voucher-checkout',
    'Stage 7 Voucher Checkout Product',
    'Rollback-only checkout fixture',
    'Synthetic product for voucher owner isolation acceptance',
    'DIGITAL_ITEM',
    ARRAY['student']::text[],
    10000,
    'IDR',
    NULL,
    TRUE,
    FALSE,
    900,
    '{}'::jsonb
  );
  IF v_admin_product.id IS DISTINCT FROM v_checkout_product_id
     OR v_admin_product.product_type::text IS DISTINCT FROM 'DIGITAL_ITEM'
     OR v_admin_product.price IS DISTINCT FROM 10000
     OR v_admin_product.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_ADMIN_PRODUCT_CREATE_FAILED:%', row_to_json(v_admin_product);
  END IF;

  v_admin_definition := public.admin_save_shop_voucher_definition(
    jsonb_build_object(
      'name','Stage 7 Checkout Voucher Definition',
      'description','Rollback-only two-user checkout fixture',
      'usage_type','SINGLE_USE',
      'benefit_group','PRICE_DISCOUNT',
      'benefit_type','PERCENT',
      'discount_value',10,
      'discount_currency','IDR',
      'scope_type','ALL',
      'starts_at',now()-interval '1 minute',
      'ends_at',now()+interval '1 day',
      'is_active',true
    )
  );
  v_checkout_definition_id := nullif(v_admin_definition->>'id','')::uuid;
  IF v_checkout_definition_id IS NULL
     OR v_admin_definition->>'name' IS DISTINCT FROM 'Stage 7 Checkout Voucher Definition' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_ADMIN_DEFINITION_CREATE_FAILED:%', v_admin_definition;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_list_shop_voucher_definitions()
    WHERE id=v_checkout_definition_id AND is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_ADMIN_LIST_DEFINITIONS_FAILED';
  END IF;

  v_admin_issue_a := public.admin_issue_shop_voucher(
    v_checkout_definition_id,'stage7_owner_boundary_a'
  );
  v_admin_issue_b := public.admin_issue_shop_voucher(
    v_checkout_definition_id,'stage7_owner_boundary_b'
  );
  v_checkout_voucher_a := nullif(v_admin_issue_a->>'id','')::uuid;
  v_checkout_voucher_b := nullif(v_admin_issue_b->>'id','')::uuid;
  IF v_checkout_voucher_a IS NULL OR v_checkout_voucher_b IS NULL
     OR v_admin_issue_a->>'user_id' IS DISTINCT FROM v_user_a::text
     OR v_admin_issue_b->>'user_id' IS DISTINCT FROM v_user_b::text
     OR v_admin_issue_a->>'status' IS DISTINCT FROM 'READY'
     OR v_admin_issue_b->>'status' IS DISTINCT FROM 'READY' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_ADMIN_ISSUE_OWNER_MISMATCH:%:%',
      v_admin_issue_a,v_admin_issue_b;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.admin_list_issued_shop_vouchers()
    WHERE id=v_checkout_voucher_a AND username='stage7_owner_boundary_a'
      AND voucher_name='Stage 7 Checkout Voucher Definition' AND status='READY'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.admin_list_issued_shop_vouchers()
    WHERE id=v_checkout_voucher_b AND username='stage7_owner_boundary_b'
      AND voucher_name='Stage 7 Checkout Voucher Definition' AND status='READY'
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_ADMIN_LIST_ISSUED_FAILED';
  END IF;

  -- Return to user A before starting the original two-user payment/voucher probe.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"ffffffff-ffff-4fff-8fff-fffffffffff6","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub',v_user_a::text,TRUE);

  -- Schema-only export intentionally excludes table rows, including the
  -- migration seed for the global method. Seed a deterministic disposable
  -- method inside this rollback transaction; no live gateway is invoked.
  INSERT INTO public.organizer_payment_methods (
    id, name, payment_type, details, is_active, sort_order
  ) VALUES (
    v_global_method,
    'STAGE7 disposable global gateway',
    'SNAP',
    jsonb_build_object(
      'global_gateway', true,
      'instructions', 'Disposable rollback-only gateway fixture'
    ),
    true,
    0
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.organizer_payment_methods
    WHERE id=v_global_method AND is_active=true
      AND payment_type='SNAP' AND details->>'global_gateway'='true'
  ) THEN
    RAISE EXCEPTION 'STAGE7_PAYMENT_GATEWAY_GLOBAL_METHOD_MISSING';
  END IF;

  -- Dummy secret only in the disposable rollback fixture. No gateway is called.
  INSERT INTO public.payment_gateway_configs (
    provider, is_enabled, environment, public_config, secret_config, updated_by
  ) VALUES (
    'MIDTRANS', true, 'sandbox', '{}'::jsonb,
    '{"sandbox":{"server_key":"STAGE7_DISPOSABLE_ONLY","disable_legacy_midtrans":true}}'::jsonb,
    v_user_a
  )
  ON CONFLICT (provider) DO UPDATE SET
    is_enabled=EXCLUDED.is_enabled,
    environment=EXCLUDED.environment,
    public_config=EXCLUDED.public_config,
    secret_config=EXCLUDED.secret_config,
    updated_by=EXCLUDED.updated_by,
    updated_at=now();

  -- payment_gateway_state is seeded by migration DML, which a schema-only
  -- Production export intentionally omits. Create the singleton fixture here.
  INSERT INTO public.payment_gateway_state (
    id, active_provider, automatic_payments_enabled, updated_by
  ) VALUES (
    true, 'MIDTRANS', false, v_user_a
  )
  ON CONFLICT (id) DO UPDATE SET
    active_provider=EXCLUDED.active_provider,
    automatic_payments_enabled=EXCLUDED.automatic_payments_enabled,
    updated_by=EXCLUDED.updated_by,
    updated_at=now();

  IF NOT EXISTS (
    SELECT 1 FROM public.payment_gateway_state
    WHERE id=true AND active_provider='MIDTRANS'
      AND automatic_payments_enabled=false AND updated_by=v_user_a
  ) THEN
    RAISE EXCEPTION 'STAGE7_PAYMENT_GATEWAY_STATE_FIXTURE_MISSING';
  END IF;

  INSERT INTO public.shop_voucher_definitions (
    id, name, description, usage_type, duration_hours,
    benefit_group, benefit_type, discount_value, discount_currency,
    scope_type, starts_at, ends_at, is_active, created_by
  ) VALUES (
    v_definition, 'Stage 7 Owner Boundary Voucher', 'Rollback-only ownership probe',
    'SINGLE_USE', NULL, 'PRICE_DISCOUNT', 'PERCENT', 10, 'IDR',
    'ALL', now() - interval '1 minute', now() + interval '1 day', true, v_user_a
  );

  INSERT INTO public.shop_user_vouchers (
    id, definition_id, user_id, status, viewed_at
  ) VALUES
    (v_voucher_a, v_definition, v_user_a, 'READY', NULL),
    (v_voucher_b, v_definition, v_user_b, 'READY', NULL);

  INSERT INTO public.ad_banner_requests (
    id, organizer_id, user_id, image_url, placement, slots_requested,
    duration_days, total_price, status
  ) VALUES
    (v_ad_request_a, v_organizer, v_user_a, 'https://example.invalid/stage7-owner-a.png',
     'home_top', 1, 7, 0, 'PENDING'),
    (v_ad_request_b, v_organizer, v_user_b, 'https://example.invalid/stage7-owner-b.png',
     'home_top', 1, 7, 0, 'PENDING');

  -- The checkout list must expose only the current user's voucher and show
  -- a selected valid single-use voucher as eligible.
  SELECT count(*) INTO v_count
  FROM public.list_shop_checkout_vouchers(
    v_checkout_product_id,1,10000,0
  )
  WHERE id=v_checkout_voucher_a AND eligible IS TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_CHECKOUT_ELIGIBILITY_FAILED:%',v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.list_shop_checkout_vouchers(
    v_checkout_product_id,1,10000,0
  )
  WHERE id=v_checkout_voucher_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_CHECKOUT_LIST_EXPOSED_FOREIGN:%',v_count;
  END IF;

  -- Explicit voucher IDOR attempt: A cannot ask the checkout helper to redeem B's voucher.
  v_error := NULL;
  BEGIN
    PERFORM public.create_shop_product_order_with_vouchers(
      v_checkout_product_id,1,'081234567801','BANK_TRANSFER',
      'https://proof.invalid/stage7-voucher-cross-owner-a',NULL,NULL,NULL,NULL,NULL,NULL,
      ARRAY[v_checkout_voucher_b]
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'SHOP_VOUCHER_NOT_AVAILABLE' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_FOREIGN_CHECKOUT_NOT_DENIED:%',
      coalesce(v_error,'<no error>');
  END IF;

  -- A can then redeem their own voucher. The order is A-owned and the voucher
  -- becomes RESERVED only for A's newly created pending order.
  BEGIN
    SELECT * INTO v_checkout_order
    FROM public.create_shop_product_order_with_vouchers(
      v_checkout_product_id,1,'081234567802','BANK_TRANSFER',
      'https://proof.invalid/stage7-voucher-owner-a',NULL,NULL,NULL,NULL,NULL,NULL,
      ARRAY[v_checkout_voucher_a]
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_VALID_CHECKOUT_FAILED:%',SQLERRM;
  END;
  IF v_checkout_order.id IS NULL
     OR v_checkout_order.user_id IS DISTINCT FROM v_user_a
     OR v_checkout_order.status::text IS DISTINCT FROM 'PENDING_PAYMENT'
     OR v_checkout_order.discount IS DISTINCT FROM 1000
     OR v_checkout_order.total IS DISTINCT FROM 9000 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_CHECKOUT_ORDER_MISMATCH:%',row_to_json(v_checkout_order);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_checkout_voucher_a AND user_id=v_user_a
      AND status='RESERVED' AND reserved_order_id=v_checkout_order.id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_checkout_voucher_b AND user_id=v_user_b
      AND status='READY' AND reserved_order_id IS NULL
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_CHECKOUT_RESERVATION_CROSSED_BOUNDARY';
  END IF;

  -- User A must see and mark only A's original voucher; B's voucher stays hidden/unseen.
  SELECT count(*) INTO v_count
  FROM public.list_my_shop_vouchers()
  WHERE id = v_voucher_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_CANNOT_READ_OWN_VOUCHER:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_my_shop_vouchers()
  WHERE id = v_voucher_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_READ_FOREIGN_VOUCHER:%', v_count;
  END IF;

  v_seen := public.mark_my_shop_vouchers_seen();
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_MARK_SEEN_COUNT:%', v_seen;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.shop_user_vouchers
       WHERE id = v_voucher_a AND viewed_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.shop_user_vouchers
       WHERE id = v_voucher_b AND viewed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_A_MARK_SEEN_CROSSED_BOUNDARY';
  END IF;

  -- A can submit payment only for A's ad request. A foreign request is hidden
  -- as not found before the payment method/gateway configuration is read.
  v_error := NULL;
  BEGIN
    PERFORM public.create_ad_banner_payment_order(
      v_ad_request_b, v_global_method, NULL, NULL, 0, NULL, NULL, NULL, 0
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'AD_BANNER_REQUEST_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_AD_BANNER_OWNER_A_FOREIGN_REQUEST_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  UPDATE public.payment_gateway_state
  SET automatic_payments_enabled=true, updated_at=now()
  WHERE id=true;

  BEGIN
    SELECT * INTO v_order
    FROM public.create_ad_banner_payment_order(
      v_ad_request_a, v_global_method, NULL, NULL, 0, NULL, NULL, NULL, 0
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'STAGE7_AD_BANNER_OWNER_A_OWN_REQUEST_SCOPE_FAILED:%', SQLERRM;
  END;
  IF v_order.id IS NULL OR v_order.user_id IS DISTINCT FROM v_user_a
     OR v_order.payment_method_id IS DISTINCT FROM v_global_method
     OR v_order.payment_provider IS DISTINCT FROM 'GLOBAL' THEN
    RAISE EXCEPTION 'STAGE7_AD_BANNER_OWNER_A_ORDER_OWNER_MISMATCH:%', row_to_json(v_order);
  END IF;
  v_order_a_id := v_order.id;

  -- Reset A's marker so B's subsequent mark-seen call proves it cannot
  -- touch A's voucher while marking B's row.
  UPDATE public.shop_user_vouchers
  SET viewed_at = NULL
  WHERE id = v_voucher_a;

  -- B's checkout list exposes the B voucher only. A's reserved voucher
  -- must not be visible to B.
  SELECT count(*) INTO v_count
  FROM public.list_shop_checkout_vouchers(
    v_checkout_product_id,1,10000,0
  )
  WHERE id=v_checkout_voucher_b AND eligible IS TRUE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_CHECKOUT_ELIGIBILITY_FAILED:%',v_count;
  END IF;
  SELECT count(*) INTO v_count
  FROM public.list_shop_checkout_vouchers(
    v_checkout_product_id,1,10000,0
  )
  WHERE id=v_checkout_voucher_a;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_CHECKOUT_LIST_EXPOSED_FOREIGN:%',v_count;
  END IF;

  BEGIN
    SELECT * INTO v_checkout_order
    FROM public.create_shop_product_order_with_vouchers(
      v_checkout_product_id,1,'081234567803','BANK_TRANSFER',
      'https://proof.invalid/stage7-voucher-owner-b',NULL,NULL,NULL,NULL,NULL,NULL,
      ARRAY[v_checkout_voucher_b]
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_VALID_CHECKOUT_FAILED:%',SQLERRM;
  END;
  IF v_checkout_order.id IS NULL
     OR v_checkout_order.user_id IS DISTINCT FROM v_user_b
     OR v_checkout_order.discount IS DISTINCT FROM 1000
     OR v_checkout_order.total IS DISTINCT FROM 9000 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_CHECKOUT_ORDER_MISMATCH:%',row_to_json(v_checkout_order);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_checkout_voucher_b AND user_id=v_user_b
      AND status='RESERVED' AND reserved_order_id=v_checkout_order.id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_checkout_voucher_a AND user_id=v_user_a
      AND status='RESERVED' AND reserved_order_id IS DISTINCT FROM v_checkout_order.id
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_CHECKOUT_RESERVATION_CROSSED_BOUNDARY';
  END IF;

  -- Switch to B. B sees/marks only B's original viewed marker and cannot address A's request.
  PERFORM set_config(
    'request.jwt.claims',
    '{"sub":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","role":"authenticated","iss":"https://auth-prod.sykabelajar.my.id/api/auth"}',
    TRUE
  );
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, TRUE);

  SELECT count(*) INTO v_count
  FROM public.list_my_shop_vouchers()
  WHERE id = v_voucher_b;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_CANNOT_READ_OWN_VOUCHER:%', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.list_my_shop_vouchers()
  WHERE id = v_voucher_a;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_READ_FOREIGN_VOUCHER:%', v_count;
  END IF;

  v_seen := public.mark_my_shop_vouchers_seen();
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_MARK_SEEN_COUNT:%', v_seen;
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public.shop_user_vouchers
       WHERE id = v_voucher_b AND viewed_at IS NOT NULL
     )
     OR EXISTS (
       SELECT 1 FROM public.shop_user_vouchers
       WHERE id = v_voucher_a AND viewed_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_OWNER_B_MARK_SEEN_CROSSED_BOUNDARY';
  END IF;

  UPDATE public.payment_gateway_state
  SET automatic_payments_enabled=false, updated_at=now()
  WHERE id=true;

  v_error := NULL;
  BEGIN
    PERFORM public.create_ad_banner_payment_order(
      v_ad_request_a, v_global_method, NULL, NULL, 0, NULL, NULL, NULL, 0
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'AD_BANNER_REQUEST_NOT_FOUND' THEN
    RAISE EXCEPTION 'STAGE7_AD_BANNER_OWNER_B_FOREIGN_REQUEST_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  UPDATE public.payment_gateway_state
  SET automatic_payments_enabled=true, updated_at=now()
  WHERE id=true;

  BEGIN
    SELECT * INTO v_order
    FROM public.create_ad_banner_payment_order(
      v_ad_request_b, v_global_method, NULL, NULL, 0, NULL, NULL, NULL, 0
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'STAGE7_AD_BANNER_OWNER_B_OWN_REQUEST_SCOPE_FAILED:%', SQLERRM;
  END;
  IF v_order.id IS NULL OR v_order.user_id IS DISTINCT FROM v_user_b
     OR v_order.payment_method_id IS DISTINCT FROM v_global_method
     OR v_order.payment_provider IS DISTINCT FROM 'GLOBAL' THEN
    RAISE EXCEPTION 'STAGE7_AD_BANNER_OWNER_B_ORDER_OWNER_MISMATCH:%', row_to_json(v_order);
  END IF;
  v_order_b_id := v_order.id;

  -- Exercise the private trigger as it is actually attached to an AFTER UPDATE
  -- OF status boundary. A temporary row proxy avoids changing real order status
  -- and lets this regression prove both consume and release transitions.
  CREATE TEMP TABLE stage7_voucher_order_trigger_probe (
    id uuid PRIMARY KEY,
    status public.order_status NOT NULL
  ) ON COMMIT DROP;

  CREATE TRIGGER stage7_voucher_order_trigger_probe_status
  AFTER UPDATE OF status ON stage7_voucher_order_trigger_probe
  FOR EACH ROW EXECUTE FUNCTION private.sync_shop_voucher_order_status();

  INSERT INTO stage7_voucher_order_trigger_probe (id,status)
  VALUES (v_order_a_id,'PENDING_PAYMENT'),(v_order_b_id,'PENDING_PAYMENT');

  UPDATE public.shop_user_vouchers
  SET status='RESERVED',reserved_order_id=v_order_a_id,reserved_at=now()
  WHERE id=v_voucher_a AND user_id=v_user_a AND status='READY';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_A_RESERVATION_FIXTURE_FAILED:%',v_count;
  END IF;

  UPDATE public.shop_user_vouchers
  SET status='RESERVED',reserved_order_id=v_order_b_id,reserved_at=now()
  WHERE id=v_voucher_b AND user_id=v_user_b AND status='READY';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_B_RESERVATION_FIXTURE_FAILED:%',v_count;
  END IF;

  UPDATE stage7_voucher_order_trigger_probe
  SET status='PAID'
  WHERE id=v_order_a_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_voucher_a AND user_id=v_user_a AND status='USED'
      AND used_order_id=v_order_a_id AND reserved_order_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_voucher_b AND user_id=v_user_b AND status='RESERVED'
      AND reserved_order_id=v_order_b_id
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_PAID_CROSS_OWNER_BOUNDARY';
  END IF;

  UPDATE stage7_voucher_order_trigger_probe
  SET status='CANCELLED'
  WHERE id=v_order_b_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_voucher_b AND user_id=v_user_b AND status='READY'
      AND reserved_order_id IS NULL AND reserved_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.shop_user_vouchers
    WHERE id=v_voucher_a AND user_id=v_user_a AND status='USED'
      AND used_order_id=v_order_a_id
  ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_TRIGGER_CANCEL_CROSS_OWNER_BOUNDARY';
  END IF;

  -- Voucher administration remains Better Auth Admin-only across every
  -- public admin wrapper. Each call is expected to fail before table access.
  v_error := NULL;
  BEGIN
    PERFORM * FROM public.admin_list_shop_voucher_definitions();
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ADMIN_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_NON_ADMIN_ADMIN_RPC_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_save_shop_voucher_definition('{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ADMIN_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_NON_ADMIN_SAVE_DEFINITION_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM public.admin_issue_shop_voucher(v_definition, 'stage7_owner_boundary_b');
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ADMIN_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_NON_ADMIN_ISSUE_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  v_error := NULL;
  BEGIN
    PERFORM * FROM public.admin_list_issued_shop_vouchers();
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'ADMIN_REQUIRED' THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_NON_ADMIN_LIST_ISSUED_NOT_DENIED:%',
      coalesce(v_error, '<no error>');
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon',
       'private.calculate_shop_voucher_effects(uuid,uuid,integer,numeric,numeric,uuid[])',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'private.calculate_shop_voucher_effects(uuid,uuid,integer,numeric,numeric,uuid[])',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'private.calculate_shop_voucher_effects(uuid,uuid,integer,numeric,numeric,uuid[])',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'STAGE7_VOUCHER_CALCULATOR_PRIVATE_EXECUTE_OVERBROAD';
  END IF;
END;
$stage7_payment_and_voucher_owner_runtime$;

ROLLBACK;
