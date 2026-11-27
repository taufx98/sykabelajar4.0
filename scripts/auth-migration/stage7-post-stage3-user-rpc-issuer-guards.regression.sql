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
  v_organizer constant uuid := 'e8000000-0000-4000-8000-000000000080'::uuid;
  v_definition constant uuid := 'e7000000-0000-4000-8000-000000000000'::uuid;
  v_voucher_a constant uuid := 'e7000000-0000-4000-8000-000000000001'::uuid;
  v_voucher_b constant uuid := 'e7000000-0000-4000-8000-000000000002'::uuid;
  v_ad_request_a constant uuid := 'e8000000-0000-4000-8000-000000000001'::uuid;
  v_ad_request_b constant uuid := 'e8000000-0000-4000-8000-000000000002'::uuid;
  v_missing_method constant uuid := 'e8000000-0000-4000-8000-000000000099'::uuid;
  v_global_method uuid;
  v_order public.orders%rowtype;
  v_count integer;
  v_seen integer;
  v_error text;
BEGIN
  -- Both actors and all rows below are synthetic; the enclosing transaction
  -- rolls profiles, vouchers, organizer/request fixtures and seen-state back.
  INSERT INTO private.app_users (id, identity_origin)
  VALUES (v_user_a, 'better_auth'), (v_user_b, 'better_auth')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, username, full_name, is_public)
  VALUES
    (v_user_a, 'stage7_owner_boundary_a', 'Stage 7 Voucher Owner A', false),
    (v_user_b, 'stage7_owner_boundary_b', 'Stage 7 Voucher Owner B', false)
  ON CONFLICT (id) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM public.organizers WHERE id = v_organizer
  ) OR EXISTS (
    SELECT 1 FROM public.shop_voucher_definitions WHERE id = v_definition
  ) OR EXISTS (
    SELECT 1 FROM public.shop_user_vouchers WHERE id IN (v_voucher_a, v_voucher_b)
  ) OR EXISTS (
    SELECT 1 FROM public.ad_banner_requests WHERE id IN (v_ad_request_a, v_ad_request_b)
  ) OR EXISTS (
    SELECT 1 FROM public.organizer_payment_methods WHERE id = v_missing_method
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

  SELECT id INTO v_global_method
  FROM public.organizer_payment_methods
  WHERE details->>'global_gateway'='true' AND is_active=true
  ORDER BY sort_order, created_at
  LIMIT 1;
  IF v_global_method IS NULL THEN
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

  UPDATE public.payment_gateway_state
  SET active_provider='MIDTRANS', automatic_payments_enabled=false,
      updated_by=v_user_a, updated_at=now()
  WHERE id=true;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
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

  -- User A must see and mark only A's voucher; B's voucher stays hidden/unseen.
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

  -- Reset A's marker so B's subsequent mark-seen call proves it cannot
  -- touch A's voucher while marking B's row.
  UPDATE public.shop_user_vouchers
  SET viewed_at = NULL
  WHERE id = v_voucher_a;

  -- Switch to B. B sees/marks only B's voucher and cannot address A's request.
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
