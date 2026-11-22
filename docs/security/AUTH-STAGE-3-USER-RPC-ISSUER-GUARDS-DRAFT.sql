-- DRAFT ONLY — Stage 3 issuer guards for user-bound SECURITY DEFINER RPCs
-- Applies after the identity-root and shared Better Auth issuer-guard drafts.
-- This is first exercised against the disposable Production-schema restore.
-- It does not migrate/delete rows and does not change function grants.
--
-- Each replacement is an exact pg_get_functiondef snapshot from a fresh
-- read-only Production catalog query. The intended change is a first-statement
-- private.current_user_is_better_auth() check before existing business logic.
-- SQL-language functions are converted to PL/pgSQL to fail closed with the
-- same BETTER_AUTH_ISSUER_REQUIRED contract.
--
-- Also includes four frontend-invoked user-session diagnostics RPCs previously
-- labelled worker_internal: claim_rpc_recovery, mark_rpc_healthy,
-- report_rpc_failure, report_system_error.
--
-- Added functions: 36. No function owner, ACL, SECURITY DEFINER,
-- search_path, return type or identity argument may change.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $user_rpc_preflight$
DECLARE
  v_count integer;
BEGIN
  IF pg_catalog.to_regprocedure('private.current_user_is_better_auth()') IS NULL THEN
    RAISE EXCEPTION 'STAGE3_USER_RPC_BETTER_AUTH_HELPER_MISSING';
  END IF;
  SELECT count(*) INTO v_count
  FROM unnest(ARRAY[
    'public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)',
    'public.choose_linear_exam_timeout(uuid,text)',
    'public.claim_collective_participant(text,text)',
    'public.claim_rpc_recovery(text)',
    'public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)',
    'public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])',
    'public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])',
    'public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])',
    'public.ensure_referral_code()',
    'public.get_collective_registration(uuid)',
    'public.get_daily_checkin_streak_rewards(date)',
    'public.get_linear_exam_state(uuid)',
    'public.get_organizer_exam_preview_report(uuid)',
    'public.get_organizer_payment_config()',
    'public.get_referral_program_settings()',
    'public.get_referral_program_settings_v2()',
    'public.join_organizer(text,text)',
    'public.list_claimable_organizer_vouchers()',
    'public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)',
    'public.list_teacher_collective_participants(uuid)',
    'public.mark_rpc_healthy(text)',
    'public.provision_collective_registration(uuid)',
    'public.regenerate_collective_participant_password(uuid)',
    'public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)',
    'public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)',
    'public.report_competition_comment(uuid,text)',
    'public.report_rpc_failure(text,text,text)',
    'public.report_system_error(text,text,text,text,jsonb,text,text)',
    'public.resolve_linear_exam_timeout(uuid)',
    'public.save_linear_exam_draft(uuid,uuid,jsonb)',
    'public.set_collective_participant_password(uuid,text)',
    'public.skip_linear_exam_question(uuid)',
    'public.start_linear_exam_attempt(uuid)',
    'public.sync_collective_registration_order_payment(uuid)',
    'public.validate_organizer_voucher(text)',
    'public.validate_organizer_voucher(text,text,text)'
  ]::text[]) AS expected(signature)
  WHERE pg_catalog.to_regprocedure(expected.signature) IS NOT NULL;
  IF v_count <> 36 THEN
    RAISE EXCEPTION 'STAGE3_USER_RPC_FUNCTION_COUNT_MISMATCH: expected 36, found %', v_count;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
    'public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)',
    'public.choose_linear_exam_timeout(uuid,text)',
    'public.claim_collective_participant(text,text)',
    'public.claim_rpc_recovery(text)',
    'public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)',
    'public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])',
    'public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])',
    'public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])',
    'public.ensure_referral_code()',
    'public.get_collective_registration(uuid)',
    'public.get_daily_checkin_streak_rewards(date)',
    'public.get_linear_exam_state(uuid)',
    'public.get_organizer_exam_preview_report(uuid)',
    'public.get_organizer_payment_config()',
    'public.get_referral_program_settings()',
    'public.get_referral_program_settings_v2()',
    'public.join_organizer(text,text)',
    'public.list_claimable_organizer_vouchers()',
    'public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)',
    'public.list_teacher_collective_participants(uuid)',
    'public.mark_rpc_healthy(text)',
    'public.provision_collective_registration(uuid)',
    'public.regenerate_collective_participant_password(uuid)',
    'public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)',
    'public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)',
    'public.report_competition_comment(uuid,text)',
    'public.report_rpc_failure(text,text,text)',
    'public.report_system_error(text,text,text,text,jsonb,text,text)',
    'public.resolve_linear_exam_timeout(uuid)',
    'public.save_linear_exam_draft(uuid,uuid,jsonb)',
    'public.set_collective_participant_password(uuid,text)',
    'public.skip_linear_exam_question(uuid)',
    'public.start_linear_exam_attempt(uuid)',
    'public.sync_collective_registration_order_payment(uuid)',
    'public.validate_organizer_voucher(text)',
    'public.validate_organizer_voucher(text,text,text)'
    ]::text[]) AS expected(signature)
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
    WHERE NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION 'STAGE3_USER_RPC_SECURITY_DEFINER_EXPECTED';
  END IF;
END;
$user_rpc_preflight$;

CREATE TEMP TABLE stage3_user_rpc_acl_snapshot ON COMMIT DROP AS
SELECT p.oid, p.proowner, p.prosecdef, p.proconfig, p.proacl, p.prorettype,
       p.proargtypes::oid[] AS proargtypes
FROM pg_catalog.pg_proc p
JOIN unnest(ARRAY[
    'public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)',
    'public.choose_linear_exam_timeout(uuid,text)',
    'public.claim_collective_participant(text,text)',
    'public.claim_rpc_recovery(text)',
    'public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)',
    'public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])',
    'public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])',
    'public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])',
    'public.ensure_referral_code()',
    'public.get_collective_registration(uuid)',
    'public.get_daily_checkin_streak_rewards(date)',
    'public.get_linear_exam_state(uuid)',
    'public.get_organizer_exam_preview_report(uuid)',
    'public.get_organizer_payment_config()',
    'public.get_referral_program_settings()',
    'public.get_referral_program_settings_v2()',
    'public.join_organizer(text,text)',
    'public.list_claimable_organizer_vouchers()',
    'public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)',
    'public.list_teacher_collective_participants(uuid)',
    'public.mark_rpc_healthy(text)',
    'public.provision_collective_registration(uuid)',
    'public.regenerate_collective_participant_password(uuid)',
    'public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)',
    'public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)',
    'public.report_competition_comment(uuid,text)',
    'public.report_rpc_failure(text,text,text)',
    'public.report_system_error(text,text,text,text,jsonb,text,text)',
    'public.resolve_linear_exam_timeout(uuid)',
    'public.save_linear_exam_draft(uuid,uuid,jsonb)',
    'public.set_collective_participant_password(uuid,text)',
    'public.skip_linear_exam_question(uuid)',
    'public.start_linear_exam_attempt(uuid)',
    'public.sync_collective_registration_order_payment(uuid)',
    'public.validate_organizer_voucher(text)',
    'public.validate_organizer_voucher(text,text,text)'
]::text[]) AS expected(signature)
  ON p.oid=pg_catalog.to_regprocedure(expected.signature);

-- answer_linear_exam_question(uuid,uuid,jsonb,boolean)
CREATE OR REPLACE FUNCTION public.answer_linear_exam_question(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb, p_skip boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_payload_present boolean;
  v_time_bank integer := 0;
  v_final_state text;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase = 'COMPLETED' or v_attempt.status <> 'IN_PROGRESS' then
    return private.build_linear_exam_state(p_attempt_id);
  end if;
  if v_runtime.phase <> 'ACTIVE' then
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;

  v_now := clock_timestamp();
  if v_question.question_id is distinct from p_question_id then
    raise exception 'EXAM_QUESTION_CHANGED';
  end if;
  if v_question.question_deadline is null or v_now >= v_question.question_deadline then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if jsonb_typeof(coalesce(p_answer_json, '{}'::jsonb)) <> 'object'
     or pg_column_size(coalesce(p_answer_json, '{}'::jsonb)) > 50000 then
    raise exception 'INVALID_ANSWER_PAYLOAD';
  end if;

  v_payload_present :=
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values') = 'array' and jsonb_array_length(p_answer_json->'values') > 0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null;

  if p_skip or not v_payload_present then
    delete from public.answers
    where attempt_id = p_attempt_id and question_id = v_question.question_id;
    v_final_state := 'SKIPPED';
    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_SKIPPED', 'PARTICIPANT',
      jsonb_build_object('reason', case when p_skip then 'PARTICIPANT_SKIP' else 'EMPTY_ANSWER' end),
      v_now
    );
  else
    insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
    values (p_attempt_id, v_question.question_id, p_answer_json, v_now, v_now)
    on conflict (attempt_id, question_id)
    do update set answer_json = excluded.answer_json,
                  saved_at = excluded.saved_at,
                  updated_at = excluded.updated_at;

    v_final_state := 'ANSWERED';
    -- Eligible for one 60-second bonus only when at least half of the
    -- actual allocated interval remains. Wrong answers still qualify.
    if v_runtime.current_position < v_runtime.question_count
       and extract(epoch from (v_question.question_deadline - v_now)) * 2
           >= extract(epoch from (v_question.question_deadline - v_question.opened_at)) then
      v_time_bank := 60;
    else
      v_time_bank := 0;
    end if;

    perform private.log_linear_exam_event(
      p_attempt_id, v_question.position, v_question.question_id,
      'QUESTION_ANSWERED', 'PARTICIPANT',
      jsonb_build_object(
        'phase', 'ACTIVE',
        'speed_bonus_awarded', v_time_bank > 0,
        'speed_bonus_seconds', v_time_bank
      ),
      v_now
    );
  end if;

  perform private.advance_linear_exam_question(
    p_attempt_id, v_now, v_final_state, v_time_bank,
    case when v_final_state = 'SKIPPED' then 'PARTICIPANT_SKIP' else 'ANSWERED' end,
    'PARTICIPANT'
  );
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

