-- Stage 5 compatibility hardening for the privileged payment fulfillment RPC.
-- This is a disposable-restore acceptance draft, not a Production migration.
-- It preserves SECURITY DEFINER, search_path and EXECUTE ACLs. The only
-- behavioral change is how the caller's verified service_role claim is read.

DO $stage5_payment_role_claim$
DECLARE
  v_function_oid oid := to_regprocedure('public.process_payment_gateway_success(uuid,text,uuid)');
  v_definition text;
  v_original_claims text;
  v_original_legacy_role text;
  v_error text;
  v_declaration_anchor text := E'  k integer;\nbegin';
  v_new_declarations text := E'  k integer;\n  v_stage5_jwt_claims jsonb;\n  v_stage5_role text;\nbegin';
  v_old_guard text := '  if coalesce(current_setting(''request.jwt.claim.role'', true), '''') <> ''service_role'' then raise exception ''SERVICE_ROLE_REQUIRED''; end if;';
  v_new_guard text := E'  v_stage5_jwt_claims := nullif(current_setting(''request.jwt.claims'', true), '''')::jsonb;\n  v_stage5_role := coalesce(\n    nullif(v_stage5_jwt_claims ->> ''role'', ''''),\n    nullif(current_setting(''request.jwt.claim.role'', true), '''')\n  );\n  if coalesce(v_stage5_role, '''') <> ''service_role'' then raise exception ''SERVICE_ROLE_REQUIRED''; end if;';
  v_prosecdef boolean;
  v_proconfig text;
BEGIN
  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_FUNCTION_MISSING';
  END IF;

  SELECT pg_get_functiondef(v_function_oid)
  INTO v_definition;

  IF position('v_stage5_jwt_claims' IN v_definition) > 0
     OR position('v_stage5_role' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_DRAFT_ALREADY_APPLIED';
  END IF;

  IF position(v_declaration_anchor IN v_definition) = 0 THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_DECLARATION_ANCHOR_DRIFT';
  END IF;
  IF position(v_old_guard IN v_definition) = 0 THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_GUARD_ANCHOR_DRIFT';
  END IF;

  v_definition := replace(v_definition, v_declaration_anchor, v_new_declarations);
  v_definition := replace(v_definition, v_old_guard, v_new_guard);

  IF position('v_stage5_jwt_claims' IN v_definition) = 0
     OR position('request.jwt.claims' IN v_definition) = 0
     OR position('request.jwt.claim.role' IN v_definition) = 0
     OR position('SERVICE_ROLE_REQUIRED' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_PATCH_POSTCONDITION_FAILED';
  END IF;

  EXECUTE v_definition;

  SELECT p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '')
  INTO v_prosecdef, v_proconfig
  FROM pg_proc p
  WHERE p.oid = v_function_oid;

  IF v_prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_SECURITY_DEFINER_CHANGED';
  END IF;
  IF position('search_path=public, private, pg_catalog' IN v_proconfig) = 0 THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_SEARCH_PATH_CHANGED:%', v_proconfig;
  END IF;
  IF NOT has_function_privilege('service_role', v_function_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_function_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'STAGE5_PAYMENT_ROLE_EXECUTE_ACL_CHANGED';
  END IF;

  -- Exercise the exact role guard without touching any application row.
  -- JSON request claims take precedence over the legacy compatibility setting.
  v_original_claims := current_setting('request.jwt.claims', true);
  v_original_legacy_role := current_setting('request.jwt.claim.role', true);

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    PERFORM public.process_payment_gateway_success(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'MIDTRANS',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    RAISE EXCEPTION 'STAGE5_AUTHENTICATED_ROLE_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'SERVICE_ROLE_REQUIRED' THEN
      RAISE EXCEPTION 'STAGE5_AUTHENTICATED_ROLE_GUARD_FAILED:%', v_error;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
  BEGIN
    PERFORM public.process_payment_gateway_success(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'MIDTRANS',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    RAISE EXCEPTION 'STAGE5_ANON_ROLE_GUARD_NOT_ENFORCED';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'SERVICE_ROLE_REQUIRED' THEN
      RAISE EXCEPTION 'STAGE5_ANON_ROLE_GUARD_FAILED:%', v_error;
    END IF;
  END;

  -- The current JSON role is authoritative even if the legacy setting differs.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.process_payment_gateway_success(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'MIDTRANS',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    RAISE EXCEPTION 'STAGE5_SERVICE_ROLE_LOOKUP_DID_NOT_RUN';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'ORDER_NOT_FOUND' THEN
      RAISE EXCEPTION 'STAGE5_SERVICE_ROLE_JSON_CLAIM_FAILED:%', v_error;
    END IF;
  END;

  -- Legacy fallback remains available for older PostgREST claim injection.
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    PERFORM public.process_payment_gateway_success(
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'MIDTRANS',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    );
    RAISE EXCEPTION 'STAGE5_LEGACY_SERVICE_ROLE_LOOKUP_DID_NOT_RUN';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    IF v_error <> 'ORDER_NOT_FOUND' THEN
      RAISE EXCEPTION 'STAGE5_LEGACY_SERVICE_ROLE_FALLBACK_FAILED:%', v_error;
    END IF;
  END;

  PERFORM set_config('request.jwt.claims', coalesce(v_original_claims, ''), true);
  PERFORM set_config('request.jwt.claim.role', coalesce(v_original_legacy_role, ''), true);
END;
$stage5_payment_role_claim$;

