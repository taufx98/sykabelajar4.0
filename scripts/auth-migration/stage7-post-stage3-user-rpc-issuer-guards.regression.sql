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

ROLLBACK;