-- choose_linear_exam_timeout(uuid,text)
CREATE OR REPLACE FUNCTION public.choose_linear_exam_timeout(p_attempt_id uuid, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_next public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
  v_next_available integer;
  v_new_grace_deadline timestamptz;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase <> 'DECISION' then return private.build_linear_exam_state(p_attempt_id); end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;
  v_now := clock_timestamp();

  if v_question.decision_deadline is null or v_now >= v_question.decision_deadline then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  if upper(coalesce(p_decision,'')) = 'BORROW' then
    select * into v_next
    from public.exam_attempt_questions
    where attempt_id = p_attempt_id and position = v_runtime.current_position + 1
    for update;
    if not found then raise exception 'NO_NEXT_QUESTION_TO_BORROW_FROM'; end if;

    v_next_available := v_next.base_seconds + v_next.time_credit_seconds - v_next.borrowed_from_previous_seconds;
    if v_next_available < 60 then raise exception 'NEXT_QUESTION_MINIMUM_TIME'; end if;

    update public.exam_attempt_questions
    set borrowed_from_previous_seconds = borrowed_from_previous_seconds + 30
    where attempt_id = p_attempt_id and position = v_next.position;

    v_new_grace_deadline := least(v_now + make_interval(secs => v_runtime.grace_seconds), v_runtime.global_deadline);
    update public.exam_attempt_questions
    set grace_deadline = v_new_grace_deadline,
        transition_reason = 'BORROWED_30_SECONDS'
    where attempt_id = p_attempt_id and position = v_question.position;
    update public.exam_attempt_runtime
    set phase = 'GRACE', grace_kind = 'BORROWED', updated_at = clock_timestamp()
    where attempt_id = p_attempt_id;

    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'BORROW_ACCEPTED', 'PARTICIPANT', jsonb_build_object('seconds', 30, 'deducted_from_position', v_next.position), v_now);
    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_GRACE_STARTED', 'SYSTEM', jsonb_build_object('grace_seconds', v_runtime.grace_seconds, 'kind', 'BORROWED'), v_now);
  elsif upper(coalesce(p_decision,'')) = 'CONTINUE' then
    v_new_grace_deadline := least(v_now + make_interval(secs => v_runtime.grace_seconds), v_runtime.global_deadline);
    update public.exam_attempt_questions
    set grace_deadline = v_new_grace_deadline,
        transition_reason = 'FREE_GRACE'
    where attempt_id = p_attempt_id and position = v_question.position;
    update public.exam_attempt_runtime
    set phase = 'GRACE', grace_kind = 'FREE', updated_at = clock_timestamp()
    where attempt_id = p_attempt_id;

    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'BORROW_DECLINED', 'PARTICIPANT', '{}'::jsonb, v_now);
    perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_GRACE_STARTED', 'SYSTEM', jsonb_build_object('grace_seconds', v_runtime.grace_seconds, 'kind', 'FREE'), v_now);
  else
    raise exception 'INVALID_TIMEOUT_DECISION';
  end if;

  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

-- claim_collective_participant(text,text)
CREATE OR REPLACE FUNCTION public.claim_collective_participant(p_participant_code text, p_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cp public.collective_participants%rowtype;
  v_ac public.participant_access_credentials%rowtype;
  v_claimed_before boolean;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select cp.*
    into v_cp
  from public.collective_participants as cp
  where upper(cp.participant_code) = upper(trim(p_participant_code))
    and cp.status = 'ACTIVE'
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'INVALID_CREDENTIALS');
  end if;

  v_claimed_before := v_cp.user_id is not null;
  if v_claimed_before and v_cp.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'ALREADY_CLAIMED');
  end if;

  select pac.*
    into v_ac
  from public.participant_access_credentials as pac
  where pac.collective_participant_id = v_cp.id
    and pac.enabled = true
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'ACCESS_NOT_READY');
  end if;

  if v_ac.locked_until is not null and v_ac.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'LOCKED');
  end if;

  if crypt(coalesce(p_password, ''), v_ac.password_hash) is distinct from v_ac.password_hash then
    update public.participant_access_credentials as pac
    set failed_attempts = pac.failed_attempts + 1,
        locked_until = case
          when pac.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else pac.locked_until
        end,
        updated_at = now()
    where pac.id = v_ac.id;

    return jsonb_build_object('ok', false, 'reason', 'INVALID_CREDENTIALS');
  end if;

  update public.participant_access_credentials as pac
  set failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where pac.id = v_ac.id;

  if not v_claimed_before then
    update public.collective_participants as cp
    set user_id = v_uid,
        updated_at = now()
    where cp.id = v_cp.id;

    insert into public.audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      reason,
      before_data,
      after_data,
      request_id
    )
    values (
      v_uid,
      'COLLECTIVE_PARTICIPANT_CLAIMED',
      'collective_participant',
      v_cp.id::text,
      'Participant riwayat ditautkan ke akun penuh.',
      jsonb_build_object('user_id', v_cp.user_id),
      jsonb_build_object('user_id', v_uid, 'competition_id', v_cp.competition_id),
      null
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'participant_id', v_cp.id,
    'competition_id', v_cp.competition_id,
    'participant_code', v_cp.participant_code,
    'already_claimed_by_current_user', v_claimed_before
  );
end;
$function$;

-- claim_rpc_recovery(text)
CREATE OR REPLACE FUNCTION public.claim_rpc_recovery(p_rpc_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_key text := '__rpc_health:' || lower(trim(coalesce(p_rpc_name,'')));
  v_runtime bigint := private.rpc_runtime_version();
  v_value jsonb;
  v_status text;
  v_version bigint;
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_rpc_name IS NULL OR p_rpc_name !~ '^[a-zA-Z0-9_]{1,120}$' THEN RAISE EXCEPTION 'INVALID_RPC_NAME'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT value INTO v_value FROM public.global_settings WHERE key=v_key FOR UPDATE;
  IF v_value IS NULL THEN RETURN true; END IF;

  v_status := v_value->>'status';
  v_version := NULLIF(v_value->>'backend_version','')::bigint;

  IF v_status <> 'BLOCKED' OR v_version IS NULL OR v_version >= v_runtime THEN
    RETURN v_status IS DISTINCT FROM 'PROBING';
  END IF;

  UPDATE public.global_settings
  SET value = jsonb_build_object(
    'status','PROBING',
    'backend_version',v_runtime,
    'previous_error_code',v_value->>'error_code',
    'previous_error_message',v_value->>'error_message',
    'probe_started_at',now()
  ), updated_at=now()
  WHERE key=v_key;

  RETURN true;
END;
$function$;

-- create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)
CREATE OR REPLACE FUNCTION public.create_collective_registration_order(p_competition_id uuid, p_roster_student_ids uuid[], p_competition_level_id uuid, p_certificate_policy text, p_school_id uuid, p_school_name text, p_contact_name text, p_contact_whatsapp text, p_payment_method_id uuid, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_uid uuid:=auth.uid(); v_existing public.collective_registrations%rowtype; v_quote jsonb; v_comp public.competitions%rowtype; v_method public.organizer_payment_methods%rowtype; v_reg public.collective_registrations%rowtype; v_order public.orders%rowtype; v_status public.order_status; v_proof_status text; v_payment_method text; begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if; if p_idempotency_key is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if; select * into v_existing from public.collective_registrations where teacher_user_id=v_uid and idempotency_key=p_idempotency_key limit 1; if found then select * into v_order from public.orders where id=v_existing.order_id; return jsonb_build_object('registration_id',v_existing.id,'order_id',v_existing.order_id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'student_count',v_existing.student_count,'certificate_policy',v_existing.certificate_policy,'order_status',v_order.status,'idempotent',true); end if; perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||p_competition_id::text||':collective_registration',0)); select * into v_existing from public.collective_registrations where teacher_user_id=v_uid and idempotency_key=p_idempotency_key limit 1; if found then select * into v_order from public.orders where id=v_existing.order_id; return jsonb_build_object('registration_id',v_existing.id,'order_id',v_existing.order_id,'status',v_existing.status,'amount',v_existing.amount,'currency',v_existing.currency,'student_count',v_existing.student_count,'certificate_policy',v_existing.certificate_policy,'order_status',v_order.status,'idempotent',true); end if; select * into v_comp from public.competitions c where c.id=p_competition_id; if not found then raise exception 'COMPETITION_NOT_FOUND'; end if; v_quote:=public.quote_collective_registration(p_competition_id,p_roster_student_ids,p_certificate_policy); if p_competition_level_id is not null and not exists(select 1 from public.competition_levels cl where cl.id=p_competition_level_id and cl.competition_id=p_competition_id) then raise exception 'INVALID_COMPETITION_LEVEL'; end if; if (v_quote->>'total')::numeric>0 then
  select * into v_method from public.organizer_payment_methods m where m.id=p_payment_method_id and m.is_active=true;
  if not found then raise exception 'PAYMENT_METHOD_REQUIRED'; end if;
  if coalesce(v_method.details->>'global_gateway','false')='true' then
    if not exists(select 1 from public.payment_gateway_state s where s.id=true and s.automatic_payments_enabled=true and s.active_provider in ('MIDTRANS','XENITHPAY')) then
      raise exception 'GLOBAL_GATEWAY_NOT_ACTIVE';
    end if;
  else
    if upper(coalesce(v_method.payment_type,'')) not in ('BANK_TRANSFER','MANUAL_TRANSFER','QRIS','EWALLET') then raise exception 'PAYMENT_METHOD_NOT_SUPPORTED'; end if;
    if nullif(trim(coalesce(p_proof_url,'')),'') is null or p_proof_url !~* '^https?://' then raise exception 'PAYMENT_PROOF_REQUIRED'; end if;
  end if;
end if; v_payment_method:=coalesce(v_method.name,case when (v_quote->>'total')::numeric=0 then 'FREE' else 'MANUAL_TRANSFER' end); v_status:=case when (v_quote->>'total')::numeric=0 then 'PAID'::public.order_status else 'PENDING_PAYMENT'::public.order_status end; v_proof_status:=case when nullif(trim(coalesce(p_proof_url,'')),'') is null then 'NOT_SUBMITTED' else 'SUBMITTED' end; insert into public.collective_registrations(competition_id,teacher_user_id,school_id,school_name,competition_level_id,certificate_policy,roster_student_ids,student_count,status,amount,currency,idempotency_key,payment_method_id,metadata) values(p_competition_id,v_uid,p_school_id,nullif(trim(p_school_name),''),p_competition_level_id,p_certificate_policy,coalesce(p_roster_student_ids,'{}'::uuid[]),(v_quote->>'student_count')::integer,case when v_status='PAID' then 'PAID' else 'PENDING_PAYMENT' end,(v_quote->>'total')::numeric,coalesce(v_quote->>'currency','IDR'),p_idempotency_key,p_payment_method_id,jsonb_build_object('source','guru_collective_registration','competition_id',p_competition_id,'teacher_user_id',v_uid,'certificate_policy',p_certificate_policy)); select * into v_reg from public.collective_registrations where teacher_user_id=v_uid and idempotency_key=p_idempotency_key; insert into public.orders(user_id,status,subtotal,discount,shipping_cost,total,currency,contact_whatsapp,payment_method,payment_provider,payment_proof_url,payment_proof_public_id,payment_proof_width,payment_proof_height,payment_proof_version,payment_proof_resource_type,payment_proof_status,contact_name,contact_email,contact_note,contact_fields,payment_method_id) values(v_uid,v_status,(v_quote->>'subtotal')::numeric,0,0,(v_quote->>'total')::numeric,coalesce(v_quote->>'currency','IDR'),nullif(trim(p_contact_whatsapp),''),v_payment_method,case when v_status='PAID' then 'FREE' when coalesce(v_method.details->>'global_gateway','false')='true' then 'GLOBAL' else 'MANUAL' end,nullif(trim(p_proof_url),''),nullif(trim(p_proof_public_id),''),p_proof_width,p_proof_height,p_proof_version,p_proof_resource_type,v_proof_status,nullif(trim(p_contact_name),''),null,null,jsonb_build_object('collective_registration_id',v_reg.id,'competition_id',p_competition_id,'teacher_user_id',v_uid,'certificate_policy',p_certificate_policy,'roster_student_ids',to_jsonb(coalesce(p_roster_student_ids,'{}'::uuid[]))),p_payment_method_id) returning * into v_order; insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata) values(v_order.id,'COLLECTIVE_REGISTRATION',p_competition_id,'Pendaftaran Kolektif — '||v_comp.title,(v_quote->>'student_count')::integer,(v_quote->>'unit_price')::numeric,(v_quote->>'total')::numeric,jsonb_build_object('collective_registration_id',v_reg.id,'competition_id',p_competition_id,'teacher_user_id',v_uid,'roster_student_ids',to_jsonb(coalesce(p_roster_student_ids,'{}'::uuid[])),'competition_level_id',p_competition_level_id,'certificate_policy',p_certificate_policy)); update public.collective_registrations set order_id=v_order.id,updated_at=now() where id=v_reg.id returning * into v_reg; return jsonb_build_object('registration_id',v_reg.id,'order_id',v_order.id,'status',v_reg.status,'amount',v_order.total,'currency',v_order.currency,'student_count',v_reg.student_count,'certificate_policy',v_reg.certificate_policy,'order_status',v_order.status,'payment_method',v_order.payment_method,'idempotent',false); end; $function$;

-- create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])
CREATE OR REPLACE FUNCTION public.create_shop_collective_certificate_order_with_vouchers(p_certificate_id uuid, p_shop_product_id uuid, p_payment_method text, p_proof_url text, p_proof_public_id text, p_proof_width integer, p_proof_height integer, p_proof_version text, p_proof_resource_type text, p_whatsapp text, p_voucher_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_effects jsonb;
  v_total_discount numeric;
  v_line_discount numeric;
  v_shipping_discount numeric;
  v_one_time_ids uuid[];
  v_voucher_ids uuid[];
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from public.commerce_products p
    where p.id=p_shop_product_id and p.product_type::text='COLLECTIVE_CERTIFICATE' and p.is_active=true
  ) then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  v_order := public.create_collective_certificate_order_with_proof(
    p_certificate_id,p_payment_method,p_proof_url,p_proof_public_id,
    p_proof_width,p_proof_height,p_proof_version,p_proof_resource_type,p_whatsapp
  );

  -- The existing certificate checkout can reuse a pending gateway order. Clear any prior voucher reservation
  -- and discount metadata before calculating this attempt, so retries cannot stack stale discounts.
  update public.shop_user_vouchers uv set
    status='READY',reserved_order_id=null,reserved_at=null
  where uv.reserved_order_id=v_order.id and uv.status='RESERVED';

  update public.order_items oi set
    line_total=oi.unit_price*oi.quantity,
    metadata=coalesce(oi.metadata,'{}'::jsonb)-'shop_voucher_ids'-'shop_voucher_discount'-'shop_voucher_breakdown'
  where oi.order_id=v_order.id;

  update public.orders o set
    discount=0,
    total=coalesce(o.subtotal,0)+coalesce(o.shipping_cost,0),
    updated_at=now()
  where o.id=v_order.id
  returning * into v_order;

  v_effects := private.calculate_shop_voucher_effects(
    auth.uid(),p_shop_product_id,1,v_order.subtotal,v_order.shipping_cost,coalesce(p_voucher_ids,'{}'::uuid[])
  );
  v_total_discount := coalesce((v_effects->>'total_discount')::numeric,0);
  v_line_discount := coalesce((v_effects->>'line_discount')::numeric,0);
  v_shipping_discount := coalesce((v_effects->>'shipping_discount')::numeric,0);

  select coalesce(array_agg(value::uuid),'{}') into v_one_time_ids
    from jsonb_array_elements_text(v_effects->'one_time_ids') as x(value);
  select coalesce(array_agg(value::uuid),'{}') into v_voucher_ids
    from jsonb_array_elements_text(v_effects->'voucher_ids') as x(value);

  if cardinality(v_voucher_ids)>0 then
    update public.order_items oi set
      line_total=greatest(0,oi.line_total-v_line_discount),
      metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
        'shop_voucher_ids',to_jsonb(v_voucher_ids),
        'shop_voucher_discount',v_total_discount,
        'shop_voucher_breakdown',v_effects
      )
    where oi.order_id=v_order.id;

    if cardinality(v_one_time_ids)>0 then
      update public.shop_user_vouchers uv set
        status='RESERVED',reserved_order_id=v_order.id,reserved_at=now()
      where uv.id=any(v_one_time_ids) and uv.user_id=auth.uid() and uv.status='READY';
      if not found then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
    end if;

    update public.orders o set
      discount=coalesce(o.discount,0)+v_total_discount,
      shipping_cost=greatest(0,coalesce(o.shipping_cost,0)-v_shipping_discount),
      total=greatest(0,coalesce(o.total,0)-v_total_discount),
      updated_at=now()
    where o.id=v_order.id returning * into v_order;

    perform private.write_audit('commerce.shop_voucher_reserved','order',v_order.id::text,
      'Shop voucher discount reserved for collective certificate order',null,to_jsonb(v_order),null);
  end if;

  -- Keep the certificate-specific order record aligned even when a reused pending
  -- order is checked out again without a voucher after a previous discounted attempt.
  update public.collective_certificate_orders cco
    set amount=v_order.total,updated_at=now()
  where cco.order_id=v_order.id;

  return v_order;
end;
$function$;

-- create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])
CREATE OR REPLACE FUNCTION public.create_shop_product_order_with_edu_coin_vouchers(p_product_id uuid, p_quantity integer DEFAULT 1, p_whatsapp text DEFAULT NULL::text, p_target_organizer_id uuid DEFAULT NULL::uuid, p_voucher_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_effects jsonb;
  v_total_discount numeric;
  v_line_discount numeric;
  v_shipping_discount numeric;
  v_one_time_ids uuid[];
  v_voucher_ids uuid[];
  v_balance_after bigint;
  v_final_total numeric;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_order := public.create_product_order_with_edu_coin(
    p_product_id,p_quantity,p_whatsapp,p_target_organizer_id
  );
  v_effects := private.calculate_shop_voucher_effects(
    auth.uid(),p_product_id,p_quantity,v_order.subtotal,v_order.shipping_cost,coalesce(p_voucher_ids,'{}'::uuid[])
  );
  v_total_discount := coalesce((v_effects->>'total_discount')::numeric,0);
  v_line_discount := coalesce((v_effects->>'line_discount')::numeric,0);
  v_shipping_discount := coalesce((v_effects->>'shipping_discount')::numeric,0);
  select coalesce(array_agg(value::uuid),'{}') into v_one_time_ids
    from jsonb_array_elements_text(v_effects->'one_time_ids') as x(value);
  select coalesce(array_agg(value::uuid),'{}') into v_voucher_ids
    from jsonb_array_elements_text(v_effects->'voucher_ids') as x(value);

  if cardinality(v_voucher_ids)>0 then
    v_final_total := greatest(0,v_order.total-v_total_discount);
    if v_total_discount > 0 then
      update public.profiles p set edu_coin=coalesce(p.edu_coin,0)+v_total_discount::bigint,updated_at=clock_timestamp()
        where p.id=auth.uid()
        returning p.edu_coin into v_balance_after;
      if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
      update public.edu_coin_ledger
        set amount=-v_final_total::bigint,
            reason='Pembelian Shop dengan Edu Coin setelah voucher: '||v_order.id::text
      where user_id=auth.uid() and event_type='SHOP_EDU_COIN_SPEND' and event_id=v_order.id::text;
      update public.orders o set discount=coalesce(o.discount,0)+v_total_discount,
        shipping_cost=greatest(0,coalesce(o.shipping_cost,0)-v_shipping_discount),
        total=v_final_total,updated_at=clock_timestamp()
      where o.id=v_order.id returning * into v_order;
      update public.order_items oi set
        line_total=greatest(0,oi.line_total-v_line_discount),
        metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
          'shop_voucher_ids',to_jsonb(v_voucher_ids),
          'shop_voucher_discount',v_total_discount,
          'shop_voucher_breakdown',v_effects
        )
      where oi.order_id=v_order.id;
      update public.notifications n set data=jsonb_set(
        jsonb_set(coalesce(n.data,'{}'::jsonb),'{edu_coin_spent}',to_jsonb(v_final_total),true),
        '{edu_coin_balance}',to_jsonb(v_balance_after),true
      )
      where n.user_id=auth.uid() and n.data->>'order_id'=v_order.id::text;
    else
      update public.order_items oi set metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
        'shop_voucher_ids',to_jsonb(v_voucher_ids),
        'shop_voucher_discount',0,
        'shop_voucher_breakdown',v_effects
      ) where oi.order_id=v_order.id;
    end if;
    if cardinality(v_one_time_ids)>0 then
      update public.shop_user_vouchers uv set
        status='USED',used_at=now(),used_order_id=v_order.id
      where uv.id=any(v_one_time_ids) and uv.user_id=auth.uid() and uv.status='READY';
      if not found then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
    end if;
    perform private.write_audit('commerce.shop_voucher_redeemed','order',v_order.id::text,
      'Shop voucher redeemed in Edu Coin checkout',null,to_jsonb(v_order),null);
  end if;
  return v_order;
end;
$function$;

-- create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])
CREATE OR REPLACE FUNCTION public.create_shop_product_order_with_vouchers(p_product_id uuid, p_quantity integer DEFAULT 1, p_whatsapp text DEFAULT NULL::text, p_payment_method text DEFAULT 'MANUAL_TRANSFER'::text, p_proof_url text DEFAULT NULL::text, p_proof_public_id text DEFAULT NULL::text, p_proof_width integer DEFAULT NULL::integer, p_proof_height integer DEFAULT NULL::integer, p_proof_version text DEFAULT NULL::text, p_proof_resource_type text DEFAULT NULL::text, p_target_organizer_id uuid DEFAULT NULL::uuid, p_voucher_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order public.orders%rowtype;
  v_effects jsonb;
  v_total_discount numeric;
  v_line_discount numeric;
  v_shipping_discount numeric;
  v_one_time_ids uuid[];
  v_voucher_ids uuid[];
  v_reward_definition_id uuid;
  v_reward_definition public.shop_voucher_definitions%rowtype;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select nullif(p.metadata->>'shop_voucher_definition_id','')::uuid
    into v_reward_definition_id
  from public.commerce_products p
  where p.id=p_product_id and p.product_type::text='VOUCHER' and p.is_active=true;
  if found then
    select * into v_reward_definition
    from public.shop_voucher_definitions d
    where d.id=v_reward_definition_id
      and d.is_active=true
      and d.starts_at<=now()
      and (d.ends_at is null or d.ends_at>now())
    for share;
    if not found then raise exception 'SHOP_VOUCHER_REWARD_NOT_AVAILABLE'; end if;
  end if;
  v_order := public.create_product_order_with_proof(
    p_product_id,p_quantity,p_whatsapp,p_payment_method,p_proof_url,p_proof_public_id,
    p_proof_width,p_proof_height,p_proof_version,p_proof_resource_type,p_target_organizer_id
  );
  if v_reward_definition_id is not null then
    update public.order_items oi set
      metadata=jsonb_set(
        coalesce(oi.metadata,'{}'::jsonb),
        '{shop_metadata}',
        coalesce(oi.metadata->'shop_metadata','{}'::jsonb)
          || jsonb_build_object('shop_voucher_definition_snapshot',to_jsonb(v_reward_definition)),
        true
      )
    where oi.order_id=v_order.id and oi.product_type::text='VOUCHER';
    if not found then raise exception 'SHOP_VOUCHER_ORDER_ITEM_MISSING'; end if;
  end if;
  v_effects := private.calculate_shop_voucher_effects(
    auth.uid(),p_product_id,p_quantity,v_order.subtotal,v_order.shipping_cost,coalesce(p_voucher_ids,'{}'::uuid[])
  );
  v_total_discount := coalesce((v_effects->>'total_discount')::numeric,0);
  v_line_discount := coalesce((v_effects->>'line_discount')::numeric,0);
  v_shipping_discount := coalesce((v_effects->>'shipping_discount')::numeric,0);
  select coalesce(array_agg(value::uuid),'{}') into v_one_time_ids
    from jsonb_array_elements_text(v_effects->'one_time_ids') as x(value);
  select coalesce(array_agg(value::uuid),'{}') into v_voucher_ids
    from jsonb_array_elements_text(v_effects->'voucher_ids') as x(value);

  if cardinality(v_voucher_ids)>0 then
    update public.order_items oi set
      line_total=greatest(0,oi.line_total-v_line_discount),
      metadata=coalesce(oi.metadata,'{}'::jsonb) || jsonb_build_object(
        'shop_voucher_ids',to_jsonb(v_voucher_ids),
        'shop_voucher_discount',v_total_discount,
        'shop_voucher_breakdown',v_effects
      )
    where oi.order_id=v_order.id;

    if cardinality(v_one_time_ids)>0 then
      update public.shop_user_vouchers uv set
        status='RESERVED',reserved_order_id=v_order.id,reserved_at=now()
      where uv.id=any(v_one_time_ids) and uv.user_id=auth.uid() and uv.status='READY';
      if not found then raise exception 'SHOP_VOUCHER_NOT_AVAILABLE'; end if;
    end if;

    update public.orders o set
      discount=coalesce(o.discount,0)+v_total_discount,
      shipping_cost=greatest(0,coalesce(o.shipping_cost,0)-v_shipping_discount),
      total=greatest(0,coalesce(o.total,0)-v_total_discount),
      updated_at=now()
    where o.id=v_order.id returning * into v_order;
    perform private.write_audit('commerce.shop_voucher_reserved','order',v_order.id::text,
      'Shop voucher discount reserved until payment is confirmed',null,to_jsonb(v_order),null);
  end if;
  return v_order;
end;
$function$;

-- ensure_referral_code()
CREATE OR REPLACE FUNCTION public.ensure_referral_code()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare u uuid:=auth.uid();existing text;candidate text;n int:=0;begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
 if u is null then raise exception 'AUTHORIZATION_REQUIRED';end if;select code into existing from public.referral_codes where user_id=u;if existing is not null then return existing;end if;loop candidate:=upper(substr(replace(u::text,'-',''),1,8));if n>0 then candidate:=candidate||upper(substr(md5(u::text||n::text),1,4));end if;begin insert into public.referral_codes(user_id,code) values(u,candidate);return candidate;exception when unique_violation then n:=n+1;if n>10 then raise exception 'REFERRAL_CODE_GENERATION_FAILED';end if;end;end loop;end;$function$;

-- get_collective_registration(uuid)
CREATE OR REPLACE FUNCTION public.get_collective_registration(p_registration_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  RETURN (
  select jsonb_build_object('registration_id',cr.id,'competition_id',cr.competition_id,'school_id',cr.school_id,'school_name',cr.school_name,'competition_level_id',cr.competition_level_id,'certificate_policy',cr.certificate_policy,'student_count',cr.student_count,'status',cr.status,'order_id',cr.order_id,'amount',cr.amount,'currency',cr.currency,'order_status',o.status,'payment_proof_status',o.payment_proof_status,'payment_method',o.payment_method,'created_at',cr.created_at,'updated_at',cr.updated_at) from public.collective_registrations cr left join public.orders o on o.id=cr.order_id where cr.id=p_registration_id and cr.teacher_user_id=(select auth.uid())
  );
END;
$function$;

-- get_daily_checkin_streak_rewards(date)
CREATE OR REPLACE FUNCTION public.get_daily_checkin_streak_rewards(p_date date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_result jsonb;
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF p_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'DAILY_REWARD_DATE_MUST_BE_TODAY';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'day_number', day_number,
        'reward_type', reward_data ->> 'reward_type',
        'reward_amount', coalesce((reward_data ->> 'reward_amount')::numeric, 0),
        'coin_amount', coalesce((reward_data ->> 'coin_amount')::numeric, 0),
        'sparkle', coalesce((reward_data ->> 'sparkle')::boolean, false)
      )
      ORDER BY day_number
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM generate_series(1, 7) AS days(day_number)
  CROSS JOIN LATERAL (
    SELECT public.resolve_daily_checkin_reward(p_date, day_number) AS reward_data
  ) resolved;

  RETURN v_result;
END;
$function$;

-- get_linear_exam_state(uuid)
CREATE OR REPLACE FUNCTION public.get_linear_exam_state(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

-- get_organizer_exam_preview_report(uuid)
CREATE OR REPLACE FUNCTION public.get_organizer_exam_preview_report(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
  v_runtime public.exam_attempt_runtime%rowtype;
  v_comp public.competitions%rowtype;
  v_answered integer := 0;
  v_skipped integer := 0;
  v_timeout integer := 0;
  v_max_score numeric := 0;
  v_manual integer := 0;
  v_questions jsonb := '[]'::jsonb;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and is_preview = true and preview_owner_id = v_uid;
  if not found then raise exception 'PREVIEW_NOT_FOUND'; end if;

  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id;
  if not found or v_runtime.phase <> 'COMPLETED' then
    raise exception 'PREVIEW_NOT_COMPLETED';
  end if;

  select * into v_comp from public.competitions where id = v_attempt.competition_id;

  select
    count(*) filter (
      where q.state = 'ANSWERED'
        and coalesce((private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json)->>'has_answer')::boolean, false)
    ),
    count(*) filter (
      where (q.state = 'SKIPPED' and coalesce(q.transition_reason, '') <> 'TIMEOUT')
         or (q.state = 'ANSWERED'
             and not coalesce((private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json)->>'has_answer')::boolean, false))
    ),
    count(*) filter (where q.state = 'TIMEOUT' or q.transition_reason = 'TIMEOUT'),
    coalesce(sum(q.points_snapshot), 0)
  into v_answered, v_skipped, v_timeout, v_max_score
  from public.exam_attempt_questions q
  left join public.answers a
    on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id;

  select count(*) into v_manual
  from public.exam_attempt_questions q
  left join public.answers a
    on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id
    and q.state = 'ANSWERED'
    and coalesce((private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json)->>'has_answer')::boolean, false)
    and (
      lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('file_upload')
      or (
        lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('essay','long_answer')
        and not (
          coalesce(q.answer_key_snapshot->>'ai_assessment_enabled','false') = 'true'
          and coalesce(q.answer_key_snapshot->>'answer_key','') <> ''
          and exists (
            select 1
            from public.organizer_plans op
            join public.plan_entitlements pe on pe.plan_code = op.plan_code
            where op.organizer_id = v_comp.organizer_id
              and op.is_active = true
              and op.starts_at <= clock_timestamp()
              and (op.ends_at is null or op.ends_at > clock_timestamp())
              and pe.capability = 'essay_ai_assessment'
              and coalesce(pe.limit_value,0) > 0
          )
        )
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'position', q.position,
    'state', q.state,
    'points', q.points_snapshot,
    'question', q.question_snapshot,
    'answer', coalesce(a.answer_json, '{}'::jsonb),
    'evaluation', private.evaluate_linear_preview_answer(q.state, q.transition_reason, q.question_snapshot, q.answer_key_snapshot, a.answer_json),
    'answer_key', q.answer_key_snapshot,
    'manual_review_required',
      (lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('file_upload'))
      or (
        lower(replace(coalesce(q.question_snapshot->>'type',''),'-','_')) in ('essay','long_answer')
        and not (
          coalesce(q.answer_key_snapshot->>'ai_assessment_enabled','false') = 'true'
          and coalesce(q.answer_key_snapshot->>'answer_key','') <> ''
          and exists (
            select 1
            from public.organizer_plans op
            join public.plan_entitlements pe on pe.plan_code = op.plan_code
            where op.organizer_id = v_comp.organizer_id
              and op.is_active = true
              and op.starts_at <= clock_timestamp()
              and (op.ends_at is null or op.ends_at > clock_timestamp())
              and pe.capability = 'essay_ai_assessment'
              and coalesce(pe.limit_value,0) > 0
          )
        )
      )
  ) order by q.position), '[]'::jsonb)
  into v_questions
  from public.exam_attempt_questions q
  left join public.answers a
    on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'competition_id', v_attempt.competition_id,
    'competition_title', v_comp.title,
    'attempt_status', v_attempt.status,
    'score', v_attempt.score,
    'maximum_score', v_max_score,
    'answered_count', v_answered,
    'skipped_count', v_skipped,
    'timeout_count', v_timeout,
    'manual_review_count', v_manual,
    'questions', v_questions,
    'completed_at', v_attempt.submitted_at
  );
end;
$function$;

-- get_organizer_payment_config()
CREATE OR REPLACE FUNCTION public.get_organizer_payment_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v jsonb;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select value into v from public.global_settings where key='organizer_payment_config';
  return coalesce(v,jsonb_build_object(
    'mode','MANUAL_TRANSFER',
    'manual',jsonb_build_object('bank_name','','account_number','','account_name','','instructions',''),
    'midtrans',jsonb_build_object('environment','sandbox','client_key','')
  ));
end; $function$;

-- get_referral_program_settings_v2()
CREATE OR REPLACE FUNCTION public.get_referral_program_settings_v2()
 RETURNS TABLE(is_active boolean, reward_amount integer, base_reward_amount integer, event_reward_amount integer, event_name text, event_description text, starts_at timestamp with time zone, ends_at timestamp with time zone, is_event_active boolean, is_available boolean, milestone_tiers jsonb, promo_is_enabled boolean, promo_title text, promo_description text, promo_badge text, promo_cta text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_settings private.referral_program_settings%ROWTYPE;
  v_now timestamptz := statement_timestamp();
  v_event_active boolean;
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  SELECT s.*
    INTO v_settings
  FROM private.referral_program_settings s
  WHERE s.id = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFERRAL_SETTINGS_NOT_CONFIGURED';
  END IF;

  v_event_active := v_settings.is_active
    AND v_settings.event_reward_amount IS NOT NULL
    AND (v_settings.starts_at IS NULL OR v_now >= v_settings.starts_at)
    AND (v_settings.ends_at IS NULL OR v_now < v_settings.ends_at);

  RETURN QUERY
  SELECT
    v_settings.is_active,
    CASE WHEN v_event_active THEN v_settings.event_reward_amount ELSE v_settings.base_reward_amount END,
    v_settings.base_reward_amount,
    v_settings.event_reward_amount,
    v_settings.event_name,
    v_settings.event_description,
    v_settings.starts_at,
    v_settings.ends_at,
    v_event_active,
    v_settings.is_active,
    v_settings.milestone_tiers,
    v_settings.promo_is_enabled,
    v_settings.promo_title,
    v_settings.promo_description,
    v_settings.promo_badge,
    v_settings.promo_cta;
END;
$function$;

-- get_referral_program_settings()
CREATE OR REPLACE FUNCTION public.get_referral_program_settings()
 RETURNS TABLE(is_active boolean, reward_amount integer, base_reward_amount integer, event_reward_amount integer, event_name text, event_description text, starts_at timestamp with time zone, ends_at timestamp with time zone, is_event_active boolean, is_available boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_settings private.referral_program_settings%ROWTYPE;
  v_now timestamptz := statement_timestamp();
  v_event_active boolean;
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  SELECT s.*
    INTO v_settings
  FROM private.referral_program_settings s
  WHERE s.id = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REFERRAL_SETTINGS_NOT_CONFIGURED';
  END IF;

  v_event_active := v_settings.is_active
    AND v_settings.event_reward_amount IS NOT NULL
    AND (v_settings.starts_at IS NULL OR v_now >= v_settings.starts_at)
    AND (v_settings.ends_at IS NULL OR v_now < v_settings.ends_at);

  RETURN QUERY
  SELECT
    v_settings.is_active,
    CASE WHEN v_event_active THEN v_settings.event_reward_amount ELSE v_settings.base_reward_amount END,
    v_settings.base_reward_amount,
    v_settings.event_reward_amount,
    v_settings.event_name,
    v_settings.event_description,
    v_settings.starts_at,
    v_settings.ends_at,
    v_event_active,
    v_settings.is_active;
END;
$function$;

-- join_organizer(text,text)
CREATE OR REPLACE FUNCTION public.join_organizer(p_slug text, p_access_code text)
 RETURNS TABLE(organizer_id uuid, name text, slug text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ declare v_uid uuid:=auth.uid(); v_org public.organizers; v_code text:=regexp_replace(coalesce(p_access_code,''),'[^a-fA-F0-9]','','g'); v_role text; begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if; select * into v_org from public.organizers o where (lower(o.slug)=lower(trim(p_slug)) or lower(o.name)=lower(trim(p_slug))) and o.status='ACTIVE' limit 1; if not found then raise exception 'ORGANIZER_NOT_FOUND'; end if; if not exists(select 1 from private.organizer_access_codes ac where ac.organizer_id=v_org.id and crypt(v_code,ac.code_hash)=ac.code_hash) then raise exception 'INVALID_ACCESS_CODE'; end if; insert into public.organizer_members(organizer_id,user_id,member_role,is_active,role,status) values(v_org.id,v_uid,'editor',true,'editor','ACTIVE') on conflict(organizer_id,user_id) do update set is_active=true,status='ACTIVE',role=case when public.organizer_members.role='owner' then 'owner' else 'editor' end,member_role=case when public.organizer_members.member_role='owner' then 'owner' else 'editor' end,updated_at=now(); select coalesce(om.role,om.member_role) into v_role from public.organizer_members om where om.organizer_id=v_org.id and om.user_id=v_uid; return query select v_org.id,v_org.name,v_org.slug,v_role; end; $function$;

-- list_claimable_organizer_vouchers()
CREATE OR REPLACE FUNCTION public.list_claimable_organizer_vouchers()
 RETURNS TABLE(id uuid, code text, title text, description text, benefit_type text, discount_percent numeric, free_plan_code text, free_duration_days integer, target_plan_codes text[], target_billing_periods text[], starts_at timestamp with time zone, ends_at timestamp with time zone, max_uses integer, claim_count integer, used_count integer, claimed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_org uuid;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select o.id into v_org from public.organizers o where o.owner_user_id=auth.uid() or exists(select 1 from public.organizer_members m where m.organizer_id=o.id and m.user_id=auth.uid() and m.is_active=true) order by o.created_at limit 1;
  if v_org is null then return; end if;
  return query
  select v.id,v.code,v.title,v.description,v.benefit_type,v.discount_percent,v.free_plan_code,v.free_duration_days,v.target_plan_codes,v.target_billing_periods,v.starts_at,v.ends_at,v.max_uses,v.claim_count,v.used_count,exists(select 1 from public.organizer_voucher_claims c where c.voucher_id=v.id and c.organizer_id=v_org and c.status in ('CLAIMED','USED'))
  from public.organizer_vouchers v
  where v.is_active=true
    and (v.starts_at is null or v.starts_at<=now())
    and (v.ends_at is null or v.ends_at>=now())
    and (v.claim_count<v.max_uses or exists(select 1 from public.organizer_voucher_claims c2 where c2.voucher_id=v.id and c2.organizer_id=v_org and c2.status='CLAIMED'));
end; $function$;

-- list_shop_checkout_vouchers(uuid,integer,numeric,numeric)
CREATE OR REPLACE FUNCTION public.list_shop_checkout_vouchers(p_product_id uuid, p_quantity integer DEFAULT 1, p_subtotal numeric DEFAULT 0, p_shipping_cost numeric DEFAULT 0)
 RETURNS TABLE(id uuid, name text, description text, usage_type text, benefit_group text, benefit_type text, discount_value numeric, discount_currency text, status text, eligible boolean, reason text, auto_applied boolean, estimated_discount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.commerce_products%rowtype;
  v_group_active text[];
  v_auto_ids uuid[] := '{}';
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then raise exception 'INVALID_QUANTITY'; end if;
  select * into v_product from public.commerce_products p
    where p.id=p_product_id and p.is_active=true;
  if not found then raise exception 'PRODUCT_NOT_AVAILABLE'; end if;

  select coalesce(array_agg(chosen.id),'{}'::uuid[]) into v_auto_ids
  from (
    select distinct on (d.benefit_group) uv.id, d.benefit_group
    from public.shop_user_vouchers uv
    join public.shop_voucher_definitions d on d.id=uv.definition_id
    where uv.user_id=auth.uid() and d.usage_type='DURATION' and uv.status='ACTIVE'
      and uv.active_until > now() and d.is_active=true
      and (d.ends_at is null or d.ends_at > now())
      and d.starts_at <= now()
      and private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id)
      and p_subtotal >= d.min_purchase
      and (d.benefit_type <> 'FIXED' or d.discount_currency=v_product.currency)
      and (d.benefit_type <> 'FREE_SHIPPING' or p_shipping_cost > 0)
      and (d.benefit_type <> 'BUY_X_GET_Y' or p_quantity >= d.buy_quantity+d.free_quantity)
    order by d.benefit_group, uv.issued_at desc, uv.id
  ) chosen;

  select coalesce(array_agg(distinct d.benefit_group),'{}') into v_group_active
  from public.shop_user_vouchers uv
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  where uv.id=any(v_auto_ids);

  return query
  select uv.id,d.name,d.description,d.usage_type,d.benefit_group,d.benefit_type,d.discount_value,d.discount_currency,
    case
      when uv.status='USED' then 'USED'
      when uv.status='RESERVED' then 'RESERVED'
      when (uv.status='ACTIVE' and uv.active_until <= now()) or (d.ends_at is not null and d.ends_at <= now()) then 'EXPIRED'
      when uv.status='ACTIVE' and uv.activated_at > now() then 'READY'
      when uv.status='ACTIVE' then 'ACTIVE'
      else uv.status
    end,
    case
      when not d.is_active then false
      when d.starts_at > now() then false
      when d.ends_at is not null and d.ends_at <= now() then false
      when d.usage_type='DURATION' and (uv.status <> 'ACTIVE' or uv.active_until <= now() or not (uv.id=any(v_auto_ids))) then false
      when d.usage_type='SINGLE_USE' and uv.status <> 'READY' then false
      when not private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id) then false
      when p_subtotal < d.min_purchase then false
      when d.benefit_type='FIXED' and d.discount_currency <> v_product.currency then false
      when d.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0 then false
      when d.benefit_type='BUY_X_GET_Y' and p_quantity < d.buy_quantity+d.free_quantity then false
      when d.usage_type='SINGLE_USE' and d.benefit_group=any(v_group_active) then false
      else true
    end,
    case
      when not d.is_active then 'Voucher tidak lagi tersedia'
      when d.starts_at > now() then 'Voucher belum mulai berlaku'
      when d.ends_at is not null and d.ends_at <= now() then 'Voucher sudah kedaluwarsa'
      when d.usage_type='DURATION' and (uv.status <> 'ACTIVE' or uv.active_until <= now()) then 'Masa aktif voucher sudah habis'
      when d.usage_type='DURATION' and not (uv.id=any(v_auto_ids)) then 'Voucher durasi sejenis sudah aktif'
      when d.usage_type='SINGLE_USE' and uv.status='RESERVED' then 'Voucher sedang dipakai pada pesanan lain'
      when d.usage_type='SINGLE_USE' and uv.status='USED' then 'Voucher sudah digunakan'
      when d.usage_type='SINGLE_USE' and uv.status <> 'READY' then 'Voucher belum tersedia'
      when not private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id) then 'Produk ini tidak termasuk ketentuan voucher'
      when p_subtotal < d.min_purchase then 'Belum memenuhi minimum pembelian'
      when d.benefit_type='FIXED' and d.discount_currency <> v_product.currency then 'Mata uang produk tidak sesuai'
      when d.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0 then 'Produk ini tidak memiliki biaya pengiriman'
      when d.benefit_type='BUY_X_GET_Y' and p_quantity < d.buy_quantity+d.free_quantity then 'Jumlah produk belum memenuhi promo'
      when d.usage_type='SINGLE_USE' and d.benefit_group=any(v_group_active) then 'Manfaat sejenis sudah diterapkan otomatis'
      else 'Dapat digunakan'
    end,
    d.usage_type='DURATION' and uv.id=any(v_auto_ids)
      and uv.status='ACTIVE' and uv.active_until > now()
      and d.is_active and d.starts_at <= now() and (d.ends_at is null or d.ends_at > now())
      and private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id)
      and p_subtotal >= d.min_purchase
      and (d.benefit_type <> 'FIXED' or d.discount_currency=v_product.currency)
      and (d.benefit_type <> 'FREE_SHIPPING' or p_shipping_cost > 0)
      and (d.benefit_type <> 'BUY_X_GET_Y' or p_quantity >= d.buy_quantity+d.free_quantity),
    case
      when not d.is_active or d.starts_at > now() or (d.ends_at is not null and d.ends_at <= now())
        or (d.usage_type='DURATION' and (uv.status <> 'ACTIVE' or uv.active_until <= now() or not (uv.id=any(v_auto_ids))))
        or (d.usage_type='SINGLE_USE' and uv.status <> 'READY')
        or not private.shop_voucher_scope_matches(d.scope_type,d.product_ids,d.category_ids,p_product_id)
        or p_subtotal < d.min_purchase or (d.benefit_type='FIXED' and d.discount_currency <> v_product.currency)
        or (d.benefit_type='FREE_SHIPPING' and p_shipping_cost <= 0)
        or (d.benefit_type='BUY_X_GET_Y' and p_quantity < d.buy_quantity+d.free_quantity)
        or (d.usage_type='SINGLE_USE' and d.benefit_group=any(v_group_active))
      then 0::numeric
      when d.benefit_type='PERCENT' then
        case when v_product.currency='EDU_COIN'
          then trunc(least(p_subtotal,p_subtotal*d.discount_value/100))
          else round(least(p_subtotal,p_subtotal*d.discount_value/100),2)
        end
      when d.benefit_type='FIXED' then least(p_subtotal,d.discount_value)
      when d.benefit_type='BUY_X_GET_Y' then floor(p_quantity::numeric/(d.buy_quantity+d.free_quantity))*d.free_quantity*(p_subtotal/p_quantity)
      when d.benefit_type='FREE_SHIPPING' then p_shipping_cost
      else 0::numeric
    end
  from public.shop_user_vouchers uv
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  where uv.user_id=auth.uid()
  order by uv.issued_at desc;
end;
$function$;

-- list_teacher_collective_participants(uuid)
CREATE OR REPLACE FUNCTION public.list_teacher_collective_participants(p_competition_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(participant_id uuid, competition_id uuid, competition_title text, roster_student_id uuid, participant_code text, full_name text, class_name text, grade text, photo_url text, status text, enabled boolean, password_version integer, last_login_at timestamp with time zone, created_at timestamp with time zone, attempt_status text, score numeric, attempt_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  RETURN QUERY
  select cp.id,cp.competition_id,c.title,cp.roster_student_id,cp.participant_code,cp.full_name,cp.class_name,cp.grade,cp.photo_url,
      cp.status,pac.enabled,pac.password_version,pac.last_login_at,cp.created_at,
      a.status::text,a.score,a.expires_at
    from public.collective_participants cp
    join public.competitions c on c.id=cp.competition_id
    left join public.participant_access_credentials pac on pac.collective_participant_id=cp.id
    left join lateral (
      select a1.status,a1.score,a1.expires_at from public.attempts a1
      where a1.collective_participant_id=cp.id order by a1.created_at desc limit 1
    ) a on true
    where cp.managed_by_user_id=auth.uid() and (p_competition_id is null or cp.competition_id=p_competition_id)
    order by cp.created_at desc;
END;
$function$;

-- mark_rpc_healthy(text)
CREATE OR REPLACE FUNCTION public.mark_rpc_healthy(p_rpc_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_key text := '__rpc_health:' || lower(trim(coalesce(p_rpc_name,'')));
  v_value jsonb;
  v_runtime bigint := private.rpc_runtime_version();
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_rpc_name IS NULL OR p_rpc_name !~ '^[a-zA-Z0-9_]{1,120}$' THEN RAISE EXCEPTION 'INVALID_RPC_NAME'; END IF;
  SELECT value INTO v_value FROM public.global_settings WHERE key=v_key FOR UPDATE;
  IF v_value IS NULL OR v_value->>'status' <> 'PROBING' THEN RETURN false; END IF;
  UPDATE public.global_settings
  SET value=jsonb_build_object('status','OPEN','backend_version',v_runtime,'recovered_at',now()), updated_at=now()
  WHERE key=v_key;
  RETURN true;
END;
$function$;

-- provision_collective_registration(uuid)
CREATE OR REPLACE FUNCTION public.provision_collective_registration(p_registration_id uuid)
 RETURNS TABLE(participant_id uuid, participant_code text, temporary_password text, full_name text, class_name text, grade text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare v_uid uuid:=auth.uid();v_reg public.collective_registrations%rowtype;r record;v_password text;v_pi uuid;v_portal public.collective_portal_credentials%rowtype;v_pac public.participant_access_credentials%rowtype;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 select * into v_reg from public.collective_registrations where id=p_registration_id and teacher_user_id=v_uid for update;
 if not found then raise exception 'FORBIDDEN';end if;
 if v_reg.status not in ('PAID','PROVISIONED') then raise exception 'REGISTRATION_NOT_READY';end if;
 perform private.provision_collective_registration(p_registration_id);
 for r in select cp.id,cp.participant_code,cp.full_name,cp.class_name,cp.grade,cp.photo_url,cp.roster_student_id,pac.id pac_id,pac.password_version,pac.enabled from public.collective_participants cp left join public.participant_access_credentials pac on pac.collective_participant_id=cp.id where cp.registration_id=p_registration_id and cp.managed_by_user_id=v_uid and cp.status='ACTIVE' order by cp.created_at loop
  select id into v_pi from public.collective_portal_identities where owner_user_id=v_uid and roster_student_id=r.roster_student_id;
  if v_pi is null then insert into public.collective_portal_identities(roster_student_id,owner_user_id,school_id) select r.roster_student_id,v_uid,cp.school_id from public.collective_participants cp where cp.id=r.id returning id into v_pi;end if;
  select * into v_portal from public.collective_portal_credentials where portal_identity_id=v_pi for update;
  v_password:='';
  if v_portal.id is null then
    v_password:='SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
    insert into public.collective_portal_credentials(portal_identity_id,password_hash,password_lookup_key,password_version,failed_attempts,locked_until,enabled)
    values(v_pi,crypt(v_password,gen_salt('bf',12)),encode(digest(left(v_password,8),'sha256'),'hex'),1,0,null,true) returning * into v_portal;
  elsif not v_portal.enabled then
    v_password:='SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
    update public.collective_portal_credentials set password_hash=crypt(v_password,gen_salt('bf',12)),password_lookup_key=encode(digest(left(v_password,8),'sha256'),'hex'),password_version=password_version+1,failed_attempts=0,locked_until=null,enabled=true,updated_at=now() where id=v_portal.id returning * into v_portal;
    update public.collective_portal_sessions set revoked_at=coalesce(revoked_at,now()) where portal_identity_id=v_pi and revoked_at is null;
  end if;
  if r.pac_id is null then
    insert into public.participant_access_credentials(collective_participant_id,password_hash,password_version,failed_attempts,locked_until,enabled) values(r.id,v_portal.password_hash,v_portal.password_version,0,null,true);
  elsif not r.enabled then
    update public.participant_access_credentials set password_hash=v_portal.password_hash,password_version=v_portal.password_version,failed_attempts=0,locked_until=null,enabled=true,updated_at=now() where id=r.pac_id;
  end if;
  participant_id:=r.id;participant_code:=r.participant_code;temporary_password:=v_password;full_name:=r.full_name;class_name:=r.class_name;grade:=r.grade;photo_url:=r.photo_url;return next;
 end loop;
 update public.collective_registrations set status='PROVISIONED',updated_at=now() where id=v_reg.id and status='PAID';
end $function$;

-- regenerate_collective_participant_password(uuid)
CREATE OR REPLACE FUNCTION public.regenerate_collective_participant_password(p_participant_id uuid)
 RETURNS TABLE(participant_code text, temporary_password text, password_version integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare v_uid uuid:=auth.uid(); cp public.collective_participants%rowtype; v_old integer; v_new integer; raw text; pi_id uuid;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
 select * into cp from public.collective_participants where id=p_participant_id and managed_by_user_id=v_uid and status='ACTIVE' for update;
 if not found then raise exception 'FORBIDDEN'; end if;
 select pac.password_version into v_old from public.participant_access_credentials pac where pac.collective_participant_id=p_participant_id for update;
 if v_old is null then raise exception 'ACCESS_NOT_READY'; end if;
 raw:='SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12)); v_new:=v_old+1;
 update public.participant_access_credentials set password_hash=crypt(raw,gen_salt('bf',12)),password_version=v_new,failed_attempts=0,locked_until=null,enabled=true,updated_at=now() where collective_participant_id=p_participant_id;
 select id into pi_id from public.collective_portal_identities where owner_user_id=cp.managed_by_user_id and roster_student_id=cp.roster_student_id;
 if pi_id is null then insert into public.collective_portal_identities(roster_student_id,owner_user_id,school_id) values(cp.roster_student_id,cp.managed_by_user_id,cp.school_id) returning id into pi_id; end if;
 insert into public.collective_portal_credentials(portal_identity_id,password_hash,password_lookup_key,password_version,failed_attempts,locked_until,enabled)
 values(pi_id,crypt(raw,gen_salt('bf',12)),encode(digest(left(raw,8),'sha256'),'hex'),v_new,0,null,true)
 on conflict(portal_identity_id) do update set password_hash=excluded.password_hash,password_lookup_key=excluded.password_lookup_key,password_version=excluded.password_version,failed_attempts=0,locked_until=null,enabled=true,updated_at=now();
 update public.collective_portal_sessions set revoked_at=coalesce(revoked_at,now()) where portal_identity_id=pi_id and revoked_at is null;
 update public.collective_access_sessions set revoked_at=coalesce(revoked_at,now()) where collective_participant_id=p_participant_id and revoked_at is null;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,before_data,after_data) values(v_uid,'COLLECTIVE_CREDENTIAL_REGENERATED','collective_participant',p_participant_id::text,jsonb_build_object('password_version',v_old),jsonb_build_object('password_version',v_new,'previous_credential_invalidated',true));
 participant_code:=cp.participant_code;temporary_password:=raw;password_version:=v_new;return next;
end $function$;

-- register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)
CREATE OR REPLACE FUNCTION public.register_for_competition_with_integrity_and_coin_bypass(p_competition_id uuid, p_participation_key text, p_competition_level_id uuid, p_social_proof_url text, p_social_platform text, p_social_username text, p_referral_code text, p_integrity_agreed boolean, p_edu_coin_bypass boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_bypass boolean := coalesce(p_edu_coin_bypass, false);
  v_balance_before bigint;
  v_balance_after bigint;
  v_registration public.registrations;
  v_competition_title text;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if v_user_id is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;
  if p_integrity_agreed is not true then
    raise exception 'INTEGRITY_AGREEMENT_REQUIRED';
  end if;

  if not v_bypass and (
    nullif(trim(coalesce(p_social_proof_url, '')), '') is null
    or nullif(regexp_replace(trim(coalesce(p_social_username, '')), '^@+', ''), '') is null
    or nullif(lower(trim(coalesce(p_social_platform, ''))), '') is null
  ) then
    raise exception 'SOCIAL_PROOF_OR_COIN_REQUIRED';
  end if;

  if v_bypass then
    -- Serialize spends on the wallet row to prevent simultaneous requests
    -- from using the same 100 Edu Coin twice.
    select coalesce(p.edu_coin, 0)
      into v_balance_before
    from public.profiles p
    where p.id = v_user_id
    for update;

    if not found then
      raise exception 'PROFILE_NOT_FOUND';
    end if;
    if v_balance_before < 100 then
      raise exception 'INSUFFICIENT_EDU_COIN'
        using detail = jsonb_build_object(
          'required', 100,
          'balance', v_balance_before
        )::text;
    end if;

    perform set_config('app.registration_coin_bypass', 'true', true);
  else
    perform set_config('app.registration_coin_bypass', 'false', true);
  end if;

  select c.title
    into v_competition_title
  from public.competitions c
  where c.id = p_competition_id;

  -- A valid username + URL is the participant's confirmation that the
  -- Twibbon/repost requirement has been completed. The alternative is the
  -- explicitly selected, paid Edu Coin bypass.
  v_registration := public.register_for_competition(
    p_competition_id,
    p_participation_key,
    p_competition_level_id,
    case when v_bypass then null else p_social_proof_url end,
    not v_bypass,
    case when v_bypass then null else p_social_platform end,
    case when v_bypass then null else regexp_replace(trim(coalesce(p_social_username, '')), '^@+', '') end,
    p_referral_code
  );

  if v_bypass then
    update public.profiles
      set edu_coin = coalesce(edu_coin, 0) - 100,
          updated_at = clock_timestamp()
    where id = v_user_id
      and coalesce(edu_coin, 0) >= 100
    returning edu_coin into v_balance_after;

    if not found then
      raise exception 'INSUFFICIENT_EDU_COIN';
    end if;

    insert into public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    values (
      v_user_id,
      'COMPETITION_REGISTRATION_BYPASS',
      v_registration.id::text,
      -100,
      'Skip Twibbon dan bukti repost untuk ' || coalesce(v_competition_title, p_competition_id::text)
    );
  end if;

  update public.registrations
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'integrity_agreed', true,
        'integrity_agreed_at', clock_timestamp(),
        'integrity_version', 'SYKA-COMPETITION-2026-01',
        'edu_coin_bypass', v_bypass,
        'edu_coin_bypass_amount', case when v_bypass then 100 else 0 end,
        'edu_coin_bypass_event_type', case when v_bypass then 'COMPETITION_REGISTRATION_BYPASS' else null end
      ),
      updated_at = clock_timestamp()
  where id = v_registration.id
  returning * into v_registration;

  return jsonb_build_object(
    'registration', to_jsonb(v_registration),
    'edu_coin_balance', case when v_bypass then v_balance_after else null end,
    'edu_coin_spent', case when v_bypass then 100 else 0 end,
    'edu_coin_bypass', v_bypass
  );
end;
$function$;

-- register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)
CREATE OR REPLACE FUNCTION public.register_for_competition_with_integrity(p_competition_id uuid, p_participation_key text DEFAULT NULL::text, p_competition_level_id uuid DEFAULT NULL::uuid, p_social_proof_url text DEFAULT NULL::text, p_twibbon_completed boolean DEFAULT false, p_social_platform text DEFAULT NULL::text, p_social_username text DEFAULT NULL::text, p_referral_code text DEFAULT NULL::text, p_integrity_agreed boolean DEFAULT false)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_registration public.registrations;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;
  if p_integrity_agreed is not true then
    raise exception 'INTEGRITY_AGREEMENT_REQUIRED';
  end if;

  v_registration := public.register_for_competition(
    p_competition_id,
    p_participation_key,
    p_competition_level_id,
    p_social_proof_url,
    p_twibbon_completed,
    p_social_platform,
    p_social_username,
    p_referral_code
  );

  update public.registrations
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'integrity_agreed', true,
        'integrity_agreed_at', clock_timestamp(),
        'integrity_version', 'SYKA-COMPETITION-2026-01'
      ),
      updated_at = clock_timestamp()
  where id = v_registration.id
  returning * into v_registration;

  return v_registration;
end;
$function$;

-- report_competition_comment(uuid,text)
CREATE OR REPLACE FUNCTION public.report_competition_comment(p_comment_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_report_id uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if v_uid is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;
  if p_comment_id is null then
    raise exception 'COMMENT_REQUIRED';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 200 then
    raise exception 'REPORT_REASON_INVALID';
  end if;
  if not exists (
    select 1 from public.comments c
    where c.id = p_comment_id
      and c.moderation_state in ('PUBLISHED', 'VISIBLE')
      and c.user_id <> v_uid
  ) then
    raise exception 'COMMENT_NOT_REPORTABLE';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_comment_id::text), hashtext(v_uid::text));

  if exists (
    select 1 from public.comment_reports cr
    where cr.comment_id = p_comment_id
      and cr.reporter_user_id = v_uid
      and cr.status in ('OPEN', 'REVIEWED')
  ) then
    raise exception 'COMMENT_ALREADY_REPORTED';
  end if;

  insert into public.comment_reports(comment_id, reporter_user_id, reason, status)
  values (p_comment_id, v_uid, v_reason, 'OPEN')
  returning id into v_report_id;

  return v_report_id;
end;
$function$;

-- report_rpc_failure(text,text,text)
CREATE OR REPLACE FUNCTION public.report_rpc_failure(p_rpc_name text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  v_key text := '__rpc_health:' || lower(trim(coalesce(p_rpc_name,'')));
  v_code text := nullif(left(trim(coalesce(p_error_code,'')), 32), '');
  v_message text := nullif(left(trim(coalesce(p_error_message,'')), 1000), '');
  v_runtime bigint := private.rpc_runtime_version();
  v_existing jsonb;
  v_existing_status text;
  v_existing_version bigint;
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF p_rpc_name IS NULL OR p_rpc_name !~ '^[a-zA-Z0-9_]{1,120}$' THEN RAISE EXCEPTION 'INVALID_RPC_NAME'; END IF;
  IF v_code IS NULL OR v_code !~ '^(42|53|54|57|58|XX|08)' THEN
    RETURN jsonb_build_object('status','IGNORED','reason','NON_GLOBAL_ERROR');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  SELECT value INTO v_existing FROM public.global_settings WHERE key=v_key FOR UPDATE;
  v_existing_status := v_existing->>'status';
  v_existing_version := NULLIF(v_existing->>'backend_version','')::bigint;

  IF v_existing_status='BLOCKED' AND v_existing_version=v_runtime THEN
    RETURN v_existing || jsonb_build_object('status','BLOCKED','backend_version',v_runtime);
  END IF;

  INSERT INTO public.global_settings(key, value)
  VALUES (
    v_key,
    jsonb_build_object(
      'status','BLOCKED',
      'backend_version',v_runtime,
      'error_code',v_code,
      'error_message',v_message,
      'failed_at',now()
    )
  )
  ON CONFLICT (key) DO UPDATE SET
    value=excluded.value,
    updated_at=now();

  RETURN (SELECT value FROM public.global_settings WHERE key=v_key);
END;
$function$;

-- report_system_error(text,text,text,text,jsonb,text,text)
CREATE OR REPLACE FUNCTION public.report_system_error(p_source text, p_error_code text DEFAULT NULL::text, p_error_message text DEFAULT NULL::text, p_severity text DEFAULT 'error'::text, p_context jsonb DEFAULT '{}'::jsonb, p_path text DEFAULT NULL::text, p_fingerprint text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_source text := lower(trim(coalesce(p_source, 'other')));
  v_severity text := lower(trim(coalesce(p_severity, 'error')));
  v_code text := nullif(left(trim(coalesce(p_error_code, '')), 64), '');
  v_message text := nullif(left(trim(coalesce(p_error_message, '')), 2000), '');
  v_path text := nullif(left(trim(coalesce(p_path, '')), 500), '');
  v_fingerprint text := nullif(left(trim(coalesce(p_fingerprint, '')), 128), '');
  v_context jsonb := case when jsonb_typeof(coalesce(p_context, '{}'::jsonb)) = 'object' then p_context else '{}'::jsonb end;
  v_id uuid;
  v_existing_status text;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_source not in ('rpc','realtime','edge_function','cloudinary','frontend','network','database','other') then v_source := 'other'; end if;
  if v_severity not in ('info','warning','error','critical') then v_severity := 'error'; end if;
  if v_message is null then v_message := 'Unknown system error'; end if;

  if v_fingerprint is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_fingerprint, 0));
  end if;

  select id, status into v_id, v_existing_status
  from public.system_error_events
  where fingerprint = v_fingerprint
    and v_fingerprint is not null
    and status in ('new','investigating')
  order by last_seen_at desc
  limit 1
  for update;

  if v_id is not null then
    update public.system_error_events
       set last_seen_at = now(),
           occurred_at = now(),
           occurrence_count = occurrence_count + 1,
           error_code = coalesce(v_code, error_code),
           error_message = v_message,
           context = v_context,
           path = coalesce(v_path, path),
           severity = case
             when v_severity = 'critical' or severity = 'critical' then 'critical'
             when v_severity = 'error' or severity = 'error' then 'error'
             when v_severity = 'warning' or severity = 'warning' then 'warning'
             else 'info'
           end
     where id = v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'grouped', true);
  end if;

  insert into public.system_error_events(
    source, severity, error_code, error_message, context, user_id, path, fingerprint,
    status, occurrence_count, first_seen_at, last_seen_at
  )
  values (
    v_source, v_severity, v_code, v_message, v_context, v_uid, v_path, v_fingerprint,
    'new', 1, now(), now()
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'grouped', false);
end;
$function$;

-- resolve_linear_exam_timeout(uuid)
CREATE OR REPLACE FUNCTION public.resolve_linear_exam_timeout(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id,clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

-- save_linear_exam_draft(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.save_linear_exam_draft(p_attempt_id uuid, p_question_id uuid, p_answer_json jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_attempt public.attempts%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_attempt from public.attempts where id = p_attempt_id for update;
  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase = 'COMPLETED' or v_attempt.status <> 'IN_PROGRESS' then raise exception 'EXAM_NOT_ACTIVE'; end if;
  if v_runtime.phase not in ('ACTIVE','GRACE') then raise exception 'QUESTION_NOT_ANSWERABLE'; end if;

  select * into v_question
  from public.exam_attempt_questions
  where attempt_id = p_attempt_id and position = v_runtime.current_position
  for update;
  v_now := clock_timestamp();
  if v_question.question_id <> p_question_id then raise exception 'EXAM_QUESTION_CHANGED'; end if;
  if v_runtime.phase = 'ACTIVE' and (v_question.question_deadline is null or v_now >= v_question.question_deadline) then raise exception 'QUESTION_TIMEOUT'; end if;
  if v_runtime.phase = 'GRACE' and (v_question.grace_deadline is null or v_now >= v_question.grace_deadline) then raise exception 'QUESTION_TIMEOUT'; end if;
  if jsonb_typeof(coalesce(p_answer_json, '{}'::jsonb)) <> 'object' or pg_column_size(coalesce(p_answer_json, '{}'::jsonb)) > 50000 then raise exception 'INVALID_ANSWER_PAYLOAD'; end if;
  if not (
    nullif(btrim(coalesce(p_answer_json->>'value','')), '') is not null
    or (jsonb_typeof(p_answer_json->'values') = 'array' and jsonb_array_length(p_answer_json->'values') > 0)
    or nullif(btrim(coalesce(p_answer_json->>'url','')), '') is not null
    or nullif(btrim(coalesce(p_answer_json->>'text','')), '') is not null
  ) then
    delete from public.answers where attempt_id = p_attempt_id and question_id = v_question.question_id;
  else
    insert into public.answers(attempt_id, question_id, answer_json, saved_at, updated_at)
    values (p_attempt_id, v_question.question_id, p_answer_json, v_now, v_now)
    on conflict (attempt_id, question_id)
    do update set answer_json = excluded.answer_json, saved_at = excluded.saved_at, updated_at = excluded.updated_at;
  end if;

  perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'ANSWER_DRAFT_SAVED', 'PARTICIPANT', '{}'::jsonb, v_now);
  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

-- set_collective_participant_password(uuid,text)
CREATE OR REPLACE FUNCTION public.set_collective_participant_password(p_participant_id uuid, p_password text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  caller uuid := auth.uid();
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if caller is null then raise exception 'UNAUTHENTICATED'; end if;
  if length(coalesce(p_password,'')) < 8 or length(p_password) > 128 then raise exception 'PASSWORD_POLICY'; end if;
  if not exists (select 1 from public.collective_participants cp where cp.id=p_participant_id and cp.managed_by_user_id=caller) then raise exception 'FORBIDDEN'; end if;
  insert into public.participant_access_credentials(collective_participant_id,password_hash,password_version,failed_attempts,locked_until,enabled,updated_at)
  values (p_participant_id, crypt(p_password, gen_salt('bf', 12)), 1, 0, null, true, now())
  on conflict (collective_participant_id) do update set password_hash=excluded.password_hash,password_version=participant_access_credentials.password_version+1,failed_attempts=0,locked_until=null,enabled=true,updated_at=now();
end;
$function$;

-- skip_linear_exam_question(uuid)
CREATE OR REPLACE FUNCTION public.skip_linear_exam_question(p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_runtime public.exam_attempt_runtime%rowtype;
  v_question public.exam_attempt_questions%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  perform private.assert_individual_linear_exam_access(p_attempt_id);
  perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);

  select * into v_runtime from public.exam_attempt_runtime where attempt_id = p_attempt_id for update;
  if v_runtime.phase not in ('ACTIVE','GRACE') then return private.build_linear_exam_state(p_attempt_id); end if;
  select * into v_question from public.exam_attempt_questions where attempt_id=p_attempt_id and position=v_runtime.current_position for update;
  v_now := clock_timestamp();

  if (v_runtime.phase = 'ACTIVE' and (v_question.question_deadline is null or v_now >= v_question.question_deadline))
    or (v_runtime.phase = 'GRACE' and (v_question.grace_deadline is null or v_now >= v_question.grace_deadline)) then
    perform private.resolve_linear_exam_timeouts(p_attempt_id, v_now);
    return private.build_linear_exam_state(p_attempt_id);
  end if;

  delete from public.answers where attempt_id = p_attempt_id and question_id = v_question.question_id;
  perform private.log_linear_exam_event(p_attempt_id, v_question.position, v_question.question_id, 'QUESTION_SKIPPED', 'PARTICIPANT', jsonb_build_object('reason', 'PARTICIPANT_SKIP'), v_now);
  perform private.advance_linear_exam_question(p_attempt_id, v_now, 'SKIPPED', 0, 'PARTICIPANT_SKIP', 'PARTICIPANT');
  perform private.resolve_linear_exam_timeouts(p_attempt_id, clock_timestamp());
  return private.build_linear_exam_state(p_attempt_id);
end;
$function$;

-- start_linear_exam_attempt(uuid)
CREATE OR REPLACE FUNCTION public.start_linear_exam_attempt(p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_attempt public.attempts%rowtype;
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  select * into v_attempt
  from public.attempts a
  where a.competition_id = p_competition_id and a.participant_id = v_uid and a.status = 'IN_PROGRESS'
  order by a.created_at desc
  limit 1;

  if found then
    if not exists (select 1 from public.exam_attempt_runtime r where r.attempt_id = v_attempt.id) then
      if exists (select 1 from public.answers x where x.attempt_id = v_attempt.id) then
        raise exception 'LEGACY_ATTEMPT_REQUIRES_REVIEW';
      end if;
      update public.attempts set started_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_attempt.id returning * into v_attempt;
      perform private.prepare_linear_exam_runtime(v_attempt.id);
      return private.build_linear_exam_state(v_attempt.id);
    end if;
    perform private.resolve_linear_exam_timeouts(v_attempt.id, clock_timestamp());
    return private.build_linear_exam_state(v_attempt.id);
  end if;

  select a.* into v_attempt
  from public.attempts a
  join public.exam_attempt_runtime r on r.attempt_id = a.id and r.phase = 'COMPLETED'
  where a.competition_id = p_competition_id and a.participant_id = v_uid
  order by a.created_at desc
  limit 1;

  if found then return private.build_linear_exam_state(v_attempt.id); end if;

  select * into v_attempt from public.start_competition_attempt(p_competition_id);
  perform private.prepare_linear_exam_runtime(v_attempt.id);
  return private.build_linear_exam_state(v_attempt.id);
end;
$function$;

-- sync_collective_registration_order_payment(uuid)
CREATE OR REPLACE FUNCTION public.sync_collective_registration_order_payment(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ declare v_uid uuid:=auth.uid(); v_status public.order_status; v_reg public.collective_registrations%rowtype; begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
 if v_uid is null then raise exception 'AUTH_REQUIRED'; end if; select o.status into v_status from public.orders o where o.id=p_order_id and o.user_id=v_uid; if v_status is null then raise exception 'ORDER_NOT_FOUND'; end if; if v_status<>'PAID' then return false; end if; select * into v_reg from public.collective_registrations where order_id=p_order_id and teacher_user_id=v_uid for update; if not found then raise exception 'COLLECTIVE_REGISTRATION_NOT_FOUND'; end if; perform private.provision_collective_registration(v_reg.id); return true; end; $function$;

-- validate_organizer_voucher(text,text,text)
CREATE OR REPLACE FUNCTION public.validate_organizer_voucher(p_code text, p_plan_code text DEFAULT NULL::text, p_billing_period text DEFAULT NULL::text)
 RETURNS TABLE(is_valid boolean, discount_percent numeric, benefit_type text, free_plan_code text, free_duration_days integer, voucher_id uuid, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v public.organizer_vouchers;
  v_plan text := upper(trim(p_plan_code));
  v_period text := upper(trim(p_billing_period));
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then
    return query select false, 0::numeric, null::text, null::text, null::integer, null::uuid, 'Login diperlukan.';
    return;
  end if;

  select ov.* into v
  from public.organizer_vouchers ov
  where ov.code = upper(trim(p_code));

  if v.id is null then
    return query select false, 0::numeric, null::text, null::text, null::integer, null::uuid, 'Voucher tidak ditemukan.';
    return;
  end if;

  if not v.is_active
     or (v.starts_at is not null and v.starts_at > now())
     or (v.ends_at is not null and v.ends_at < now()) then
    return query select false, 0::numeric, v.benefit_type, v.free_plan_code, v.free_duration_days, v.id, 'Voucher sedang tidak berlaku.';
    return;
  end if;

  if v.used_count >= v.max_uses then
    return query select false, 0::numeric, v.benefit_type, v.free_plan_code, v.free_duration_days, v.id, 'Voucher sudah habis digunakan.';
    return;
  end if;

  if coalesce(array_length(v.target_plan_codes, 1), 0) > 0
     and (v_plan is null or not v_plan = any(v.target_plan_codes)) then
    return query select false, 0::numeric, v.benefit_type, v.free_plan_code, v.free_duration_days, v.id,
      format('Voucher hanya bisa digunakan untuk paket %s.', array_to_string(v.target_plan_codes, ' atau '));
    return;
  end if;

  if coalesce(array_length(v.target_billing_periods, 1), 0) > 0
     and p_billing_period is not null
     and not v_period = any(v.target_billing_periods) then
    return query select false, 0::numeric, v.benefit_type, v.free_plan_code, v.free_duration_days, v.id,
      format('Voucher hanya bisa digunakan untuk periode %s.', array_to_string(v.target_billing_periods, ' atau '));
    return;
  end if;

  if v.benefit_type = 'FREE_PLAN'
     and v.free_plan_code is not null
     and v_plan is not null
     and upper(v.free_plan_code) <> v_plan then
    return query select false, 0::numeric, v.benefit_type, v.free_plan_code, v.free_duration_days, v.id,
      format('Voucher hanya bisa digunakan untuk paket %s.', upper(v.free_plan_code));
    return;
  end if;

  return query select true, v.discount_percent, v.benefit_type, v.free_plan_code, v.free_duration_days, v.id, 'Voucher bisa digunakan.';
end;
$function$;

-- validate_organizer_voucher(text)
CREATE OR REPLACE FUNCTION public.validate_organizer_voucher(p_code text)
 RETURNS TABLE(is_valid boolean, discount_percent numeric, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_voucher public.organizer_vouchers;
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_code = '' then return query select false, 0::numeric, 'Kode voucher wajib diisi.'::text; return; end if;
  if v_code !~ '^SYKA[A-Z0-9]{11}$' then return query select false, 0::numeric, 'Format voucher tidak valid.'::text; return; end if;

  select * into v_voucher from public.organizer_vouchers where code = v_code;
  if not found or not v_voucher.is_active then
    return query select false, 0::numeric, 'Voucher tidak ditemukan atau sudah tidak aktif.'::text;
    return;
  end if;
  if v_voucher.used_count >= v_voucher.max_uses then
    return query select false, 0::numeric, 'Voucher sudah digunakan.'::text;
    return;
  end if;

  return query select true, v_voucher.discount_percent, 'Voucher valid.'::text;
end;
$function$;

DO $user_rpc_postflight$
DECLARE
  v_count integer;
  v_missing text;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN unnest(ARRAY[
    'public.answer_linear_exam_question(uuid,uuid,jsonb,boolean)',
    'public.choose_linear_exam_timeout(uuid,text)',
    'public.claim_collective_participant(text,text)',
    'public.claim_rpc_recovery(text)',
    'public.create_collective_registration_order(uuid,uuid[],uuid,text,uuid,text,text,text,uuid,text,text,integer,integer,text,text,uuid)',
    'public.create_shop_collective_certificate_order_with_vouchers(uuid,uuid,text,text,text,integer,integer,text,text,text,uuid[])',
    'public.create_shop_product_order_with_edu_coin_vouchers(uuid,integer,text,uuid,uuid[])',
    'public.create_shop_product_order_with_vouchers(uuid,integer,text,text,text,text,integer,integer,text,text,uuid,uuid[])',
    'public.ensure_referral_code()',
    'public.get_collective_registration(uuid)',
    'public.get_daily_checkin_streak_rewards(date)',
    'public.get_linear_exam_state(uuid)',
    'public.get_organizer_exam_preview_report(uuid)',
    'public.get_organizer_payment_config()',
    'public.get_referral_program_settings()',
    'public.get_referral_program_settings_v2()',
    'public.join_organizer(text,text)',
    'public.list_claimable_organizer_vouchers()',
    'public.list_shop_checkout_vouchers(uuid,integer,numeric,numeric)',
    'public.list_teacher_collective_participants(uuid)',
    'public.mark_rpc_healthy(text)',
    'public.provision_collective_registration(uuid)',
    'public.regenerate_collective_participant_password(uuid)',
    'public.register_for_competition_with_integrity(uuid,text,uuid,text,boolean,text,text,text,boolean)',
    'public.register_for_competition_with_integrity_and_coin_bypass(uuid,text,uuid,text,text,text,text,boolean,boolean)',
    'public.report_competition_comment(uuid,text)',
    'public.report_rpc_failure(text,text,text)',
    'public.report_system_error(text,text,text,text,jsonb,text,text)',
    'public.resolve_linear_exam_timeout(uuid)',
    'public.save_linear_exam_draft(uuid,uuid,jsonb)',
    'public.set_collective_participant_password(uuid,text)',
    'public.skip_linear_exam_question(uuid)',
    'public.start_linear_exam_attempt(uuid)',
    'public.sync_collective_registration_order_payment(uuid)',
    'public.validate_organizer_voucher(text)',
    'public.validate_organizer_voucher(text,text,text)'
  ]::text[]) AS expected(signature)
    ON p.oid=pg_catalog.to_regprocedure(expected.signature)
  WHERE p.prosecdef
    AND pg_catalog.strpos(p.prosrc, 'private.current_user_is_better_auth()') > 0;
  IF v_count <> 36 THEN
    RAISE EXCEPTION 'STAGE3_USER_RPC_ISSUER_GUARD_COUNT_MISMATCH: expected 36, found %', v_count;
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ')
    INTO v_missing
  FROM stage3_user_rpc_acl_snapshot old
  JOIN pg_catalog.pg_proc p ON p.oid=old.oid
  WHERE p.proowner IS DISTINCT FROM old.proowner
     OR p.prosecdef IS DISTINCT FROM old.prosecdef
     OR p.proconfig IS DISTINCT FROM old.proconfig
     OR p.proacl IS DISTINCT FROM old.proacl
     OR p.prorettype IS DISTINCT FROM old.prorettype
     OR p.proargtypes::oid[] IS DISTINCT FROM old.proargtypes;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'STAGE3_USER_RPC_FUNCTION_METADATA_OR_ACL_DRIFT:%', v_missing;
  END IF;
END;
$user_rpc_postflight$;

COMMIT;
