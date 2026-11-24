-- STAGE 3 SECURITY DEFINER ISSUER GUARD DRAFT
-- Production-only review draft; DO NOT RUN until disposable baseline/regression passes.
-- Requires docs/security/AUTH-STAGE-3-IDENTITY-ROOT-DRAFT.sql to have created private.app_users.
-- Captured from the current Production DB2 function definitions on 18 Nov 2026.
-- CREATE OR REPLACE preserves existing function signatures/defaults/owners/ACLs.
-- Legacy Supabase Auth users/profiles/roles are retained; they are not authorized as Better Auth identities.

BEGIN;

CREATE OR REPLACE FUNCTION private.current_user_is_better_auth()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT
    (SELECT auth.uid()) IS NOT NULL
    AND (SELECT auth.jwt() ->> 'iss') = 'https://auth-prod.sykabelajar.my.id/api/auth'
    AND EXISTS (
      SELECT 1 FROM private.app_users au
      WHERE au.id = (SELECT auth.uid())
        AND au.identity_origin = 'better_auth'
    );
$function$;

REVOKE ALL ON FUNCTION private.current_user_is_better_auth() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_user_is_better_auth() TO authenticated;

CREATE OR REPLACE FUNCTION private.current_user_has_role(p_role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT private.current_user_is_better_auth()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid())
        AND ur.role = p_role
        AND ur.is_active = TRUE
    );
$function$;

-- Individual exam SECURITY DEFINER entrypoints must not treat a matching
-- legacy Supabase Auth UUID as a valid participant/preview owner. The public
-- exam RPCs below call this shared helper before reading or changing attempts.

-- The collective enrollment wizard may read public competitions and those
-- private competitions the caller administers/organizes, matching the base
-- competitions_select RLS predicate. SECURITY DEFINER bypasses that policy,
-- so the same visibility and Better Auth checks must be explicit here.
CREATE OR REPLACE FUNCTION public.get_collective_registration_options(p_competition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_comp public.competitions%rowtype;
  v_rule public.registration_rules%rowtype;
  v_levels jsonb;
  v_price numeric;
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT c.*
    INTO v_comp
  FROM public.competitions AS c
  WHERE c.id = p_competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF v_comp.visibility IS DISTINCT FROM 'PUBLIC'
     AND NOT private.current_user_is_admin()
     AND (
       v_comp.organizer_id IS NULL
       OR NOT private.current_user_is_organizer_for(v_comp.organizer_id)
     ) THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF NOT private.competition_allows_collective(v_comp.participant_mode, v_comp.config) THEN
    RAISE EXCEPTION 'COMPETITION_NOT_COLLECTIVE';
  END IF;
  IF v_comp.status NOT IN ('PUBLISHED', 'REGISTRATION_OPEN') THEN
    RAISE EXCEPTION 'REGISTRATION_NOT_OPEN';
  END IF;

  SELECT rr.*
    INTO v_rule
  FROM public.registration_rules AS rr
  WHERE rr.competition_id = p_competition_id
  LIMIT 1;

  SELECT COALESCE(
    NULLIF(v_comp.config->>'collective_price_per_participant', '')::numeric,
    NULLIF(v_comp.config->>'registration_price_per_participant', '')::numeric,
    NULLIF(v_rule.config->>'collective_price_per_participant', '')::numeric,
    NULLIF(v_rule.config->>'registration_price_per_participant', '')::numeric,
    0
  )
    INTO v_price;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', cl.id,
        'code', cl.code,
        'label', cl.label,
        'allowed_grades', cl.allowed_grades,
        'points', cl.points,
        'config', cl.config
      )
      ORDER BY cl.created_at
    ),
    '[]'::jsonb
  )
    INTO v_levels
  FROM public.competition_levels AS cl
  WHERE cl.competition_id = p_competition_id;

  RETURN jsonb_build_object(
    'competition', jsonb_build_object(
      'id', v_comp.id,
      'title', v_comp.title,
      'participant_mode', v_comp.participant_mode,
      'status', v_comp.status,
      'registration_ends_at', v_comp.registration_ends_at,
      'target_grades', COALESCE(v_comp.target_grades, '{}'::text[]),
      'excluded_grades', COALESCE(v_comp.excluded_grades, '{}'::text[])
    ),
    'levels', v_levels,
    'registration_rules', CASE
      WHEN v_rule.id IS NULL THEN '{}'::jsonb
      ELSE jsonb_build_object(
        'allowed_grades', v_rule.allowed_grades,
        'minimum_participants', v_rule.minimum_participants,
        'max_participants', v_rule.max_participants,
        'effective_maximum_participants', private.competition_effective_participant_limit(p_competition_id),
        'approval_mode', v_rule.approval_mode,
        'require_twibbon', v_rule.require_twibbon,
        'require_social_proof', v_rule.require_social_proof,
        'config', v_rule.config
      )
    END,
    'participant_limits', jsonb_build_object(
      'competition_maximum_participants', v_rule.max_participants,
      'effective_maximum_participants', private.competition_effective_participant_limit(p_competition_id)
    ),
    'pricing', jsonb_build_object('unit_price', v_price, 'currency', 'IDR'),
    'certificate_policies', jsonb_build_array('EVENT_DEFAULT', 'INCLUDED', 'OPTIONAL', 'NONE')
  );
END;
$function$;

-- The collective-options RPC is not a public endpoint. CREATE OR REPLACE
-- preserves existing ACLs and PostgreSQL's default EXECUTE-to-PUBLIC behavior
-- may otherwise leave anon able to enter this issuer-gated SECURITY DEFINER
-- function. Explicitly keep only authenticated and the trusted Worker role.
DO $collective_options_acl_preflight$
DECLARE
  v_function regprocedure :=
    pg_catalog.to_regprocedure('public.get_collective_registration_options(uuid)');
  v_owner text;
  v_is_definer boolean;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'COLLECTIVE_OPTIONS_FUNCTION_MISSING';
  END IF;
  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef
    INTO v_owner, v_is_definer
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_function;
  IF v_owner IS DISTINCT FROM 'postgres' OR v_is_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'COLLECTIVE_OPTIONS_UNEXPECTED_OWNER_OR_KIND';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'COLLECTIVE_OPTIONS_TRUSTED_EXECUTE_BASELINE_MISSING';
  END IF;
END;
$collective_options_acl_preflight$;

REVOKE EXECUTE ON FUNCTION public.get_collective_registration_options(uuid)
  FROM PUBLIC, anon;

DO $collective_options_acl_postflight$
DECLARE
  v_function regprocedure :=
    pg_catalog.to_regprocedure('public.get_collective_registration_options(uuid)');
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'COLLECTIVE_OPTIONS_ANON_EXECUTE_REMAINS';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'COLLECTIVE_OPTIONS_TRUSTED_EXECUTE_MISSING';
  END IF;
END;
$collective_options_acl_postflight$;

-- Registration status sync is intentionally callable from public competition
-- pages: it only materializes timestamp-driven PUBLISHED -> REGISTRATION_OPEN
-- and REGISTRATION_OPEN -> REGISTRATION_CLOSED transitions. SECURITY DEFINER
-- must not let anon/legacy callers probe or advance a private competition.
CREATE OR REPLACE FUNCTION public.sync_competition_registration_status(p_competition_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_competition public.competitions%rowtype;
  v_status text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_competition_id IS NULL THEN
    RAISE EXCEPTION 'COMPETITION_ID_REQUIRED';
  END IF;

  SELECT c.*
    INTO v_competition
  FROM public.competitions AS c
  WHERE c.id = p_competition_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF v_competition.visibility IS DISTINCT FROM 'PUBLIC' THEN
    IF NOT private.current_user_is_better_auth() THEN
      RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
    END IF;
    IF NOT (
      private.current_user_is_admin()
      OR (
        v_competition.organizer_id IS NOT NULL
        AND private.current_user_is_organizer_for(v_competition.organizer_id)
      )
    ) THEN
      RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
    END IF;
  END IF;

  SELECT c.status::text
    INTO v_status
  FROM public.competitions AS c
  WHERE c.id = p_competition_id
    AND (
      (
        c.status = 'PUBLISHED'::public.competition_status
        AND c.registration_starts_at IS NOT NULL
        AND c.registration_starts_at <= v_now
      )
      OR
      (
        c.status = 'REGISTRATION_OPEN'::public.competition_status
        AND c.registration_ends_at IS NOT NULL
        AND c.registration_ends_at < v_now
      )
    );

  IF NOT FOUND THEN
    RETURN v_competition.status::text;
  END IF;

  SELECT c.*
    INTO v_competition
  FROM public.competitions AS c
  WHERE c.id = p_competition_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  IF v_competition.status = 'PUBLISHED'::public.competition_status
     AND v_competition.registration_starts_at IS NOT NULL
     AND v_now >= v_competition.registration_starts_at THEN
    PERFORM pg_catalog.set_config('syka.allow_competition_transition', '1', true);

    UPDATE public.competitions
    SET status = 'REGISTRATION_OPEN'::public.competition_status,
        updated_at = clock_timestamp()
    WHERE id = p_competition_id
    RETURNING * INTO v_competition;
  END IF;

  IF v_competition.status = 'REGISTRATION_OPEN'::public.competition_status
     AND v_competition.registration_ends_at IS NOT NULL
     AND v_now > v_competition.registration_ends_at THEN
    PERFORM pg_catalog.set_config('syka.allow_competition_transition', '1', true);

    UPDATE public.competitions
    SET status = 'REGISTRATION_CLOSED'::public.competition_status,
        updated_at = clock_timestamp()
    WHERE id = p_competition_id
    RETURNING * INTO v_competition;
  END IF;

  RETURN v_competition.status::text;
END;
$function$;

CREATE OR REPLACE FUNCTION private.assert_individual_linear_exam_access(p_attempt_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_attempt public.attempts%rowtype;
BEGIN
  IF v_uid IS NULL OR NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.attempts
  WHERE id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;

  IF v_attempt.is_preview THEN
    IF v_attempt.preview_owner_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;
  ELSIF v_attempt.participant_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.current_user_is_active_organizer_member(p_organizer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT private.current_user_is_better_auth()
    AND EXISTS (
      SELECT 1 FROM public.organizer_members om
      WHERE om.organizer_id = p_organizer_id
        AND om.user_id = (SELECT auth.uid())
        AND COALESCE(om.status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(om.is_active, TRUE) = TRUE
    );
$function$;

CREATE OR REPLACE FUNCTION private.current_user_organizer_role(p_organizer_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT CASE
    WHEN NOT private.current_user_is_better_auth() THEN NULL
    WHEN EXISTS (
      SELECT 1 FROM public.organizers o
      WHERE o.id = p_organizer_id AND o.owner_user_id = (SELECT auth.uid())
    ) THEN 'owner'
    ELSE (
      SELECT COALESCE(om.role, om.member_role)
      FROM public.organizer_members om
      WHERE om.organizer_id = p_organizer_id
        AND om.user_id = (SELECT auth.uid())
        AND COALESCE(om.is_active, TRUE) = TRUE
        AND COALESCE(om.status, 'ACTIVE') = 'ACTIVE'
      LIMIT 1
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION private.collective_realtime_can_read(p_competition_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT private.current_user_is_better_auth()
    AND (
      EXISTS (
        SELECT 1 FROM private.collective_chat_realtime_sessions s
        WHERE s.auth_user_id = (SELECT auth.uid())
          AND s.competition_id = p_competition_id
          AND s.expires_at > now()
      )
      OR EXISTS (
        SELECT 1 FROM public.collective_participants cp
        WHERE cp.competition_id = p_competition_id
          AND cp.managed_by_user_id = (SELECT auth.uid())
          AND cp.status = 'ACTIVE'
      )
      OR EXISTS (
        SELECT 1
        FROM public.organizer_members om
        JOIN public.competitions c ON c.organizer_id = om.organizer_id
        WHERE c.id = p_competition_id
          AND om.user_id = (SELECT auth.uid())
          AND om.is_active = TRUE
          AND om.status = 'ACTIVE'
      )
      OR private.current_user_is_admin()
    );
$function$;

CREATE OR REPLACE FUNCTION public.is_active_admin(p_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
  SELECT CASE
    WHEN NOT private.current_user_is_better_auth() OR p_uid IS NULL THEN FALSE
    WHEN p_uid <> (SELECT auth.uid()) AND NOT private.current_user_is_admin() THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN private.app_users au ON au.id = ur.user_id
      WHERE ur.user_id = p_uid
        AND ur.role = 'admin'::public.app_role
        AND ur.is_active = TRUE
        AND au.identity_origin = 'better_auth'
    )
  END;
$function$;

-- admin_adjust_user_currency
CREATE OR REPLACE FUNCTION public.admin_adjust_user_currency(p_target_user_id uuid, p_currency_type text, p_delta bigint, p_reason text DEFAULT 'Admin adjustment'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_admin_id uuid:=auth.uid();v_is_admin boolean:=false;v_column text;v_old_balance bigint:=0;v_new_balance bigint:=0;v_row jsonb; BEGIN IF p_currency_type NOT IN('xp','edu_coin') THEN RAISE EXCEPTION 'Invalid currency_type: %. Must be "xp" or "edu_coin".',p_currency_type;END IF;IF p_delta=0 THEN RAISE EXCEPTION 'Delta must not be zero.';END IF;IF trim(p_reason)='' THEN RAISE EXCEPTION 'Reason must not be empty.';END IF;SELECT private.current_user_is_admin() INTO v_is_admin;IF NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized: only admins can adjust currency.';END IF;IF p_currency_type='xp' THEN v_column:='total_xp';ELSE v_column:='edu_coin';END IF;EXECUTE format('SELECT COALESCE(%I, 0) FROM profiles WHERE id = $1 FOR UPDATE',v_column) INTO v_old_balance USING p_target_user_id;IF v_old_balance IS NULL THEN RAISE EXCEPTION 'User not found: %',p_target_user_id;END IF;v_new_balance:=v_old_balance+p_delta;IF v_new_balance<0 THEN RAISE EXCEPTION 'Insufficient %: current %, delta % would result in %.',p_currency_type,v_old_balance,p_delta,v_new_balance;END IF;EXECUTE format('UPDATE profiles SET %I = $1, updated_at = now() WHERE id = $2',v_column) USING v_new_balance,p_target_user_id;INSERT INTO currency_adjustment_logs(admin_id,target_user_id,currency_type,delta,reason,balance_before,balance_after) VALUES(v_admin_id,p_target_user_id,p_currency_type,p_delta,p_reason,v_old_balance,v_new_balance) RETURNING to_jsonb(currency_adjustment_logs.*) INTO v_row;RETURN v_row;END;$function$;

-- admin_bulk_adjust_currency
CREATE OR REPLACE FUNCTION public.admin_bulk_adjust_currency(p_user_ids uuid[], p_currency_type text, p_delta bigint, p_reason text DEFAULT 'Bulk admin adjustment'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_admin_id uuid:=auth.uid();v_is_admin boolean:=false;v_column text;v_success int:=0;v_failed int:=0;v_skipped int:=0;v_results jsonb:='[]'::jsonb;v_uid uuid;v_old bigint;v_new bigint;v_username text;v_display text; BEGIN IF p_currency_type NOT IN('xp','edu_coin') THEN RAISE EXCEPTION 'Invalid currency_type: %',p_currency_type;END IF;IF p_delta=0 THEN RAISE EXCEPTION 'Delta must not be zero.';END IF;IF trim(p_reason)='' THEN RAISE EXCEPTION 'Reason must not be empty.';END IF;IF array_length(p_user_ids,1) IS NULL OR array_length(p_user_ids,1)=0 THEN RAISE EXCEPTION 'No users selected.';END IF;SELECT private.current_user_is_admin() INTO v_is_admin;IF NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized: only admins can bulk adjust currency.';END IF;IF p_currency_type='xp' THEN v_column:='total_xp';ELSE v_column:='edu_coin';END IF;FOREACH v_uid IN ARRAY p_user_ids LOOP BEGIN EXECUTE format('SELECT COALESCE(%I, 0) FROM profiles WHERE id = $1',v_column) INTO v_old USING v_uid;IF v_old IS NULL THEN v_failed:=v_failed+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'status','not_found');CONTINUE;END IF;v_new:=v_old+p_delta;IF v_new<0 THEN v_skipped:=v_skipped+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'status','insufficient','balance',v_old);CONTINUE;END IF;EXECUTE format('UPDATE profiles SET %I = $1, updated_at = now() WHERE id = $2',v_column) USING v_new,v_uid;INSERT INTO currency_adjustment_logs(admin_id,target_user_id,currency_type,delta,reason,balance_before,balance_after) VALUES(v_admin_id,v_uid,p_currency_type,p_delta,p_reason,v_old,v_new);SELECT username,COALESCE(full_name,username,'Pengguna') INTO v_username,v_display FROM profiles WHERE id=v_uid;INSERT INTO notifications(user_id,type,title,body,data) VALUES(v_uid,'rank-up',CASE WHEN p_delta>0 THEN 'Selamat! Kamu menerima '||p_delta||' '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END ELSE 'Penyesuaian '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END||' oleh Admin' END,CASE WHEN p_delta>0 THEN 'Kamu menerima +'||p_delta||' '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END||' dari Admin. Alasan: '||p_reason ELSE 'Saldo kamu dikurangi '||abs(p_delta)||' '||CASE WHEN p_currency_type='xp' THEN 'XP' ELSE 'Coin EDU' END||' oleh Admin. Alasan: '||p_reason END,jsonb_build_object('link','/leaderboard','icon','coins'));v_success:=v_success+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'username',v_username,'status','ok','old',v_old,'new',v_new);EXCEPTION WHEN OTHERS THEN v_failed:=v_failed+1;v_results:=v_results||jsonb_build_object('user_id',v_uid,'status','error','message',SQLERRM);END;END LOOP;RETURN jsonb_build_object('success',v_success,'failed',v_failed,'skipped',v_skipped,'total',array_length(p_user_ids,1),'results',v_results);END;$function$;

-- admin_set_certificate_status
CREATE OR REPLACE FUNCTION public.admin_set_certificate_status(p_certificate_verification_id uuid, p_to_status certificate_status, p_reason text DEFAULT NULL::text)
 RETURNS certificate_verifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_before public.certificate_verifications%rowtype;v_after public.certificate_verifications%rowtype;v_cert_status public.certificate_status;
begin
 if v_uid is null or not private.current_user_is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into v_before from public.certificate_verifications where id=p_certificate_verification_id for update;
 if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 select status into v_cert_status from public.certificates where id=v_before.certificate_id for update;
 if v_cert_status is null then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 if not private.is_valid_certificate_transition(v_cert_status,p_to_status) then raise exception 'INVALID_CERTIFICATE_TRANSITION:%:%',v_cert_status,p_to_status; end if;
 if p_to_status='REVOKED' and nullif(trim(p_reason),'') is null then raise exception 'REVOCATION_REASON_REQUIRED'; end if;
 update public.certificate_verifications set status=p_to_status,revoked_at=case when p_to_status='REVOKED' then now() else null end where id=p_certificate_verification_id returning * into v_after;
 update public.certificates set status=p_to_status,updated_at=now(),current_revision=case when p_to_status=v_cert_status then current_revision else coalesce(current_revision,0)+1 end where id=v_before.certificate_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data) values(v_uid,'CERTIFICATE_STATUS_CHANGE','certificate',p_certificate_verification_id::text,p_reason,to_jsonb(v_before),to_jsonb(v_after));
 return v_after;
end;
$function$;

-- admin_set_collective_certificate_price
CREATE OR REPLACE FUNCTION public.admin_set_collective_certificate_price(p_amount numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
begin
  if auth.uid() is null or not private.current_user_is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'INVALID_AMOUNT'; end if;
  insert into public.platform_settings(key,value,updated_at)
  values('collective_certificate_price',jsonb_build_object('amount',round(p_amount,2)),now())
  on conflict(key) do update set value=excluded.value,updated_at=now();
  return round(p_amount,2);
end;
$function$;

-- admin_transition_certificate
CREATE OR REPLACE FUNCTION public.admin_transition_certificate(p_certificate_id uuid, p_to_status certificate_status, p_reason text DEFAULT NULL::text)
 RETURNS certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_before public.certificates%rowtype;v_after public.certificates%rowtype;
begin
 if v_uid is null or not private.current_user_is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into v_before from public.certificates where id=p_certificate_id for update;
 if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
 if not private.is_valid_certificate_transition(v_before.status,p_to_status) then raise exception 'INVALID_CERTIFICATE_TRANSITION:%:%',v_before.status,p_to_status; end if;
 if p_to_status='REVOKED' and nullif(trim(p_reason),'') is null then raise exception 'REVOCATION_REASON_REQUIRED'; end if;
 update public.certificates set status=p_to_status,current_revision=case when p_to_status=v_before.status then coalesce(current_revision,0) else coalesce(current_revision,0)+1 end,updated_at=now() where id=p_certificate_id returning * into v_after;
 update public.certificate_verifications set status=p_to_status,revoked_at=case when p_to_status='REVOKED' then now() else null end where certificate_id=p_certificate_id;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data) values(v_uid,'CERTIFICATE_TRANSITION','certificate',p_certificate_id::text,p_reason,to_jsonb(v_before),to_jsonb(v_after));
 return v_after;
end;
$function$;

-- admin_transition_order
CREATE OR REPLACE FUNCTION public.admin_transition_order(p_order_id uuid, p_to_status order_status, p_reason text DEFAULT NULL::text, p_tracking_number text DEFAULT NULL::text, p_provider text DEFAULT NULL::text)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_before public.orders%rowtype;v_after public.orders%rowtype;
begin
 if v_uid is null or not private.current_user_is_admin() then raise exception 'FORBIDDEN'; end if;
 select * into v_before from public.orders where id=p_order_id for update;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 if not private.is_valid_order_transition(v_before.status,p_to_status) then raise exception 'INVALID_ORDER_TRANSITION:%:%',v_before.status,p_to_status; end if;
 if p_to_status='REFUNDED' and nullif(trim(p_reason),'') is null then raise exception 'REFUND_REASON_REQUIRED'; end if;
 update public.orders set status=p_to_status,updated_at=now() where id=p_order_id returning * into v_after;
 if p_to_status='SHIPPED' then
   insert into public.shipments(order_id,provider,tracking_number,status,raw_meta) values(p_order_id,p_provider,p_tracking_number,'SHIPPED',jsonb_build_object('source','admin_transition')) on conflict(order_id) do update set provider=excluded.provider,tracking_number=excluded.tracking_number,status='SHIPPED',updated_at=now();
 end if;
 insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data) values(v_uid,'ORDER_STATUS_CHANGE','order',p_order_id::text,p_reason,to_jsonb(v_before),to_jsonb(v_after));
 return v_after;
end;
$function$;

-- auto_grade_essay_item
CREATE OR REPLACE FUNCTION public.auto_grade_essay_item(p_attempt_id uuid, p_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_uid uuid:=auth.uid();v_attempt public.attempts%ROWTYPE;v_question public.questions%ROWTYPE;v_answer public.answers%ROWTYPE;v_org uuid;v_plan text;v_key text;v_answer_text text;v_similarity numeric:=0;v_score numeric:=0;BEGIN IF NOT private.current_user_is_better_auth() THEN RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED'; END IF; IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;SELECT * INTO v_attempt FROM public.attempts WHERE id=p_attempt_id;IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';END IF;SELECT * INTO v_question FROM public.questions WHERE id=p_question_id;IF NOT FOUND OR lower(v_question.type) NOT IN('essay','long-answer') THEN RAISE EXCEPTION 'ESSAY_QUESTION_REQUIRED';END IF;SELECT organizer_id INTO v_org FROM public.competitions WHERE id=v_attempt.competition_id;IF NOT(private.current_user_is_active_organizer_member(v_org) OR private.current_user_is_admin()) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;SELECT op.plan_code INTO v_plan FROM public.organizer_plans op WHERE op.organizer_id=v_org AND op.is_active=true AND op.starts_at<=now() AND(op.ends_at IS NULL OR op.ends_at>now()) ORDER BY op.starts_at DESC,op.created_at DESC LIMIT 1;IF NOT EXISTS(SELECT 1 FROM public.plan_entitlements pe WHERE pe.plan_code=v_plan AND pe.capability='essay_ai_assessment' AND coalesce(pe.limit_value,0)>0) THEN RAISE EXCEPTION 'PREMIUM_REQUIRED';END IF;IF coalesce(v_question.config->'ai_assessment'->>'enabled','false')<>'true' THEN RAISE EXCEPTION 'AI_ASSESSMENT_DISABLED';END IF;v_key:=coalesce(v_question.config->>'answer_key','');IF v_key='' THEN RAISE EXCEPTION 'ANSWER_KEY_REQUIRED';END IF;SELECT * INTO v_answer FROM public.answers WHERE attempt_id=p_attempt_id AND question_id=p_question_id LIMIT 1;v_answer_text:=coalesce(v_answer.answer_json->>'value',v_answer.answer_json->>'answer','');v_similarity:=public.calculate_essay_similarity(v_key,v_answer_text);v_score:=round(coalesce(v_question.points,0)*v_similarity/100,2);INSERT INTO public.grading_items(attempt_id,question_id,grader_id,score,feedback) VALUES(p_attempt_id,p_question_id,v_uid,v_score,'AI Similarity Grade: '||to_char(v_similarity,'FM990D00')||'%') ON CONFLICT(attempt_id,question_id) DO UPDATE SET grader_id=excluded.grader_id,score=excluded.score,feedback=excluded.feedback,updated_at=now();RETURN jsonb_build_object('score',v_score,'max_score',coalesce(v_question.points,0),'similarity_percent',v_similarity,'feedback','AI Similarity Grade: '||to_char(v_similarity,'FM990D00')||'%');END;$function$;

-- create_collective_participants
CREATE OR REPLACE FUNCTION public.create_collective_participants(p_competition_id uuid, p_roster_student_ids uuid[])
 RETURNS TABLE(participant_id uuid, roster_student_id uuid, participant_code text, temporary_password text, full_name text, class_name text, grade text, photo_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_competition record;
  v_maximum integer;
  v_new_count integer := 0;
  v_reserved_count integer := 0;
  v_participant_id uuid;
  v_code text;
  v_password text;
  r_student record;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select c.id, c.participant_mode, c.config
  into v_competition
  from public.competitions c
  where c.id = p_competition_id
  for update;

  if not found then raise exception 'COMPETITION_NOT_FOUND'; end if;
  if not private.competition_allows_collective(v_competition.participant_mode, v_competition.config) then
    raise exception 'COMPETITION_NOT_COLLECTIVE';
  end if;
  if not (private.current_user_has_role('teacher'::public.app_role) or private.current_user_is_admin()) then
    raise exception 'FORBIDDEN';
  end if;

  if private.current_user_is_admin() then
    select rr.max_participants into v_maximum
    from public.registration_rules rr
    where rr.competition_id = p_competition_id;
  else
    v_maximum := private.competition_effective_participant_limit(p_competition_id);
  end if;

  select count(*) into v_new_count
  from (
    select distinct unnest(coalesce(p_roster_student_ids, '{}'::uuid[])) as roster_student_id
  ) requested
  join public.roster_students rs on rs.id = requested.roster_student_id
  join public.teacher_rosters tr on tr.id = rs.roster_id
  where rs.is_active = true
    and tr.is_active = true
    and tr.teacher_user_id = v_uid
    and not exists (
      select 1 from public.collective_participants cp
      where cp.competition_id = p_competition_id
        and cp.roster_student_id = rs.id
        and cp.status in ('ACTIVE', 'PROVISIONED')
    )
    and not exists (
      select 1 from public.collective_registrations cr
      where cr.competition_id = p_competition_id
        and cr.status in ('PENDING_PAYMENT', 'PAID')
        and rs.id = any(cr.roster_student_ids)
    );

  if v_maximum is not null and v_new_count > 0 then
    v_reserved_count := private.competition_reserved_participant_count(p_competition_id);
    if v_reserved_count + v_new_count > v_maximum then
      raise exception 'PARTICIPANT_LIMIT_REACHED';
    end if;
  end if;

  for r_student in
    select rs.id, rs.full_name, rs.class_name, rs.grade, rs.photo_url, tr.school_id
    from public.roster_students rs
    join public.teacher_rosters tr on tr.id = rs.roster_id
    where rs.id = any(coalesce(p_roster_student_ids, '{}'::uuid[]))
      and rs.is_active = true
      and tr.is_active = true
      and tr.teacher_user_id = v_uid
  loop
    if exists (
      select 1 from public.collective_participants cp
      where cp.competition_id = p_competition_id
        and cp.roster_student_id = r_student.id
        and cp.status in ('ACTIVE', 'PROVISIONED')
    ) then
      continue;
    end if;

    if exists (
      select 1 from public.collective_registrations cr
      where cr.competition_id = p_competition_id
        and cr.status in ('PENDING_PAYMENT', 'PAID')
        and r_student.id = any(cr.roster_student_ids)
    ) then
      continue;
    end if;

    v_code := 'CP-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
    while exists (
      select 1 from public.collective_participants cp where cp.participant_code = v_code
    ) loop
      v_code := 'CP-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
    end loop;
    v_password := 'SK' || upper(substr(encode(gen_random_bytes(7), 'hex'), 1, 12));

    insert into public.collective_participants(
      competition_id, roster_student_id, managed_by_user_id, participant_code,
      full_name, class_name, grade, school_id, photo_url, status
    )
    values (
      p_competition_id, r_student.id, v_uid, v_code,
      r_student.full_name, r_student.class_name, r_student.grade,
      r_student.school_id, r_student.photo_url, 'ACTIVE'
    )
    returning id into v_participant_id;

    insert into public.participant_access_credentials(
      collective_participant_id, password_hash, password_version, failed_attempts, enabled
    )
    values (
      v_participant_id, crypt(v_password, gen_salt('bf', 12)), 1, 0, true
    );

    participant_id := v_participant_id;
    roster_student_id := r_student.id;
    participant_code := v_code;
    temporary_password := v_password;
    full_name := r_student.full_name;
    class_name := r_student.class_name;
    grade := r_student.grade;
    photo_url := r_student.photo_url;
    return next;
  end loop;
end;
$function$;

-- generate_awards_for_competition
CREATE OR REPLACE FUNCTION public.generate_awards_for_competition(p_competition_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ DECLARE v_uid uuid:=auth.uid();v_org uuid;v_count integer:=0;r record;v_rank text;v_title text;v_points numeric;v_cert boolean;v_award_id uuid;BEGIN IF NOT private.current_user_is_better_auth() THEN RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED'; END IF; IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;SELECT organizer_id INTO v_org FROM public.competitions WHERE id=p_competition_id;IF v_org IS NULL THEN RAISE EXCEPTION 'COMPETITION_NOT_FOUND';END IF;IF NOT private.current_user_is_admin() AND NOT private.current_user_is_active_organizer_member(v_org) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;FOR r IN SELECT a.participant_id,max(a.score) AS score,row_number() over(order by max(a.score) desc,min(a.finalized_at),a.participant_id) AS pos FROM public.attempts a WHERE a.competition_id=p_competition_id AND a.status='FINALIZED' GROUP BY a.participant_id ORDER BY max(a.score) DESC LOOP IF r.pos=1 THEN v_rank:='FIRST';ELSIF r.pos=2 THEN v_rank:='SECOND';ELSIF r.pos=3 THEN v_rank:='THIRD';ELSE v_rank:='PARTICIPANT';END IF;SELECT cr.title,cr.points,cr.certificate_enabled INTO v_title,v_points,v_cert FROM public.competition_rewards cr WHERE cr.competition_id=p_competition_id AND cr.rank_code=v_rank ORDER BY cr.created_at LIMIT 1;IF v_title IS NULL THEN v_title:=CASE v_rank WHEN 'FIRST' THEN 'Juara 1' WHEN 'SECOND' THEN 'Juara 2' WHEN 'THIRD' THEN 'Juara 3' ELSE 'Peserta' END;v_points:=0;v_cert:=(v_rank<>'PARTICIPANT');END IF;SELECT id INTO v_award_id FROM public.awards WHERE user_id=r.participant_id AND competition_id=p_competition_id AND rank_code=v_rank LIMIT 1;IF v_award_id IS NULL THEN INSERT INTO public.awards(user_id,competition_id,rank_code,title,points,issued_at,visibility) VALUES(r.participant_id,p_competition_id,v_rank,v_title,coalesce(v_points,0),now(),'PUBLIC') RETURNING id INTO v_award_id;v_count:=v_count+1;END IF;IF v_cert THEN BEGIN PERFORM public.issue_certificate_for_award(v_award_id);EXCEPTION WHEN OTHERS THEN INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,reason) VALUES(v_uid,'CERTIFICATE_ISSUE_DEFERRED','award',v_award_id::text,SQLERRM);END;END IF;END LOOP;INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,reason) VALUES(v_uid,'AWARDS_GENERATED','competition',p_competition_id::text,'Generated from finalized attempts');RETURN v_count;END;$function$;

-- is_public_profile_admin
CREATE OR REPLACE FUNCTION public.is_public_profile_admin(p_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.user_roles as ur
    join public.profiles as p on p.id = ur.user_id
    join private.app_users as app_user on app_user.id = ur.user_id and app_user.identity_origin = 'better_auth'
    where ur.user_id = p_profile_id
      and ur.role::text = 'admin'
      and ur.is_active is true
      and (coalesce(p.is_public, true) is true or p.id = (select auth.uid()))
  );
$function$;

-- issue_certificate_for_award
CREATE OR REPLACE FUNCTION public.issue_certificate_for_award(p_award_id uuid)
 RETURNS certificates
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_uid uuid:=auth.uid();v_award public.awards%rowtype;v_certificate public.certificates%rowtype;v_code text;v_org uuid;v_canonical uuid;v_profile public.profiles%rowtype;
begin
 if not private.current_user_is_better_auth() then raise exception 'BETTER_AUTH_ISSUER_REQUIRED'; end if;
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 select * into v_award from public.awards where id=p_award_id;
 if not found then raise exception 'AWARD_NOT_FOUND';end if;
 select organizer_id into v_org from public.competitions where id=v_award.competition_id;
 if not private.current_user_is_admin() and not private.current_user_is_active_organizer_member(v_org) then raise exception 'FORBIDDEN';end if;
 select id into v_canonical from public.participants where competition_id=v_award.competition_id and user_id=v_award.user_id limit 1;
 if v_canonical is null then
   select * into v_profile from public.profiles where id=v_award.user_id;
   insert into public.participants(competition_id,user_id,participant_type,full_name,grade,school_id,photo_url)
   values(v_award.competition_id,v_award.user_id,'INDIVIDUAL',coalesce(v_profile.full_name,v_profile.username,'Participant'),v_profile.grade,v_profile.school_id,v_profile.avatar_url)
   returning id into v_canonical;
 end if;
 select * into v_certificate from public.certificates where user_id=v_award.user_id and competition_id=v_award.competition_id order by created_at desc limit 1;
 if found then update public.certificates set canonical_participant_id=coalesce(canonical_participant_id,v_canonical) where id=v_certificate.id returning * into v_certificate; return v_certificate;end if;
 insert into public.certificates(user_id,competition_id,canonical_participant_id,status,current_revision) values(v_award.user_id,v_award.competition_id,v_canonical,'GENERATED',1) returning * into v_certificate;
 v_code:='SYKA-'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
 insert into public.certificate_verifications(certificate_id,verification_code,status,public_name,competition_title,achievement_title,issued_at) select v_certificate.id,v_code,'GENERATED',p.full_name,c.title,v_award.title,now() from public.profiles p join public.competitions c on c.id=v_award.competition_id where p.id=v_award.user_id;
 return v_certificate;
end; $function$;

-- list_teacher_achievement_report
CREATE OR REPLACE FUNCTION public.list_teacher_achievement_report(p_competition_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text)
 RETURNS TABLE(collective_participant_id uuid, roster_student_id uuid, canonical_participant_id uuid, competition_id uuid, competition_title text, competition_status text, student_name text, class_name text, grade text, participant_code text, participant_status text, attempt_status text, score numeric, rank bigint, finalized_at timestamp with time zone, certificate_status text, certificate_serial_number text, certificate_url text, certificate_issued_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_admin boolean := private.current_user_is_admin();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;
  IF NOT private.current_user_is_better_auth() THEN RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED'; END IF;

  IF NOT v_is_admin AND NOT private.current_user_has_role('teacher'::public.app_role) THEN
    RAISE EXCEPTION 'TEACHER_ROLE_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    cp.id,
    cp.roster_student_id,
    p.id,
    cp.competition_id,
    c.title,
    c.status::text,
    cp.full_name,
    cp.class_name,
    cp.grade,
    cp.participant_code,
    cp.status,
    latest_activity.status::text,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
       AND latest_finalized_attempt.status::text = 'FINALIZED'
      THEN latest_finalized_attempt.score
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
       AND latest_finalized_attempt.status::text = 'FINALIZED'
      THEN private.canonical_competition_rank(cp.competition_id, p.id)
      ELSE NULL
    END,
    latest_finalized_attempt.finalized_at,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.status
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.serial_number
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.certificate_url
      ELSE NULL
    END,
    CASE
      WHEN c.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED')
      THEN latest_certificate.issued_at
      ELSE NULL
    END
  FROM public.collective_participants cp
  JOIN public.competitions c
    ON c.id = cp.competition_id
  JOIN public.participants p
    ON p.competition_id = cp.competition_id
   AND p.collective_participant_id = cp.id
   AND p.participant_type = 'COLLECTIVE'
  LEFT JOIN LATERAL (
    SELECT a.status
    FROM public.attempts a
    WHERE a.canonical_participant_id = p.id
      AND a.is_preview = false
    ORDER BY a.created_at DESC, a.attempt_number DESC, a.id DESC
    LIMIT 1
  ) latest_activity ON true
  LEFT JOIN LATERAL (
    SELECT a.status, a.score, a.finalized_at
    FROM public.attempts a
    WHERE a.canonical_participant_id = p.id
      AND a.is_preview = false
      AND a.status::text = 'FINALIZED'
    ORDER BY a.created_at DESC, a.attempt_number DESC, a.id DESC
    LIMIT 1
  ) latest_finalized_attempt ON true
  LEFT JOIN LATERAL (
    SELECT cc.status, cc.serial_number, cc.certificate_url, cc.issued_at
    FROM public.collective_certificates cc
    WHERE cc.collective_participant_id = cp.id
      AND cc.competition_id = cp.competition_id
    ORDER BY cc.issued_at DESC NULLS LAST, cc.created_at DESC
    LIMIT 1
  ) latest_certificate ON true
  WHERE
    (cp.managed_by_user_id = v_user_id OR v_is_admin)
    AND (p_competition_id IS NULL OR cp.competition_id = p_competition_id)
    AND (
      NULLIF(trim(p_search), '') IS NULL
      OR cp.full_name ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(cp.class_name, '') ILIKE '%' || trim(p_search) || '%'
      OR COALESCE(cp.grade, '') ILIKE '%' || trim(p_search) || '%'
      OR c.title ILIKE '%' || trim(p_search) || '%'
      OR cp.participant_code ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY
    COALESCE(latest_certificate.issued_at, latest_finalized_attempt.finalized_at, cp.created_at) DESC,
    cp.full_name ASC;
END;
$function$;

-- list_teacher_collective_certificates
CREATE OR REPLACE FUNCTION public.list_teacher_collective_certificates(p_competition_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(certificate_id uuid, participant_id uuid, competition_id uuid, competition_title text, participant_code text, full_name text, attempt_status text, score numeric, certificate_status text, serial_number text, verification_code text, certificate_url text, order_id uuid, order_status text, order_total numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select cc.id,cp.id,cp.competition_id,c.title,cp.participant_code,cp.full_name,
         a.status::text,a.score,cc.status,cc.serial_number,cc.verification_code,cc.certificate_url,
         cco.order_id,o.status::text,o.total
  from public.collective_participants cp
  join public.competitions c on c.id=cp.competition_id
  left join lateral (select a1.status,a1.score from public.attempts a1 where a1.collective_participant_id=cp.id order by a1.created_at desc limit 1) a on true
  left join public.collective_certificates cc on cc.collective_participant_id=cp.id
  left join public.collective_certificate_orders cco on cco.collective_certificate_id=cc.id
  left join public.orders o on o.id=cco.order_id
  where private.current_user_is_better_auth() and (cp.managed_by_user_id=auth.uid() or private.current_user_is_admin())
    and (p_competition_id is null or cp.competition_id=p_competition_id)
  order by cp.created_at desc;
$function$;

-- save_organizer_competition_config
CREATE OR REPLACE FUNCTION public.save_organizer_competition_config(p_competition_id uuid, p_level jsonb DEFAULT '{}'::jsonb, p_registration_rule jsonb DEFAULT '{}'::jsonb, p_rewards jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_level_id uuid;
  v_level jsonb := coalesce(p_level, '{}'::jsonb);
  v_rule jsonb := coalesce(p_registration_rule, '{}'::jsonb);
  v_reward jsonb;
  v_minimum integer := nullif(v_rule->>'minimum_participants', '')::integer;
  v_maximum integer := nullif(v_rule->>'max_participants', '')::integer;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select organizer_id into v_org
  from public.competitions
  where id = p_competition_id;

  if v_org is null then
    raise exception 'COMPETITION_NOT_FOUND';
  end if;

  if not private.current_user_is_active_organizer_member(v_org) and not private.current_user_is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if v_minimum is not null and v_minimum < 1 then
    raise exception 'MINIMUM_PARTICIPANTS_INVALID';
  end if;
  if v_maximum is not null and v_maximum < 1 then
    raise exception 'MAXIMUM_PARTICIPANTS_INVALID';
  end if;
  if v_minimum is not null and v_maximum is not null and v_minimum > v_maximum then
    raise exception 'MINIMUM_EXCEEDS_MAXIMUM';
  end if;

  update public.competitions
  set
    registration_starts_at = nullif(v_level->>'registration_starts_at', '')::timestamptz,
    registration_ends_at = nullif(v_level->>'registration_ends_at', '')::timestamptz,
    starts_at = nullif(v_level->>'starts_at', '')::timestamptz,
    ends_at = nullif(v_level->>'ends_at', '')::timestamptz,
    announcement_at = nullif(v_level->>'announcement_at', '')::timestamptz,
    updated_at = now()
  where id = p_competition_id;

  select id into v_level_id
  from public.competition_levels
  where competition_id = p_competition_id
  order by created_at
  limit 1;

  if v_level_id is null then
    insert into public.competition_levels (
      competition_id, code, label, allowed_grades, points, config
    )
    values (
      p_competition_id,
      coalesce(v_level->>'code', 'general'),
      coalesce(v_level->>'label', 'Umum'),
      array(select jsonb_array_elements_text(coalesce(v_level->'allowed_grades', '[]'::jsonb))),
      coalesce((v_level->>'points')::numeric, 0),
      coalesce(v_level->'config', '{}'::jsonb)
    )
    returning id into v_level_id;
  else
    update public.competition_levels
    set
      code = coalesce(v_level->>'code', code),
      label = coalesce(v_level->>'label', label),
      allowed_grades = array(select jsonb_array_elements_text(coalesce(v_level->'allowed_grades', '[]'::jsonb))),
      points = coalesce((v_level->>'points')::numeric, points),
      config = coalesce(v_level->'config', config),
      updated_at = now()
    where id = v_level_id;
  end if;

  insert into public.registration_rules (
    competition_id, allowed_grades, require_twibbon, require_social_proof,
    express_enabled, express_cost, max_participants, minimum_participants,
    config, approval_mode
  )
  values (
    p_competition_id,
    array(select jsonb_array_elements_text(coalesce(v_rule->'allowed_grades', '[]'::jsonb))),
    coalesce((v_rule->>'require_twibbon')::boolean, false),
    coalesce((v_rule->>'require_social_proof')::boolean, false),
    coalesce((v_rule->>'express_enabled')::boolean, false),
    coalesce((v_rule->>'express_cost')::numeric, 0),
    v_maximum,
    v_minimum,
    coalesce(v_rule->'config', '{}'::jsonb),
    coalesce(v_rule->>'approval_mode', 'MANUAL')
  )
  on conflict (competition_id) do update set
    allowed_grades = excluded.allowed_grades,
    require_twibbon = excluded.require_twibbon,
    require_social_proof = excluded.require_social_proof,
    express_enabled = excluded.express_enabled,
    express_cost = excluded.express_cost,
    max_participants = excluded.max_participants,
    minimum_participants = excluded.minimum_participants,
    config = excluded.config,
    approval_mode = excluded.approval_mode,
    updated_at = now();

  delete from public.competition_rewards
  where competition_id = p_competition_id;

  for v_reward in
    select * from jsonb_array_elements(coalesce(p_rewards, '[]'::jsonb))
  loop
    insert into public.competition_rewards (
      competition_id, competition_level_id, rank_code, title, points,
      emblem_name, certificate_enabled, config
    )
    values (
      p_competition_id,
      v_level_id,
      coalesce(v_reward->>'rank_code', 'PARTICIPANT'),
      coalesce(v_reward->>'title', 'Penghargaan'),
      coalesce((v_reward->>'points')::numeric, 0),
      v_reward->>'emblem_name',
      coalesce((v_reward->>'certificate_enabled')::boolean, false),
      coalesce(v_reward->'config', '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object(
    'competition_id', p_competition_id,
    'level_id', v_level_id,
    'saved', true,
    'minimum_participants', v_minimum,
    'max_participants', v_maximum
  );
end;
$function$;

-- save_question_with_options
CREATE OR REPLACE FUNCTION public.save_question_with_options(p_question_id uuid, p_question_bank_id uuid, p_type text, p_prompt text, p_points numeric DEFAULT 1, p_required boolean DEFAULT true, p_display_order integer DEFAULT 0, p_status text DEFAULT 'DRAFT'::text, p_config jsonb DEFAULT '{}'::jsonb, p_options jsonb DEFAULT '[]'::jsonb)
 RETURNS questions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$ declare v_uid uuid:=auth.uid();v_question public.questions%rowtype;v_org uuid;v_plan text;v_option jsonb;v_count int;v_correct int;begin if v_uid is null then raise exception 'AUTH_REQUIRED';end if;select organizer_id into v_org from public.question_banks where id=p_question_bank_id;if v_org is null then raise exception 'BANK_NOT_FOUND';end if;if not(private.current_user_is_active_organizer_member(v_org) or private.current_user_is_admin()) then raise exception 'FORBIDDEN';end if;select op.plan_code into v_plan from public.organizer_plans op where op.organizer_id=v_org and op.is_active=true and op.starts_at<=now() and(op.ends_at is null or op.ends_at>now()) order by op.starts_at desc,op.created_at desc limit 1;if lower(p_type) in('essay','long-answer') and(coalesce(p_config,'{}'::jsonb) ? 'answer_key' or coalesce(p_config,'{}'::jsonb)->'ai_assessment'->>'enabled'='true') then if not exists(select 1 from public.plan_entitlements pe where pe.plan_code=v_plan and pe.capability='essay_ai_assessment' and coalesce(pe.limit_value,0)>0) then raise exception 'PREMIUM_REQUIRED';end if;end if;if lower(p_type) in('multiple-choice','mcq') then v_count:=jsonb_array_length(coalesce(p_options,'[]'::jsonb));if v_count<3 or v_count>6 then raise exception 'MCQ_OPTIONS_3_6';end if;select count(*) into v_correct from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) x where coalesce((x->>'is_correct')::boolean,false);if v_correct<>1 then raise exception 'MCQ_EXACTLY_ONE_CORRECT';end if;elsif lower(p_type) in('true-false','true_false') then if jsonb_array_length(coalesce(p_options,'[]'::jsonb))<>2 then raise exception 'TRUE_FALSE_REQUIRES_TWO_OPTIONS';end if;select count(*) into v_correct from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) x where coalesce((x->>'is_correct')::boolean,false);if v_correct<>1 then raise exception 'TRUE_FALSE_EXACTLY_ONE_CORRECT';end if;p_options:=jsonb_build_array(jsonb_build_object('label','Benar','value','Benar','is_correct',coalesce((p_options->0->>'is_correct')::boolean,false),'display_order',0),jsonb_build_object('label','Salah','value','Salah','is_correct',coalesce((p_options->1->>'is_correct')::boolean,false),'display_order',1));end if;if p_question_id is null then insert into public.questions(question_bank_id,type,prompt,points,required,display_order,status,config) values(p_question_bank_id,p_type,p_prompt,p_points,p_required,p_display_order,p_status,p_config) returning * into v_question;else update public.questions set question_bank_id=p_question_bank_id,type=p_type,prompt=p_prompt,points=p_points,required=p_required,display_order=p_display_order,status=p_status,config=p_config,updated_at=now() where id=p_question_id returning * into v_question;if not found then raise exception 'QUESTION_NOT_FOUND';end if;end if;delete from public.question_options where question_id=v_question.id;for v_option in select * from jsonb_array_elements(coalesce(p_options,'[]'::jsonb)) loop insert into public.question_options(question_id,label,value,is_correct,display_order) values(v_question.id,coalesce(v_option->>'label',''),coalesce(v_option->>'value',v_option->>'label',''),coalesce((v_option->>'is_correct')::boolean,false),coalesce((v_option->>'display_order')::int,0));end loop;return v_question;end;$function$;

-- The collective Realtime bind RPC is also SECURITY DEFINER and can write its own
-- session row. Keep it unavailable to legacy Supabase Auth sessions after issuer
-- restriction even though the binding is scoped to auth.uid().
CREATE OR REPLACE FUNCTION private.collective_realtime_bind(p_access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'extensions'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cp uuid := private.collective_session_participant(trim(coalesce(p_access_token, '')));
  v_competition uuid;
  v_expires timestamptz;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.current_user_is_better_auth() then raise exception 'BETTER_AUTH_ISSUER_REQUIRED'; end if;
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  select competition_id into v_competition
  from public.collective_participants
  where id = v_cp and status = 'ACTIVE';
  if v_competition is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  select least(s.expires_at, now() + interval '8 hours') into v_expires
  from public.collective_access_sessions s
  where s.token_hash = private.hash_collective_token(trim(coalesce(p_access_token, '')))
    and s.revoked_at is null
    and s.expires_at > now()
    and s.session_type = 'COMPETITION'
    and s.collective_participant_id = v_cp
  order by s.created_at desc
  limit 1;
  if v_expires is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  insert into private.collective_chat_realtime_sessions(
    auth_user_id, collective_participant_id, competition_id, expires_at, updated_at
  )
  values(v_uid, v_cp, v_competition, v_expires, now())
  on conflict(auth_user_id) do update
    set collective_participant_id = excluded.collective_participant_id,
        competition_id = excluded.competition_id,
        expires_at = excluded.expires_at,
        updated_at = now();
  return jsonb_build_object('ok', true, 'competition_id', v_competition, 'expires_at', v_expires);
end;
$function$;

-- Private-profile connection reads must not treat a NULL auth.uid() as the
-- profile owner. They must also reject a legacy Supabase Auth identity when a
-- user has chosen to hide their connections. Public connections remain public
-- when the owner's existing show_*_popup setting allows it.
CREATE OR REPLACE FUNCTION public.get_profile_connections(
  p_profile_id uuid,
  p_mode text
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  verification_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_profile_is_public boolean := false;
  v_allow boolean := false;
  v_is_better_auth_owner boolean := false;
BEGIN
  IF p_profile_id IS NULL
     OR p_mode IS NULL
     OR p_mode NOT IN ('following', 'followers') THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(profile.is_public, false),
    CASE
      WHEN p_mode = 'following' THEN COALESCE(settings.show_following_popup, true)
      ELSE COALESCE(settings.show_social_popup, true)
    END
  INTO v_profile_is_public, v_allow
  FROM public.profiles AS profile
  LEFT JOIN public.profile_ui_settings AS settings
    ON settings.user_id = profile.id
  WHERE profile.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_is_better_auth_owner :=
    v_uid IS NOT NULL
    AND v_uid IS NOT DISTINCT FROM p_profile_id
    AND (SELECT auth.jwt() ->> 'iss') = 'https://auth-prod.sykabelajar.my.id/api/auth'
    AND EXISTS (
      SELECT 1
      FROM private.app_users AS au
      WHERE au.id = v_uid
        AND au.identity_origin = 'better_auth'
    );

  -- SECURITY DEFINER bypasses table RLS: explicitly enforce profiles.is_public.
  -- A Better Auth owner may always inspect their own private/hidden connection list.
  IF NOT v_profile_is_public
     AND NOT COALESCE(v_is_better_auth_owner, false) THEN
    RETURN;
  END IF;

  IF NOT COALESCE(v_allow, true)
     AND NOT COALESCE(v_is_better_auth_owner, false) THEN
    RETURN;
  END IF;

  IF p_mode = 'following' THEN
    RETURN QUERY
    SELECT p.id, p.username, p.full_name, p.avatar_url, p.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS p ON p.id = f.following_id
    WHERE f.follower_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY p.username;
  ELSE
    RETURN QUERY
    SELECT p.id, p.username, p.full_name, p.avatar_url, p.verification_type
    FROM public.follows AS f
    JOIN public.profiles AS p ON p.id = f.follower_id
    WHERE f.following_id = p_profile_id
      AND f.status IN ('approved', 'auto')
    ORDER BY p.username;
  END IF;
END;
$function$;


-- Private profile reads may be public only when the target profile's
-- existing public-visibility setting allows it. A private profile's owner
-- exception must be a real Better Auth identity, not only a matching auth.uid().
CREATE OR REPLACE FUNCTION public.get_public_profile_badge_visibility(p_profile_id uuid)
RETURNS TABLE(show_badges boolean, show_badge_collection boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    COALESCE(s.show_badges, true),
    COALESCE(s.show_badge_collection, true)
  FROM public.profiles AS p
  LEFT JOIN public.profile_ui_settings AS s ON s.user_id = p.id
  WHERE p.id = p_profile_id
    AND (
      (
        private.current_user_is_better_auth()
        AND (SELECT auth.uid()) = p_profile_id
      )
      OR COALESCE(p.is_public, false) = true
      OR (
        private.current_user_is_better_auth()
        AND private.current_user_is_admin()
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_public_profile_badges(p_profile_id uuid)
RETURNS TABLE(
  id uuid,
  name text,
  description text,
  icon_url text,
  icon_emoji text,
  category text,
  rarity text,
  awarded_at timestamptz,
  reason text,
  award_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    ub.id,
    b.name,
    b.description,
    b.icon_url,
    b.icon_emoji,
    b.category,
    b.rarity,
    ub.awarded_at,
    ub.reason,
    ub.award_source
  FROM public.user_badges AS ub
  JOIN public.badges AS b ON b.id = ub.badge_id
  JOIN public.profiles AS p ON p.id = ub.user_id
  LEFT JOIN public.profile_ui_settings AS s ON s.user_id = p.id
  WHERE ub.user_id = p_profile_id
    AND b.status = 'ACTIVE'
    AND (
      (
        private.current_user_is_better_auth()
        AND (SELECT auth.uid()) = p_profile_id
      )
      OR (
        private.current_user_is_better_auth()
        AND private.current_user_is_admin()
      )
      OR (
        COALESCE(p.is_public, false) = true
        AND COALESCE(s.show_badge_collection, true) = true
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.get_public_profile_ui_settings(p_profile_id uuid)
RETURNS TABLE(show_social_popup boolean, show_following_popup boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    COALESCE(s.show_social_popup, true),
    COALESCE(s.show_following_popup, true)
  FROM public.profile_ui_settings AS s
  JOIN public.profiles AS pr ON pr.id = s.user_id
  WHERE s.user_id = p_profile_id
    AND (
      (
        private.current_user_is_better_auth()
        AND p_profile_id = (SELECT auth.uid())
      )
      OR (
        private.current_user_is_better_auth()
        AND private.current_user_is_admin()
      )
      OR COALESCE(pr.is_public, true) = true
    )
  UNION ALL
  SELECT true, true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.profile_ui_settings AS s2
    JOIN public.profiles AS pr2 ON pr2.id = s2.user_id
    WHERE s2.user_id = p_profile_id
      AND (
        (
          private.current_user_is_better_auth()
          AND p_profile_id = (SELECT auth.uid())
        )
        OR (
          private.current_user_is_better_auth()
          AND private.current_user_is_admin()
        )
        OR COALESCE(pr2.is_public, true) = true
      )
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles AS pr3
    WHERE pr3.id = p_profile_id
      AND (
        (
          private.current_user_is_better_auth()
          AND p_profile_id = (SELECT auth.uid())
        )
        OR (
          private.current_user_is_better_auth()
          AND private.current_user_is_admin()
        )
        OR COALESCE(pr3.is_public, true) = true
      )
  )
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_follow_status(
  p_follower_id uuid,
  p_following_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
BEGIN
  IF v_uid IS NULL OR NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF p_follower_id IS NULL
     OR p_following_id IS NULL
     OR p_follower_id = p_following_id THEN
    RETURN 'none';
  END IF;

  IF v_uid <> p_follower_id
     AND v_uid <> p_following_id
     AND NOT public.is_active_admin(v_uid) THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  RETURN COALESCE(
    (
      SELECT f.status
      FROM public.follows AS f
      WHERE f.follower_id = p_follower_id
        AND f.following_id = p_following_id
      LIMIT 1
    ),
    'none'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_profile_social(p_profile_id uuid)
RETURNS TABLE(follower_count bigint, following_count bigint, follow_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_status text := 'none';
  v_is_public boolean := false;
  v_is_better_auth_owner boolean := false;
  v_is_better_auth_admin boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF p_profile_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(profile.is_public, false)
    INTO v_is_public
  FROM public.profiles AS profile
  WHERE profile.id = p_profile_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Private social aggregates are available only to the verified Better Auth
  -- owner or a currently authorized Better Auth Admin. An old Supabase Auth
  -- Admin UUID cannot inherit this exception.
  v_is_better_auth_owner := v_uid IS NOT DISTINCT FROM p_profile_id;
  v_is_better_auth_admin :=
    private.current_user_is_better_auth()
    AND private.current_user_is_admin();

  IF NOT v_is_public
     AND NOT v_is_better_auth_owner
     AND NOT v_is_better_auth_admin THEN
    RETURN;
  END IF;

  SELECT CASE
    WHEN f.status::text IN ('approved', 'auto') THEN 'approved'
    WHEN f.status::text = 'pending' THEN 'pending'
    ELSE 'none'
  END
    INTO v_status
  FROM public.follows AS f
  WHERE f.follower_id = v_uid
    AND f.following_id = p_profile_id
  LIMIT 1;

  RETURN QUERY
  SELECT
    (
      SELECT count(*)
      FROM public.follows AS f
      WHERE f.following_id = p_profile_id
        AND f.status::text IN ('approved', 'auto')
    ),
    (
      SELECT count(*)
      FROM public.follows AS f
      WHERE f.follower_id = p_profile_id
        AND f.status::text IN ('approved', 'auto')
    ),
    COALESCE(v_status, 'none');
END;
$function$;



-- Public competition results may include badges only under the profile's
-- public badge-collection preference, or for the verified Better Auth owner
-- / current Admin. A legacy Supabase Auth JWT with the same UUID is not the
-- profile owner after the identity cutover.
CREATE OR REPLACE FUNCTION public.get_competition_participant_detail(
  p_slug text,
  p_participant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_comp public.competitions%rowtype;
  v_participant public.participants%rowtype;
  v_attempt public.attempts%rowtype;
  v_published boolean;
  v_badges_visible boolean := false;
  v_rank bigint;
  v_total integer := 0;
  v_correct integer := 0;
  v_incorrect integer := 0;
  v_manual integer := 0;
  v_unanswered integer := 0;
  v_elapsed integer := 0;
  v_awards jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb;
  v_certificates jsonb := '[]'::jsonb;
BEGIN
  SELECT *
    INTO v_comp
  FROM public.competitions AS c
  WHERE c.slug = trim(coalesce(p_slug, ''));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'COMPETITION_NOT_FOUND';
  END IF;

  v_published := v_comp.visibility = 'PUBLIC'
    AND v_comp.status::text IN ('RESULT_PUBLISHED', 'ARCHIVED');

  IF NOT v_published THEN
    IF (SELECT auth.uid()) IS NULL THEN
      RAISE EXCEPTION 'RESULT_NOT_PUBLISHED';
    END IF;
    IF NOT (
      private.current_user_is_admin()
      OR (
        v_comp.organizer_id IS NOT NULL
        AND private.current_user_can_edit_competition(v_comp.organizer_id)
      )
    ) THEN
      RAISE EXCEPTION 'ACCESS_DENIED';
    END IF;
  END IF;

  SELECT *
    INTO v_participant
  FROM public.participants AS p
  WHERE p.id = p_participant_id
    AND p.competition_id = v_comp.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARTICIPANT_NOT_FOUND';
  END IF;

  -- Match public profile badge collection visibility without accepting an
  -- old Supabase Auth UUID as proof of private profile ownership.
  IF v_participant.user_id IS NOT NULL THEN
    SELECT
      (
        private.current_user_is_better_auth()
        AND (SELECT auth.uid()) IS NOT DISTINCT FROM p.id
      )
      OR private.current_user_is_admin()
      OR (
        coalesce(p.is_public, false)
        AND coalesce(settings.show_badge_collection, true)
      )
    INTO v_badges_visible
    FROM public.profiles AS p
    LEFT JOIN public.profile_ui_settings AS settings
      ON settings.user_id = p.id
    WHERE p.id = v_participant.user_id;
  END IF;

  SELECT *
    INTO v_attempt
  FROM public.attempts AS a
  WHERE a.competition_id = v_comp.id
    AND a.canonical_participant_id = v_participant.id
    AND a.is_preview = false
    AND a.status::text = 'FINALIZED'
  ORDER BY a.finalized_at DESC NULLS LAST, a.created_at DESC, a.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'has_result', false,
      'participant', jsonb_build_object(
        'full_name', v_participant.full_name,
        'participant_type', v_participant.participant_type,
        'grade', v_participant.grade,
        'class_name', v_participant.class_name,
        'school_name', (
          SELECT s.name
          FROM public.schools AS s
          WHERE s.id = v_participant.school_id
        )
      ),
      'scores', NULL,
      'awards', '[]'::jsonb,
      'badges', '[]'::jsonb,
      'certificates', '[]'::jsonb
    );
  END IF;

  SELECT r.rank_position
    INTO v_rank
  FROM private.canonical_competition_results(v_comp.id) AS r
  WHERE r.canonical_participant_id = v_participant.id;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE evaluated.result_status = 'CORRECT')::integer,
    count(*) FILTER (WHERE evaluated.result_status = 'INCORRECT')::integer,
    count(*) FILTER (WHERE evaluated.result_status = 'MANUAL_REVIEW')::integer,
    count(*) FILTER (WHERE evaluated.result_status IN ('UNANSWERED', 'SKIPPED', 'TIMEOUT'))::integer
  INTO v_total, v_correct, v_incorrect, v_manual, v_unanswered
  FROM (
    SELECT (
      private.evaluate_linear_preview_answer(
        eq.state,
        eq.transition_reason,
        eq.question_snapshot,
        eq.answer_key_snapshot,
        coalesce(a.answer_json, '{}'::jsonb)
      )->>'result_status'
    ) AS result_status
    FROM public.exam_attempt_questions AS eq
    LEFT JOIN public.answers AS a
      ON a.attempt_id = eq.attempt_id
     AND a.question_id = eq.question_id
    WHERE eq.attempt_id = v_attempt.id
  ) AS evaluated;

  SELECT coalesce(sum(eq.elapsed_seconds), 0)::integer
    INTO v_elapsed
  FROM public.exam_attempt_questions AS eq
  WHERE eq.attempt_id = v_attempt.id;

  IF v_elapsed = 0 AND v_attempt.started_at IS NOT NULL THEN
    v_elapsed := greatest(
      0,
      extract(epoch FROM (
        coalesce(v_attempt.submitted_at, v_attempt.finalized_at) - v_attempt.started_at
      ))::integer
    );
  END IF;

  IF v_participant.user_id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'title', aw.title,
      'rank_code', aw.rank_code,
      'points', aw.points,
      'emblem_url', aw.emblem_url,
      'issued_at', aw.issued_at
    ) ORDER BY aw.issued_at DESC), '[]'::jsonb)
      INTO v_awards
    FROM public.awards AS aw
    WHERE aw.user_id = v_participant.user_id
      AND aw.competition_id = v_comp.id
      AND aw.visibility = 'PUBLIC';

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'name', b.name,
      'description', b.description,
      'icon_url', b.icon_url,
      'icon_emoji', b.icon_emoji,
      'rarity', b.rarity,
      'awarded_at', ub.awarded_at
    ) ORDER BY ub.awarded_at DESC), '[]'::jsonb)
      INTO v_badges
    FROM public.user_badges AS ub
    JOIN public.badges AS b ON b.id = ub.badge_id
    WHERE ub.user_id = v_participant.user_id
      AND ub.source_reference = v_comp.id::text
      AND b.status = 'ACTIVE'
      AND coalesce(v_badges_visible, false);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'serial_number', cert.serial_number,
    'certificate_url', cert.certificate_url,
    'issued_at', cert.issued_at
  ) ORDER BY cert.issued_at DESC), '[]'::jsonb)
    INTO v_certificates
  FROM public.certificates AS cert
  WHERE cert.canonical_participant_id = v_participant.id
    AND cert.competition_id = v_comp.id
    AND cert.status::text = 'PUBLISHED'
    AND cert.certificate_url IS NOT NULL;

  SELECT v_certificates || coalesce(jsonb_agg(jsonb_build_object(
    'serial_number', cc.serial_number,
    'certificate_url', cc.certificate_url,
    'issued_at', cc.issued_at
  ) ORDER BY cc.issued_at DESC), '[]'::jsonb)
    INTO v_certificates
  FROM public.collective_certificates AS cc
  WHERE cc.canonical_participant_id = v_participant.id
    AND cc.competition_id = v_comp.id
    AND cc.status = 'PUBLISHED'
    AND cc.certificate_url IS NOT NULL;

  RETURN jsonb_build_object(
    'has_result', true,
    'participant', jsonb_build_object(
      'full_name', v_participant.full_name,
      'participant_type', v_participant.participant_type,
      'grade', v_participant.grade,
      'class_name', v_participant.class_name,
      'school_name', (
        SELECT s.name
        FROM public.schools AS s
        WHERE s.id = v_participant.school_id
      )
    ),
    'result', jsonb_build_object(
      'rank', v_rank,
      'score', v_attempt.score,
      'finalized_at', v_attempt.finalized_at,
      'duration_seconds', v_elapsed
    ),
    'question_summary', jsonb_build_object(
      'total', v_total,
      'correct', v_correct,
      'incorrect', v_incorrect,
      'manual_review', v_manual,
      'unanswered', v_unanswered
    ),
    'awards', v_awards,
    'badges', v_badges,
    'certificates', v_certificates
  );
END;
$function$;

-- These RPCs have explicit auth.uid()/Admin guards and are used by signed-in
-- application users only. Remove redundant anon/PUBLIC EXECUTE without
-- changing authenticated, service_role, or owner privileges.
DO $acl_preflight$
DECLARE
  v_signature text;
  v_function regprocedure;
  v_owner text;
  v_is_definer boolean;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_diagnose_organizer_voucher_delete(uuid)',
    'public.admin_evaluate_badges()',
    'public.admin_update_system_error_status(uuid,text,text)',
    'public.get_follow_status(uuid,uuid)',
    'public.reopen_system_error_incident(uuid,text)'
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'ISSUER_GUARD_FUNCTION_MISSING: %', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef
      INTO v_owner, v_is_definer
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = v_function;

    IF v_owner IS DISTINCT FROM 'postgres' OR v_is_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'ISSUER_GUARD_UNEXPECTED_OWNER_OR_KIND: % owner=% definer=%',
        v_signature, v_owner, v_is_definer;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUER_GUARD_EXECUTE_BASELINE_DRIFT: %', v_signature;
    END IF;
  END LOOP;
END;
$acl_preflight$;

REVOKE EXECUTE ON FUNCTION public.admin_diagnose_organizer_voucher_delete(uuid)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_evaluate_badges()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_system_error_status(uuid, text, text)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_follow_status(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reopen_system_error_incident(uuid, text)
  FROM anon;

DO $social_acl_preflight$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure('public.get_public_profile_social(uuid)');
  v_owner text;
  v_is_definer boolean;
BEGIN
  IF v_function IS NULL THEN
    RAISE EXCEPTION 'SOCIAL_RPC_MISSING';
  END IF;
  SELECT pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef
    INTO v_owner, v_is_definer
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = v_function;
  IF v_owner IS DISTINCT FROM 'postgres' OR v_is_definer IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'SOCIAL_RPC_UNEXPECTED_OWNER_OR_KIND';
  END IF;
  IF NOT pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'SOCIAL_RPC_EXECUTE_BASELINE_DRIFT';
  END IF;
END;
$social_acl_preflight$;

REVOKE ALL ON FUNCTION public.get_public_profile_social(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_public_profile_social(uuid)
  TO authenticated;

DO $social_acl_postflight$
DECLARE
  v_function regprocedure := pg_catalog.to_regprocedure('public.get_public_profile_social(uuid)');
BEGIN
  IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'SOCIAL_RPC_EXECUTE_POSTFLIGHT_FAILED';
  END IF;
END;
$social_acl_postflight$;

DO $acl_postflight$
DECLARE
  v_signature text;
  v_function regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.admin_diagnose_organizer_voucher_delete(uuid)',
    'public.admin_evaluate_badges()',
    'public.admin_update_system_error_status(uuid,text,text)',
    'public.get_follow_status(uuid,uuid)',
    'public.reopen_system_error_incident(uuid,text)'
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_signature);
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUER_GUARD_ANON_EXECUTE_REMAINS: %', v_signature;
    END IF;
    IF NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'ISSUER_GUARD_TRUSTED_EXECUTE_MISSING: %', v_signature;
    END IF;
  END LOOP;
END;
$acl_postflight$;


-- User-scoped SECURITY DEFINER RPCs previously checked only auth.uid().
-- Keep the existing AUTH_REQUIRED/LOGIN_REQUIRED behavior for anonymous calls,
-- then require the exact Better Auth issuer and a projected Better Auth identity
-- before any user-scoped read/write proceeds. Business rules and SQL bodies below
-- are copied from the read-only Production catalog; only this issuer gate is added.
DO $user_rpc_issuer_preflight$
DECLARE
  v_signature text;
  v_function regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
      'public.archive_my_order_history(uuid)',
      'public.bulk_import_roster_students(uuid,jsonb)',
      'public.cancel_my_pending_order(uuid)',
      'public.claim_and_complete_daily_task(uuid)',
      'public.claim_daily_checkin(date,integer)',
      'public.claim_daily_task(uuid)',
      'public.claim_organizer_voucher(uuid)',
      'public.claim_rpc_recovery(text)',
      'public.complete_daily_task(uuid)',
      'public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)'
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'USER_RPC_ISSUER_FUNCTION_MISSING:%', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_function
        AND p.prosecdef = true
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    ) THEN
      RAISE EXCEPTION 'USER_RPC_ISSUER_FUNCTION_KIND_OR_OWNER_DRIFT:%', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'USER_RPC_ISSUER_ACL_DRIFT:%', v_signature;
    END IF;
  END LOOP;
END;
$user_rpc_issuer_preflight$;

CREATE OR REPLACE FUNCTION public.archive_my_order_history(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT status::text INTO v_status
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF upper(coalesce(v_status, '')) NOT IN ('PAID', 'COMPLETED', 'CANCELLED', 'CANCELED', 'REFUNDED') THEN
    RAISE EXCEPTION 'ORDER_NOT_ARCHIVABLE';
  END IF;

  INSERT INTO public.user_order_history_archives(user_id, order_id)
  VALUES (v_uid, p_order_id)
  ON CONFLICT (user_id, order_id)
  DO UPDATE SET archived_at = now();

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.bulk_import_roster_students(p_roster_id uuid, p_students jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  r jsonb;
  v_name text;
  v_class text;
  v_grade text;
  v_ref text;
  v_existing uuid;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  if not exists(select 1 from public.teacher_rosters tr where tr.id=p_roster_id and tr.teacher_user_id=v_uid and tr.is_active=true) then raise exception 'FORBIDDEN'; end if;
  if jsonb_typeof(coalesce(p_students,'[]'::jsonb)) <> 'array' then raise exception 'INVALID_STUDENTS'; end if;
  if jsonb_array_length(p_students)>500 then raise exception 'IMPORT_LIMIT'; end if;
  for r in select value from jsonb_array_elements(p_students) loop
    v_name:=trim(coalesce(r->>'full_name',r->>'name',''));
    if v_name='' then continue; end if;
    v_class:=nullif(trim(coalesce(r->>'class_name',r->>'class','')),'');
    v_grade:=nullif(trim(coalesce(r->>'grade',r->>'jenjang','')),'');
    v_ref:=nullif(trim(coalesce(r->>'external_student_ref',r->>'student_id',r->>'id','')),'');
    select rs.id into v_existing from public.roster_students rs where rs.roster_id=p_roster_id and v_ref is not null and rs.external_student_ref=v_ref limit 1;
    if v_existing is not null then
      update public.roster_students set full_name=v_name,class_name=v_class,grade=v_grade,is_active=true,updated_at=now() where id=v_existing;
    else
      insert into public.roster_students(roster_id,full_name,class_name,grade,external_student_ref,is_active) values(p_roster_id,v_name,v_class,v_grade,v_ref,true);
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_my_pending_order(p_order_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_intent_status text;
  v_before jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND';
  END IF;

  IF v_order.status <> 'PENDING_PAYMENT' THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE';
  END IF;

  IF upper(coalesce(v_order.payment_proof_status, '')) = 'SUBMITTED'
     OR nullif(trim(coalesce(v_order.payment_proof_url, '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'PAYMENT_PROOF_SUBMITTED';
  END IF;

  SELECT upper(coalesce(pi.status, '')) INTO v_intent_status
  FROM public.payment_intents pi
  WHERE pi.order_id = v_order.id
  ORDER BY pi.updated_at DESC
  LIMIT 1;

  IF v_intent_status IS NOT NULL
     AND v_intent_status NOT IN ('FAILED', 'EXPIRED', 'CANCELLED', 'REJECTED') THEN
    RAISE EXCEPTION 'PAYMENT_SESSION_ACTIVE';
  END IF;

  SELECT * INTO v_item
  FROM public.order_items
  WHERE order_id = v_order.id
  ORDER BY created_at
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_ITEM_NOT_FOUND';
  END IF;

  IF NOT (
    v_item.product_type IN ('EDU_COIN_TOPUP', 'BADGE', 'CERTIFICATE_SERIALS', 'DONATION')
    OR (
      v_item.product_type = 'DIGITAL_ITEM'
      AND v_item.product_ref <> 'COLLECTIVE_CERTIFICATE'
      AND v_item.metadata ? 'shop_metadata'
    )
  ) THEN
    RAISE EXCEPTION 'ORDER_NOT_CANCELLABLE';
  END IF;

  v_before := to_jsonb(v_order);
  UPDATE public.orders
  SET status = 'CANCELLED', updated_at = now()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  INSERT INTO public.audit_logs(actor_user_id, action, entity_type, entity_id, reason, before_data, after_data)
  VALUES (
    v_uid,
    'USER_ORDER_CANCELLED',
    'order',
    v_order.id::text,
    'Pemilik membatalkan pesanan yang belum dibayar dan tidak memiliki sesi pembayaran aktif',
    v_before,
    to_jsonb(v_order)
  );

  RETURN v_order;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_and_complete_daily_task(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  t public.daily_tasks;
  claim public.daily_task_claims;
  v_claim_date date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_claim_count integer := 0;
  v_ledger_id uuid;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT *
    INTO t
  FROM public.daily_tasks
  WHERE id = p_task_id
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= pg_catalog.now())
    AND (ends_at IS NULL OR ends_at >= pg_catalog.now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND';
  END IF;

  IF NOT private.is_daily_task_eligible(u, p_task_id, v_claim_date) THEN
    RAISE EXCEPTION 'TASK_REQUIREMENT_NOT_MET';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(u::text || ':daily-task:' || p_task_id::text, 0)
  );

  SELECT *
    INTO claim
  FROM public.daily_task_claims
  WHERE task_id = p_task_id
    AND user_id = u
    AND claim_date = v_claim_date
  FOR UPDATE;

  IF FOUND AND claim.status = 'COMPLETED' THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already', true,
      'points', coalesce(t.points, 0),
      'exp', coalesce(t.exp, 0)
    );
  END IF;

  IF NOT FOUND THEN
    IF t.max_claims_per_user IS NOT NULL THEN
      SELECT count(*)::integer
        INTO v_claim_count
      FROM public.daily_task_claims
      WHERE task_id = p_task_id AND user_id = u;

      IF v_claim_count >= t.max_claims_per_user THEN
        RAISE EXCEPTION 'TASK_CLAIM_LIMIT_REACHED';
      END IF;
    END IF;

    INSERT INTO public.daily_task_claims(task_id, user_id, claim_date, status)
    VALUES (p_task_id, u, v_claim_date, 'CLAIMED')
    RETURNING * INTO claim;
  END IF;

  UPDATE public.daily_task_claims
  SET status = 'COMPLETED',
      completed_at = pg_catalog.clock_timestamp()
  WHERE id = claim.id;

  IF coalesce(t.points, 0) > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_TASK_COMPLETED', claim.id::text, t.points, 'Menyelesaikan misi harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', t.points);
    END IF;
  END IF;

  IF coalesce(t.exp, 0) > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.xp_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_TASK_COMPLETED', claim.id::text, t.exp, 'EXP dari misi harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'XP', t.exp);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'already', false,
    'points', coalesce(t.points, 0),
    'exp', coalesce(t.exp, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_daily_checkin(p_date date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date, p_day_number integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  v_today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  r jsonb;
  existing public.daily_checkins;
  rid text;
  amt numeric;
  typ text;
  next_day integer;
  v_ledger_id uuid;
  v_coin_amount numeric := 0;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  IF p_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'CHECKIN_DATE_MUST_BE_TODAY';
  END IF;

  -- Serialize claims per user. Duplicate taps return the already saved row
  -- instead of racing on the (user_id, checkin_date) primary key.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(u::text || ':daily-checkin', 0)
  );

  SELECT *
    INTO existing
  FROM public.daily_checkins
  WHERE user_id = u AND checkin_date = p_date;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'already', true,
      'reward_type', existing.reward_type,
      'reward_amount', existing.reward_amount,
      'streak_day', existing.streak_day,
      'event_id', existing.event_id
    );
  END IF;

  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.daily_checkins dc
      WHERE dc.user_id = u AND dc.checkin_date = p_date - 1
    )
    THEN coalesce((
      SELECT streak_day
      FROM public.daily_checkins
      WHERE user_id = u AND checkin_date = p_date - 1
    ), 0) + 1
    ELSE 1
  END
  INTO next_day;

  -- Always resolve the reward using the streak calculated by the database.
  r := public.resolve_daily_checkin_reward(p_date, next_day);
  typ := coalesce(r ->> 'reward_type', 'XP');
  amt := coalesce((r ->> 'reward_amount')::numeric, 0);
  v_coin_amount := coalesce((r ->> 'coin_amount')::numeric, 0);

  IF typ NOT IN ('XP', 'COIN') THEN
    RAISE EXCEPTION 'CHECKIN_REWARD_TYPE_NOT_SUPPORTED';
  END IF;

  INSERT INTO public.daily_checkins (
    user_id, checkin_date, reward_type, reward_amount, streak_day, event_id
  )
  VALUES (
    u, p_date, typ, amt, next_day, nullif(r ->> 'event_id', '')::uuid
  )
  RETURNING * INTO existing;

  rid := existing.user_id::text || ':' || existing.checkin_date::text;

  IF typ = 'XP' AND amt > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.xp_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_CHECKIN', rid, amt, 'Hadiah check-in harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'XP', amt);
    END IF;
  ELSIF typ = 'COIN' AND amt > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_CHECKIN', rid, amt, 'Hadiah check-in harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', amt);
    END IF;
  END IF;

  IF v_coin_amount > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_CHECKIN', rid || ':coin', v_coin_amount, 'Koin reguler check-in')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', v_coin_amount);
    END IF;
  END IF;

  RETURN r || jsonb_build_object(
    'already', false,
    'streak_day', existing.streak_day
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_daily_task(p_task_id uuid)
 RETURNS daily_task_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  t public.daily_tasks;
  claim public.daily_task_claims;
  v_claim_count integer := 0;
  v_claim_date date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT *
    INTO t
  FROM public.daily_tasks
  WHERE id = p_task_id
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= pg_catalog.now())
    AND (ends_at IS NULL OR ends_at >= pg_catalog.now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND';
  END IF;

  IF NOT private.is_daily_task_eligible(u, p_task_id, v_claim_date) THEN
    RAISE EXCEPTION 'TASK_REQUIREMENT_NOT_MET';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(u::text || ':daily-task:' || p_task_id::text, 0)
  );

  IF t.max_claims_per_user IS NOT NULL THEN
    SELECT count(*)::integer
      INTO v_claim_count
    FROM public.daily_task_claims
    WHERE task_id = p_task_id AND user_id = u;

    IF v_claim_count >= t.max_claims_per_user THEN
      RAISE EXCEPTION 'TASK_CLAIM_LIMIT_REACHED';
    END IF;
  END IF;

  INSERT INTO public.daily_task_claims(task_id, user_id, claim_date, status)
  VALUES (p_task_id, u, v_claim_date, 'CLAIMED')
  ON CONFLICT (task_id, user_id, claim_date)
  DO UPDATE SET status = public.daily_task_claims.status
  RETURNING * INTO claim;

  RETURN claim;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_organizer_voucher(p_voucher_id uuid)
 RETURNS organizer_voucher_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare v_org uuid; v public.organizer_vouchers; c public.organizer_voucher_claims;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  select o.id into v_org from public.organizers o where o.owner_user_id=auth.uid() or exists(select 1 from public.organizer_members m where m.organizer_id=o.id and m.user_id=auth.uid() and m.is_active=true) order by o.created_at limit 1;
  if v_org is null then raise exception 'ORGANIZER_REQUIRED'; end if;
  select * into v from public.organizer_vouchers where id=p_voucher_id for update;
  if not found or not v.is_active then raise exception 'VOUCHER_NOT_AVAILABLE'; end if;
  if v.starts_at is not null and v.starts_at>now() then raise exception 'VOUCHER_NOT_STARTED'; end if;
  if v.ends_at is not null and v.ends_at<now() then raise exception 'VOUCHER_EXPIRED'; end if;
  if v.claim_count>=v.max_uses then raise exception 'VOUCHER_EXHAUSTED'; end if;
  if exists(select 1 from public.organizer_voucher_claims where voucher_id=v.id and organizer_id=v_org and status in ('CLAIMED','USED')) then raise exception 'VOUCHER_ALREADY_CLAIMED'; end if;
  insert into public.organizer_voucher_claims(voucher_id,organizer_id,claimed_by) values(v.id,v_org,auth.uid()) returning * into c;
  update public.organizer_vouchers set claim_count=claim_count+1,updated_at=now() where id=v.id;
  return c;
end; $function$;

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
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
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

CREATE OR REPLACE FUNCTION public.complete_daily_task(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
DECLARE
  u uuid := auth.uid();
  t public.daily_tasks;
  claim public.daily_task_claims;
  v_claim_date date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
  v_ledger_id uuid;
BEGIN
  IF u IS NULL THEN
    RAISE EXCEPTION 'LOGIN_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  SELECT *
    INTO t
  FROM public.daily_tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_FOUND';
  END IF;

  SELECT *
    INTO claim
  FROM public.daily_task_claims
  WHERE task_id = p_task_id
    AND user_id = u
    AND claim_date = v_claim_date
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TASK_NOT_CLAIMED';
  END IF;

  IF NOT private.is_daily_task_eligible(u, p_task_id, v_claim_date) THEN
    RAISE EXCEPTION 'TASK_REQUIREMENT_NOT_MET';
  END IF;

  IF claim.status = 'COMPLETED' THEN
    RETURN jsonb_build_object(
      'completed', true,
      'already', true,
      'points', coalesce(t.points, 0),
      'exp', coalesce(t.exp, 0)
    );
  END IF;

  UPDATE public.daily_task_claims
  SET status = 'COMPLETED',
      completed_at = pg_catalog.clock_timestamp()
  WHERE id = claim.id;

  IF coalesce(t.points, 0) > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.edu_coin_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_TASK_COMPLETED', claim.id::text, t.points, 'Menyelesaikan misi harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'COIN', t.points);
    END IF;
  END IF;

  IF coalesce(t.exp, 0) > 0 THEN
    v_ledger_id := NULL;
    INSERT INTO public.xp_ledger(user_id, event_type, event_id, amount, reason)
    VALUES (u, 'DAILY_TASK_COMPLETED', claim.id::text, t.exp, 'EXP dari misi harian')
    ON CONFLICT (user_id, event_type, event_id) DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      PERFORM private.credit_profile_currency(u, 'XP', t.exp);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'completed', true,
    'already', false,
    'points', coalesce(t.points, 0),
    'exp', coalesce(t.exp, 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_ad_banner_payment_order(p_request_id uuid, p_payment_method_id uuid, p_proof_url text DEFAULT NULL::text, p_proof_public_id text DEFAULT NULL::text, p_proof_width integer DEFAULT NULL::integer, p_proof_height integer DEFAULT NULL::integer, p_proof_version text DEFAULT NULL::text, p_proof_resource_type text DEFAULT NULL::text, p_unique_code integer DEFAULT 0)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_request public.ad_banner_requests%rowtype;
  v_method public.organizer_payment_methods%rowtype;
  v_gateway_state public.payment_gateway_state%rowtype;
  v_provider_config public.payment_gateway_configs%rowtype;
  v_banner_settings public.ad_banner_settings%rowtype;
  v_order public.orders%rowtype;
  v_is_global boolean;
  v_environment text;
  v_daily_price numeric(14,2);
  v_base_amount numeric(14,2);
  v_amount numeric(14,2);
  v_proof text := nullif(trim(coalesce(p_proof_url,'')), '');
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  if p_request_id is null or p_payment_method_id is null then raise exception 'PAYMENT_METHOD_REQUIRED'; end if;
  if p_unique_code not between 0 and 999 then raise exception 'INVALID_PAYMENT_CODE'; end if;

  select * into v_request
  from public.ad_banner_requests
  where id=p_request_id and user_id=v_uid
  for update;
  if not found then raise exception 'AD_BANNER_REQUEST_NOT_FOUND'; end if;
  if v_request.status <> 'PENDING' then raise exception 'AD_BANNER_REQUEST_NOT_PAYABLE'; end if;
  if v_request.duration_days not between 1 and 90 then raise exception 'AD_BANNER_DURATION_INVALID'; end if;
  if (v_request.placement='home_sidebar' and v_request.slots_requested<>1)
     or (v_request.placement='home_top' and v_request.slots_requested not between 1 and 2) then
    raise exception 'AD_BANNER_SLOT_COUNT_INVALID';
  end if;
  select * into v_banner_settings from public.ad_banner_settings order by created_at limit 1;
  v_daily_price := coalesce(nullif(v_banner_settings.price_per_lot_daily,0),50000);
  if v_request.single_image and v_request.slots_requested=2 then
    v_base_amount := round(coalesce(nullif(v_banner_settings.single_image_2slots_price,0),v_daily_price*2) * v_request.duration_days,2);
  else
    v_base_amount := round(v_daily_price * v_request.slots_requested * v_request.duration_days,2);
  end if;
  if v_base_amount<=0 then raise exception 'AD_BANNER_PRICE_INVALID'; end if;
  -- Recalculate server-side; never trust the client-supplied request total for a payment amount.
  update public.ad_banner_requests set total_price=v_base_amount where id=v_request.id;
  v_request.total_price := v_base_amount;

  select * into v_method from public.organizer_payment_methods
  where id=p_payment_method_id and is_active=true;
  if not found then raise exception 'PAYMENT_METHOD_NOT_AVAILABLE'; end if;
  v_is_global := coalesce(v_method.details->>'global_gateway','false')='true';

  if v_is_global then
    if upper(v_method.payment_type) <> 'SNAP' then raise exception 'GLOBAL_PAYMENT_METHOD_INVALID'; end if;
    if p_unique_code <> 0 then raise exception 'INVALID_PAYMENT_CODE'; end if;
    select * into v_gateway_state from public.payment_gateway_state where id=true;
    if not found or v_gateway_state.automatic_payments_enabled is distinct from true
       or v_gateway_state.active_provider not in ('MIDTRANS','XENITHPAY') then
      raise exception 'GLOBAL_GATEWAY_NOT_ACTIVE';
    end if;
    select * into v_provider_config from public.payment_gateway_configs
    where provider=v_gateway_state.active_provider and is_enabled=true;
    if not found then raise exception 'GLOBAL_GATEWAY_NOT_CONFIGURED'; end if;
    v_environment := coalesce(v_provider_config.environment,'sandbox');
    if v_gateway_state.active_provider='MIDTRANS' and
       coalesce(v_provider_config.secret_config #>> array[v_environment,'server_key'],'')='' then
      raise exception 'GLOBAL_GATEWAY_NOT_CONFIGURED';
    end if;
    if v_gateway_state.active_provider='XENITHPAY' and (
       coalesce(v_provider_config.secret_config #>> array[v_environment,'api_key'],'')=''
       or coalesce(v_provider_config.secret_config #>> array[v_environment,'api_secret'],'')=''
       or coalesce(v_provider_config.secret_config #>> array[v_environment,'webhook_secret'],'')=''
       or coalesce(v_provider_config.public_config #>> array[v_environment,'payment_method'],'')=''
       or coalesce(v_provider_config.public_config #>> array[v_environment,'payment_channel'],'')=''
    ) then raise exception 'GLOBAL_GATEWAY_NOT_CONFIGURED'; end if;
  else
    if upper(v_method.payment_type) not in ('BANK_TRANSFER','MANUAL_TRANSFER','QRIS','EWALLET') then
      raise exception 'PAYMENT_METHOD_NOT_SUPPORTED';
    end if;
    if p_unique_code < 100 or v_proof is null or v_proof !~* '^https?://' then
      raise exception 'PAYMENT_PROOF_REQUIRED';
    end if;
  end if;

  if v_request.payment_order_id is not null then
    select * into v_order from public.orders where id=v_request.payment_order_id for update;
    if found and v_order.status='PENDING_PAYMENT' and v_order.payment_method_id=p_payment_method_id then
      return v_order;
    end if;
    if found and v_order.status='PAID' then raise exception 'AD_BANNER_ALREADY_PAID'; end if;
    if found then raise exception 'AD_BANNER_PAYMENT_ORDER_EXISTS'; end if;
  end if;

  v_amount := v_base_amount + case when v_is_global then 0 else p_unique_code end;
  if not coalesce(v_amount > 0 and v_amount < 1000000000000, false) then raise exception 'INVALID_ORDER_AMOUNT'; end if;

  insert into public.orders(
    user_id,status,subtotal,discount,shipping_cost,total,currency,contact_name,contact_email,contact_note,
    payment_method,payment_provider,payment_method_id,payment_proof_url,payment_proof_public_id,
    payment_proof_width,payment_proof_height,payment_proof_version,payment_proof_resource_type,
    payment_proof_status,contact_fields
  ) values (
    v_uid,'PENDING_PAYMENT',v_amount,0,0,v_amount,'IDR',null,null,'Iklan banner',
    v_method.name,case when v_is_global then 'GLOBAL' else upper(v_method.payment_type) end,p_payment_method_id,
    case when v_is_global then null else v_proof end,
    case when v_is_global then null else p_proof_public_id end,
    case when v_is_global then null else p_proof_width end,
    case when v_is_global then null else p_proof_height end,
    case when v_is_global then null else p_proof_version end,
    case when v_is_global then null else p_proof_resource_type end,
    case when v_is_global then 'NOT_SUBMITTED' else 'SUBMITTED' end,
    jsonb_build_object('ad_banner_request_id',v_request.id,'organizer_id',v_request.organizer_id,'placement',v_request.placement)
  ) returning * into v_order;

  insert into public.order_items(order_id,product_type,product_ref,name,quantity,unit_price,line_total,metadata)
  values(v_order.id,'DIGITAL_ITEM','AD_BANNER_REQUEST',
    'Iklan Banner — '||case when v_request.placement='home_sidebar' then 'Sidebar' else 'Banner Tengah Atas' end,
    1,v_amount,v_amount,jsonb_build_object(
      'ad_banner_request_id',v_request.id,'organizer_id',v_request.organizer_id,
      'placement',v_request.placement,'duration_days',v_request.duration_days,
      'slots_requested',v_request.slots_requested,'base_amount',v_request.total_price,
      'unique_payment_code',case when v_is_global then 0 else p_unique_code end
    ));

  perform set_config('app.ad_banner_payment_write','true',true);
  update public.ad_banner_requests
  set payment_order_id=v_order.id,
      payment_method_id=p_payment_method_id,
      payment_status='PENDING',
      paid_at=null
  where id=v_request.id;

  perform private.write_audit('commerce.ad_banner_order_created','order',v_order.id::text,
    'Organizer banner payment checkout',null,to_jsonb(v_order),null);
  return v_order;
end;
$function$;

DO $user_rpc_issuer_postflight$
DECLARE
  v_signature text;
  v_function regprocedure;
  v_source text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
      'public.archive_my_order_history(uuid)',
      'public.bulk_import_roster_students(uuid,jsonb)',
      'public.cancel_my_pending_order(uuid)',
      'public.claim_and_complete_daily_task(uuid)',
      'public.claim_daily_checkin(date,integer)',
      'public.claim_daily_task(uuid)',
      'public.claim_organizer_voucher(uuid)',
      'public.claim_rpc_recovery(text)',
      'public.complete_daily_task(uuid)',
      'public.create_ad_banner_payment_order(uuid,uuid,text,text,integer,integer,text,text,integer)'
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_signature);
    SELECT p.prosrc INTO v_source FROM pg_catalog.pg_proc p WHERE p.oid = v_function;
    IF v_source IS NULL OR position('private.current_user_is_better_auth()' in v_source) = 0 THEN
      RAISE EXCEPTION 'USER_RPC_ISSUER_GUARD_MISSING:%', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'USER_RPC_ISSUER_POSTFLIGHT_ACL_DRIFT:%', v_signature;
    END IF;
  END LOOP;
END;
$user_rpc_issuer_postflight$;


-- A second user-scoped RPC group: social graph, personal competition state,
-- learning insights, referral awards and personal Shop records. Preserve the
-- original anonymous error checks, function ownership/search_path and ACLs.
DO $personal_rpc_issuer_preflight$
DECLARE
  v_signature text;
  v_function regprocedure;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_follow_request(uuid)',
    'public.get_my_canonical_competition_result(uuid)',
    'public.get_my_canonical_participant(uuid)',
    'public.get_my_learning_insights()',
    'public.get_my_referral_tier_awards()',
    'public.list_my_canonical_certificates()',
    'public.list_my_claimed_collective_history()',
    'public.list_my_competition_dashboard()',
    'public.list_my_participant_core()',
    'public.list_my_shop_vouchers()',
    'public.mark_my_shop_vouchers_seen()',
    'public.remove_follow(uuid)',
    'public.respond_follow_request(uuid,boolean)',
    'public.save_my_commerce_product_review(uuid,smallint,text)'
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_signature);
    IF v_function IS NULL THEN
      RAISE EXCEPTION 'PERSONAL_RPC_ISSUER_FUNCTION_MISSING:%', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid = v_function AND p.prosecdef = true
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    ) THEN
      RAISE EXCEPTION 'PERSONAL_RPC_ISSUER_FUNCTION_KIND_OR_OWNER_DRIFT:%', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'PERSONAL_RPC_ISSUER_ACL_DRIFT:%', v_signature;
    END IF;
  END LOOP;
END;
$personal_rpc_issuer_preflight$;

CREATE OR REPLACE FUNCTION public.create_follow_request(p_target_user_id uuid)
 RETURNS follows
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid uuid:=auth.uid();v_target public.profiles;v_follow public.follows;v_status text;v_actor_name text;v_actor_username text;begin if v_uid is null then raise exception 'UNAUTHORIZED';end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;if p_target_user_id is null or p_target_user_id=v_uid then raise exception 'INVALID_TARGET';end if;select * into v_target from public.profiles where id=p_target_user_id;if not found then raise exception 'USER_NOT_FOUND';end if;select * into v_follow from public.follows where follower_id=v_uid and following_id=p_target_user_id limit 1;if found then return v_follow;end if;v_status:=case when coalesce(v_target.is_public,true) then 'approved' else 'pending' end;insert into public.follows(follower_id,following_id,status) values(v_uid,p_target_user_id,v_status) returning * into v_follow;if v_status='pending' then select coalesce(full_name,'User'),username into v_actor_name,v_actor_username from public.profiles where id=v_uid;insert into public.notifications(user_id,type,title,body,data) values(p_target_user_id,'follow-request','Permintaan Mengikuti',v_actor_name||' (@'||coalesce(v_actor_username,'user')||') ingin mengikuti Anda.',jsonb_build_object('follower_id',v_uid,'following_id',p_target_user_id,'link','/profile/'||coalesce(v_actor_username,'')));end if;return v_follow;exception when unique_violation then select * into v_follow from public.follows where follower_id=v_uid and following_id=p_target_user_id limit 1;return v_follow;end;$function$;

CREATE OR REPLACE FUNCTION public.get_my_canonical_competition_result(p_competition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare v_pid uuid; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
 select id into v_pid from public.participants where competition_id=p_competition_id and user_id=v_user limit 1;
 if v_pid is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
 return public.get_canonical_competition_result(v_pid);
end; $function$;

CREATE OR REPLACE FUNCTION public.get_my_canonical_participant(p_competition_id uuid)
 RETURNS participants
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
  SELECT p
  FROM public.participants p
  WHERE p.competition_id = p_competition_id
    AND p.user_id = auth.uid()
    AND p.participant_type = 'INDIVIDUAL'
    AND private.current_user_is_better_auth()
  ORDER BY p.created_at DESC
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.get_my_learning_insights()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_catalog'
AS $function$
declare
  v_uid uuid:=auth.uid();
  v_attempt_count integer:=0;
  v_avg numeric:=0;
  v_best numeric:=0;
  v_categories text[]:=array[]::text[];
  v_recommendations jsonb:='[]'::jsonb;
begin
  if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  select count(*),coalesce(avg(a.score),0),coalesce(max(a.score),0)
    into v_attempt_count,v_avg,v_best
  from public.attempts a
  join public.participants p on p.id=a.canonical_participant_id
  where p.user_id=v_uid and a.status='FINALIZED';

  select coalesce(array_agg(x.category order by x.cnt desc,x.category asc),'{}'::text[])
    into v_categories
  from (
    select c.category,count(*) as cnt
    from public.attempts a
    join public.participants p on p.id=a.canonical_participant_id
    join public.competitions c on c.id=a.competition_id
    where p.user_id=v_uid and a.status='FINALIZED' and nullif(trim(c.category),'') is not null
    group by c.category
    order by cnt desc,c.category asc
    limit 3
  ) x;

  select coalesce(jsonb_agg(to_jsonb(r) - 'category_codes' order by r.priority desc,r.starts_at nulls last,r.created_at desc),'[]'::jsonb)
    into v_recommendations
  from (
    select c.id,c.title,c.slug,c.category,c.short_description,c.poster_url,c.status,c.registration_ends_at,c.starts_at,c.created_at,
      case when c.category = any(coalesce(v_categories,'{}'::text[])) then 2 else 1 end as priority
    from public.competitions c
    where c.visibility='PUBLIC'
      and c.status in ('PUBLISHED','REGISTRATION_OPEN')
      and (c.registration_ends_at is null or c.registration_ends_at>=now())
    order by priority desc,c.registration_ends_at nulls last,c.created_at desc
    limit 5
  ) r;

  return jsonb_build_object(
    'attempt_count',v_attempt_count,
    'average_score',round(v_avg,2),
    'best_score',v_best,
    'focus_categories',to_jsonb(v_categories),
    'recommendations',v_recommendations,
    'generated_at',now()
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_referral_tier_awards()
 RETURNS TABLE(milestone_target integer, bonus_amount numeric, referred_count integer, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  RETURN QUERY
  SELECT
    awards.milestone_target,
    awards.bonus_amount,
    awards.referred_count,
    awards.created_at
  FROM private.referral_tier_awards awards
  WHERE awards.referrer_user_id = (SELECT auth.uid())
  ORDER BY awards.milestone_target;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_canonical_certificates()
 RETURNS TABLE(participant_id uuid, competition_id uuid, participant_type text, user_id uuid, collective_participant_id uuid, full_name text, certificate_id uuid, certificate_type text, status text, serial_number text, certificate_url text, certificate_public_id text, issued_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    pc.participant_id,
    pc.competition_id,
    pc.participant_type,
    pc.user_id,
    pc.collective_participant_id,
    pc.full_name,
    pc.certificate_id,
    pc.certificate_type,
    pc.status,
    pc.serial_number,
    pc.certificate_url,
    pc.certificate_public_id,
    pc.issued_at
  from public.participant_certificates pc
  where private.current_user_is_better_auth()
    and (
      pc.user_id = (select auth.uid())
      or (
        pc.collective_participant_id is not null
        and exists (
          select 1
          from public.collective_participants cp
          where cp.id = pc.collective_participant_id
            and cp.user_id = (select auth.uid())
        )
      )
    )
  order by pc.issued_at desc nulls last;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_claimed_collective_history()
 RETURNS TABLE(participant_id uuid, competition_id uuid, competition_title text, participant_code text, full_name text, attempt_status text, score numeric, rank bigint, result_published boolean, certificate_status text, serial_number text, verification_code text, certificate_url text, issued_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  return query
  select
    cp.id,
    cp.competition_id,
    c.title,
    cp.participant_code,
    cp.full_name,
    a.status::text,
    case
      when a.status::text = 'FINALIZED'
       and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
      then a.score
      else null::numeric
    end,
    case
      when a.status::text = 'FINALIZED'
       and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
       and p.id is not null
      then private.canonical_competition_rank(cp.competition_id, p.id)
      else null::bigint
    end,
    (
      a.status::text = 'FINALIZED'
      and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
    ),
    cc.status,
    cc.serial_number,
    cc.verification_code,
    cc.certificate_url,
    cc.issued_at
  from public.collective_participants cp
  join public.competitions c on c.id = cp.competition_id
  left join public.participants p
    on p.competition_id = cp.competition_id
   and p.collective_participant_id = cp.id
   and p.participant_type = 'COLLECTIVE'
  left join lateral (
    select a1.status, a1.score
    from public.attempts a1
    where a1.canonical_participant_id = p.id
      and a1.is_preview = false
    order by a1.created_at desc, a1.attempt_number desc, a1.id desc
    limit 1
  ) a on true
  left join public.collective_certificates cc
    on cc.collective_participant_id = cp.id
  where cp.user_id = auth.uid()
  order by c.title, cp.full_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_competition_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  with individual_competition_ids as (
    select r.competition_id
    from public.registrations r
    where r.user_id = v_uid

    union

    select p.competition_id
    from public.participants p
    where p.user_id = v_uid
      and p.participant_type = 'INDIVIDUAL'
  ),
  individual_rows as (
    select
      jsonb_build_object(
        'entry_id', coalesce(p.id, r.id),
        'participant_type', 'INDIVIDUAL',
        'participant', case
          when p.id is null then null
          else jsonb_build_object(
            'id', p.id,
            'full_name', p.full_name,
            'participant_type', p.participant_type,
            'participant_code', p.participant_code,
            'class_name', p.class_name,
            'grade', p.grade
          )
        end,
        'competition', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'title', c.title,
          'category', c.category,
          'status', c.status,
          'poster_url', c.poster_url,
          'registration_starts_at', c.registration_starts_at,
          'registration_ends_at', c.registration_ends_at,
          'starts_at', c.starts_at,
          'ends_at', c.ends_at,
          'announcement_at', c.announcement_at
        ),
        'registration', case
          when r.id is null then null
          else jsonb_build_object(
            'id', r.id,
            'status', r.status,
            'submitted_at', r.submitted_at,
            'approved_at', r.approved_at,
            'rejected_at', r.rejected_at,
            'rejection_reason', r.rejection_reason
          )
        end,
        'latest_attempt', case
          when latest_attempt.id is null then null
          else jsonb_build_object(
            'id', latest_attempt.id,
            'status', latest_attempt.status,
            'attempt_number', latest_attempt.attempt_number,
            'started_at', latest_attempt.started_at,
            'expires_at', latest_attempt.expires_at,
            'submitted_at', latest_attempt.submitted_at,
            'finalized_at', latest_attempt.finalized_at
          )
        end,
        'result', jsonb_build_object(
          'published',
            latest_finalized.id is not null
            and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED'),
          'score', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
            then latest_finalized.score
            else null
          end,
          'rank', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
             and p.id is not null
            then private.canonical_competition_rank(c.id, p.id)
            else null
          end,
          'finalized_at', latest_finalized.finalized_at
        ),
        'certificate_count', coalesce(certs.certificate_count, 0),
        'published_certificate_count', coalesce(certs.published_certificate_count, 0)
      ) as item,
      greatest(
        coalesce(latest_attempt.updated_at, latest_attempt.created_at),
        r.updated_at,
        p.updated_at,
        c.created_at
      ) as activity_at
    from individual_competition_ids ids
    join public.competitions c on c.id = ids.competition_id
    left join public.participants p
      on p.competition_id = c.id
     and p.user_id = v_uid
     and p.participant_type = 'INDIVIDUAL'
    left join lateral (
      select r1.*
      from public.registrations r1
      where r1.competition_id = c.id
        and r1.user_id = v_uid
      order by r1.created_at desc, r1.updated_at desc, r1.id desc
      limit 1
    ) r on true
    left join lateral (
      select a1.*
      from public.attempts a1
      where a1.canonical_participant_id = p.id
        and a1.is_preview = false
      order by a1.attempt_number desc, a1.created_at desc, a1.id desc
      limit 1
    ) latest_attempt on true
    left join lateral (
      select a1.id, a1.score, a1.finalized_at
      from public.attempts a1
      where a1.canonical_participant_id = p.id
        and a1.status = 'FINALIZED'
        and a1.is_preview = false
      order by a1.finalized_at desc nulls last, a1.created_at desc, a1.id desc
      limit 1
    ) latest_finalized on true
    left join lateral (
      select
        count(*)::integer as certificate_count,
        count(*) filter (where pc.status::text = 'PUBLISHED')::integer as published_certificate_count
      from public.participant_certificates pc
      where pc.participant_id = p.id
        and pc.user_id = v_uid
    ) certs on true
  ),
  claimed_collective_rows as (
    select
      jsonb_build_object(
        'entry_id', coalesce(p.id, cp.id),
        'participant_type', 'COLLECTIVE',
        'participant', jsonb_build_object(
          'id', p.id,
          'full_name', cp.full_name,
          'participant_type', 'COLLECTIVE',
          'participant_code', cp.participant_code,
          'class_name', cp.class_name,
          'grade', cp.grade
        ),
        'competition', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'title', c.title,
          'category', c.category,
          'status', c.status,
          'poster_url', c.poster_url,
          'registration_starts_at', c.registration_starts_at,
          'registration_ends_at', c.registration_ends_at,
          'starts_at', c.starts_at,
          'ends_at', c.ends_at,
          'announcement_at', c.announcement_at
        ),
        'registration', null,
        'latest_attempt', case
          when latest_attempt.id is null then null
          else jsonb_build_object(
            'id', latest_attempt.id,
            'status', latest_attempt.status,
            'attempt_number', latest_attempt.attempt_number,
            'started_at', latest_attempt.started_at,
            'expires_at', latest_attempt.expires_at,
            'submitted_at', latest_attempt.submitted_at,
            'finalized_at', latest_attempt.finalized_at
          )
        end,
        'result', jsonb_build_object(
          'published',
            latest_finalized.id is not null
            and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED'),
          'score', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
            then latest_finalized.score
            else null
          end,
          'rank', case
            when latest_finalized.id is not null
             and c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED')
             and p.id is not null
            then private.canonical_competition_rank(c.id, p.id)
            else null
          end,
          'finalized_at', latest_finalized.finalized_at
        ),
        'certificate_count', coalesce(certs.certificate_count, 0),
        'published_certificate_count', coalesce(certs.published_certificate_count, 0)
      ) as item,
      greatest(
        coalesce(latest_attempt.updated_at, latest_attempt.created_at),
        cp.updated_at,
        p.updated_at,
        c.created_at
      ) as activity_at
    from public.collective_participants cp
    join public.competitions c on c.id = cp.competition_id
    left join public.participants p
      on p.competition_id = cp.competition_id
     and p.collective_participant_id = cp.id
     and p.participant_type = 'COLLECTIVE'
    left join lateral (
      select a1.*
      from public.attempts a1
      where (
        (p.id is not null and a1.canonical_participant_id = p.id)
        or (p.id is null and a1.collective_participant_id = cp.id)
      )
        and a1.is_preview = false
      order by a1.attempt_number desc, a1.created_at desc, a1.id desc
      limit 1
    ) latest_attempt on true
    left join lateral (
      select a1.id, a1.score, a1.finalized_at
      from public.attempts a1
      where (
        (p.id is not null and a1.canonical_participant_id = p.id)
        or (p.id is null and a1.collective_participant_id = cp.id)
      )
        and a1.status = 'FINALIZED'
        and a1.is_preview = false
      order by a1.finalized_at desc nulls last, a1.created_at desc, a1.id desc
      limit 1
    ) latest_finalized on true
    left join lateral (
      select
        count(*)::integer as certificate_count,
        count(*) filter (where pc.status::text = 'PUBLISHED')::integer as published_certificate_count
      from public.participant_certificates pc
      where pc.participant_id = p.id
        and pc.collective_participant_id = cp.id
        and exists (
          select 1
          from public.collective_participants owner_cp
          where owner_cp.id = cp.id
            and owner_cp.user_id = v_uid
        )
    ) certs on true
    where cp.user_id = v_uid
  ),
  all_rows as (
    select item, activity_at from individual_rows
    union all
    select item, activity_at from claimed_collective_rows
  )
  select coalesce(
    jsonb_agg(item order by activity_at desc nulls last),
    '[]'::jsonb
  )
  into v_result
  from all_rows;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_participant_core()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'AUTHORIZATION_REQUIRED';
  end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      jsonb_build_object(
        'participant', to_jsonb(p),
        'competition', jsonb_build_object(
          'id', c.id,
          'slug', c.slug,
          'title', c.title,
          'status', c.status,
          'poster_url', c.poster_url
        ),
        'registration', jsonb_build_object(
          'id', r.id,
          'status', r.status,
          'submitted_at', r.submitted_at,
          'approved_at', r.approved_at,
          'rejected_at', r.rejected_at
        ),
        'latest_attempt', case
          when a.id is null then null
          else jsonb_build_object(
            'id', a.id,
            'status', a.status,
            'attempt_number', a.attempt_number,
            'started_at', a.started_at,
            'expires_at', a.expires_at,
            'submitted_at', a.submitted_at,
            'finalized_at', a.finalized_at,
            'score', case
              when c.status::text in ('RESULT_PUBLISHED', 'ARCHIVED') then a.score
              else null
            end
          )
        end,
        'certificate_count', (
          select count(*)
          from public.certificates cert
          where cert.canonical_participant_id = p.id
        )
      ) as row_data,
      c.created_at
    from public.participants p
    join public.competitions c on c.id = p.competition_id
    left join public.registrations r on r.id = p.registration_id
    left join lateral (
      select a1.*
      from public.attempts a1
      where a1.canonical_participant_id = p.id
        and a1.is_preview = false
      order by a1.attempt_number desc, a1.created_at desc, a1.id desc
      limit 1
    ) a on true
    where p.user_id = v_uid
      and p.participant_type = 'INDIVIDUAL'
  ) s;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_my_shop_vouchers()
 RETURNS TABLE(id uuid, name text, description text, usage_type text, duration_hours integer, benefit_group text, benefit_type text, discount_value numeric, discount_currency text, scope_type text, starts_at timestamp with time zone, ends_at timestamp with time zone, issued_at timestamp with time zone, activated_at timestamp with time zone, active_until timestamp with time zone, status text, viewed_at timestamp with time zone, is_new boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  return query
  select uv.id,d.name,d.description,d.usage_type,d.duration_hours,d.benefit_group,d.benefit_type,
    d.discount_value,d.discount_currency,d.scope_type,d.starts_at,d.ends_at,uv.issued_at,
    uv.activated_at,uv.active_until,
    case
      when uv.status='USED' then 'USED'
      when uv.status='RESERVED' then 'RESERVED'
      when (uv.status='ACTIVE' and uv.active_until <= now()) or (d.ends_at is not null and d.ends_at <= now()) then 'EXPIRED'
      when uv.status='ACTIVE' and uv.activated_at > now() then 'READY'
      when uv.status='ACTIVE' then 'ACTIVE'
      else uv.status
    end,
    uv.viewed_at,(uv.viewed_at is null)
  from public.shop_user_vouchers uv
  join public.shop_voucher_definitions d on d.id=uv.definition_id
  where uv.user_id=auth.uid()
  order by uv.issued_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_my_shop_vouchers_seen()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  update public.shop_user_vouchers set viewed_at=now()
  where user_id=auth.uid() and viewed_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_follow(p_target_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid uuid:=auth.uid();begin if v_uid is null then raise exception 'UNAUTHORIZED';end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;delete from public.follows where follower_id=v_uid and following_id=p_target_user_id;end;$function$;

CREATE OR REPLACE FUNCTION public.respond_follow_request(p_follower_id uuid, p_accept boolean)
 RETURNS follows
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_uid uuid:=auth.uid();v_follow public.follows;v_out public.follows;v_name text;v_username text;begin if v_uid is null then raise exception 'UNAUTHORIZED';end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;select * into v_follow from public.follows where follower_id=p_follower_id and following_id=v_uid for update;if not found then raise exception 'FOLLOW_REQUEST_NOT_FOUND';end if;if v_follow.status<>'pending' then return v_follow;end if;if p_accept then update public.follows set status='approved' where id=v_follow.id returning * into v_out;select coalesce(full_name,'User'),username into v_name,v_username from public.profiles where id=v_uid;insert into public.notifications(user_id,type,title,body,data) values(p_follower_id,'follow-accepted','Permintaan Diikuti Diterima',v_name||' menerima permintaan mengikuti Anda.',jsonb_build_object('follower_id',p_follower_id,'following_id',v_uid,'link','/profile/'||coalesce(v_username,'')));else delete from public.follows where id=v_follow.id;v_out:=v_follow;v_out.status:='rejected';end if;return v_out;end;$function$;

CREATE OR REPLACE FUNCTION public.save_my_commerce_product_review(p_product_id uuid, p_rating smallint, p_review text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_review text := pg_catalog.btrim(coalesce(p_review, ''));
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'INVALID_RATING' using errcode = '22023';
  end if;
  if pg_catalog.char_length(v_review) > 1200 then
    raise exception 'REVIEW_TOO_LONG' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.product_ref = p_product_id::text
      and o.user_id = v_user_id
      and o.status::text in ('PAID', 'COMPLETED')
  ) then
    raise exception 'VERIFIED_PURCHASE_REQUIRED' using errcode = '42501';
  end if;

  insert into public.commerce_product_reviews (
    product_id, user_id, rating, review, updated_at
  )
  values (
    p_product_id, v_user_id, p_rating, v_review, pg_catalog.now()
  )
  on conflict (user_id, product_id) do update
    set rating = excluded.rating,
        review = excluded.review,
        updated_at = pg_catalog.now();
end;
$function$;

DO $personal_rpc_issuer_postflight$
DECLARE
  v_signature text;
  v_function regprocedure;
  v_source text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_follow_request(uuid)',
    'public.get_my_canonical_competition_result(uuid)',
    'public.get_my_canonical_participant(uuid)',
    'public.get_my_learning_insights()',
    'public.get_my_referral_tier_awards()',
    'public.list_my_canonical_certificates()',
    'public.list_my_claimed_collective_history()',
    'public.list_my_competition_dashboard()',
    'public.list_my_participant_core()',
    'public.list_my_shop_vouchers()',
    'public.mark_my_shop_vouchers_seen()',
    'public.remove_follow(uuid)',
    'public.respond_follow_request(uuid,boolean)',
    'public.save_my_commerce_product_review(uuid,smallint,text)'
  ]
  LOOP
    v_function := pg_catalog.to_regprocedure(v_signature);
    SELECT p.prosrc INTO v_source FROM pg_catalog.pg_proc p WHERE p.oid = v_function;
    IF v_source IS NULL OR position('private.current_user_is_better_auth()' in v_source) = 0 THEN
      RAISE EXCEPTION 'PERSONAL_RPC_ISSUER_GUARD_MISSING:%', v_signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'PERSONAL_RPC_ISSUER_POSTFLIGHT_ACL_DRIFT:%', v_signature;
    END IF;
  END LOOP;
END;
$personal_rpc_issuer_postflight$;




-- Replace four identity-root personal RPCs with the shared issuer + identity-origin
-- predicate. This executes after private.current_user_is_better_auth() is defined.
CREATE OR REPLACE FUNCTION public.get_my_referrals()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone, status text, verified_at timestamp with time zone, verified_activity text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT
      re.referred_user_id,
      CASE
        WHEN re.status IN ('VERIFIED', 'CREDITED')
          THEN coalesce(p.full_name, p.username, 'Pengguna')
        ELSE 'Pengguna menunggu verifikasi'
      END AS full_name,
      CASE
        WHEN re.status IN ('VERIFIED', 'CREDITED') THEN p.username
        ELSE NULL
      END AS username,
      re.created_at AS joined_at,
      NULL::timestamptz AS last_login_at,
      CASE
        WHEN re.status = 'PENDING'
         AND re.created_at + interval '24 hours' <= now()
          THEN 'EXPIRED'
        ELSE re.status
      END AS status,
      re.verified_at,
      re.verified_activity
    FROM public.referral_events re
    JOIN private.app_users au ON au.id = re.referred_user_id
    LEFT JOIN public.profiles p ON p.id = re.referred_user_id
    WHERE re.referrer_user_id = auth.uid()
      AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED') ORDER BY re.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_referrals_v2()
 RETURNS TABLE(referred_user_id uuid, full_name text, username text, joined_at timestamp with time zone, last_login_at timestamp with time zone, status text, verified_at timestamp with time zone, verified_activity text, reward_amount numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT
      re.referred_user_id,
      CASE
        WHEN re.status IN ('VERIFIED', 'CREDITED')
          THEN coalesce(p.full_name, p.username, 'Pengguna')
        ELSE 'Pengguna menunggu verifikasi'
      END AS full_name,
      CASE
        WHEN re.status IN ('VERIFIED', 'CREDITED') THEN p.username
        ELSE NULL
      END AS username,
      re.created_at AS joined_at,
      NULL::timestamptz AS last_login_at,
      CASE
        WHEN re.status = 'PENDING'
         AND re.created_at + interval '24 hours' <= statement_timestamp()
          THEN 'EXPIRED'
        ELSE re.status
      END AS status,
      re.verified_at,
      re.verified_activity,
      re.reward_amount
    FROM public.referral_events re
    JOIN private.app_users au ON au.id = re.referred_user_id
    LEFT JOIN public.profiles p ON p.id = re.referred_user_id
    WHERE re.referrer_user_id = (SELECT auth.uid())
      AND re.status IN ('PENDING', 'VERIFIED', 'CREDITED') ORDER BY re.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_verified_referrals()
RETURNS TABLE (
  referred_user_id uuid,
  full_name text,
  username text,
  joined_at timestamptz,
  last_login_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  RETURN QUERY
  SELECT
      re.referred_user_id,
      coalesce(p.full_name, p.username, 'Pengguna') AS full_name,
      p.username,
      re.created_at AS joined_at,
      NULL::timestamptz AS last_login_at
    FROM public.referral_events AS re
    JOIN private.app_users AS au ON au.id = re.referred_user_id
    LEFT JOIN public.profiles AS p ON p.id = re.referred_user_id
    WHERE re.referrer_user_id = (SELECT auth.uid())
      AND re.verified_at IS NOT NULL ORDER BY re.verified_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_for_competition(p_competition_id uuid, p_participation_key text DEFAULT NULL::text, p_competition_level_id uuid DEFAULT NULL::uuid, p_social_proof_url text DEFAULT NULL::text, p_twibbon_completed boolean DEFAULT false, p_social_platform text DEFAULT NULL::text, p_social_username text DEFAULT NULL::text, p_referral_code text DEFAULT NULL::text)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_registration public.registrations;
  v_referrer_id uuid;
  v_referral_reward_amount integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT private.current_user_is_better_auth() THEN
    RAISE EXCEPTION 'BETTER_AUTH_ISSUER_REQUIRED';
  END IF;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTHORIZATION_REQUIRED';
  END IF;

  IF nullif(trim(coalesce(p_referral_code, '')), '') IS NOT NULL THEN
    SELECT rc.user_id
      INTO v_referrer_id
    FROM public.referral_codes rc
    WHERE rc.code = upper(trim(p_referral_code));

    IF v_referrer_id IS NULL THEN
      BEGIN
        v_referrer_id := trim(p_referral_code)::uuid;
      EXCEPTION
        WHEN invalid_text_representation THEN
          v_referrer_id := NULL;
      END;
    END IF;

    IF v_referrer_id = v_user_id THEN
      v_referrer_id := NULL;
    END IF;

    IF v_referrer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM private.app_users au
      WHERE au.id = v_referrer_id
        AND au.email_verified_at IS NOT NULL
    ) THEN
      v_referrer_id := NULL;
    END IF;
  END IF;

  INSERT INTO public.registrations (
    competition_id,
    user_id,
    competition_level_id,
    participation_key,
    social_proof_url,
    metadata
  )
  VALUES (
    p_competition_id,
    v_user_id,
    p_competition_level_id,
    p_participation_key,
    nullif(trim(p_social_proof_url), ''),
    jsonb_build_object(
      'twibbon_completed', coalesce(p_twibbon_completed, false),
      'social_platform', nullif(lower(trim(p_social_platform)), ''),
      'social_username', nullif(regexp_replace(trim(coalesce(p_social_username, '')), '^@', ''), '')
    )
  )
  RETURNING * INTO v_registration;

  IF v_referrer_id IS NOT NULL THEN
    SELECT
      CASE
        WHEN s.event_reward_amount IS NOT NULL
         AND (s.starts_at IS NULL OR v_now >= s.starts_at)
         AND (s.ends_at IS NULL OR v_now < s.ends_at)
          THEN s.event_reward_amount
        ELSE s.base_reward_amount
      END
    INTO v_referral_reward_amount
    FROM private.referral_program_settings s
    WHERE s.id = true
      AND s.is_active = true;

    IF v_referral_reward_amount IS NOT NULL THEN
      INSERT INTO public.referral_events (
        referrer_user_id,
        referred_user_id,
        competition_id,
        registration_id,
        reward_amount,
        status
      )
      VALUES (
        v_referrer_id,
        v_user_id,
        p_competition_id,
        v_registration.id,
        v_referral_reward_amount,
        'PENDING'
      )
      ON CONFLICT (referred_user_id) DO NOTHING;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data
  )
  VALUES (
    v_user_id,
    'registration.create',
    'registration',
    v_registration.id::text,
    to_jsonb(v_registration)
  );

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_user_id,
    CASE WHEN v_registration.status = 'ACTIVE' THEN 'REGISTRATION_APPROVED' ELSE 'REGISTRATION_SUBMITTED' END,
    CASE WHEN v_registration.status = 'ACTIVE' THEN 'Pendaftaran otomatis disetujui' ELSE 'Pendaftaran dikirim' END,
    CASE
      WHEN v_registration.status = 'ACTIVE'
        THEN 'Pendaftaran kamu langsung aktif sesuai aturan paket organizer.'
      ELSE 'Pendaftaran kamu menunggu persetujuan penyelenggara.'
    END,
    jsonb_build_object(
      'competition_id', v_registration.competition_id,
      'registration_id', v_registration.id
    )
  );

  RETURN v_registration;
END;
$function$;

DO $stage3_identity_personal_rpc_postflight$
DECLARE
  v_name text;
  v_source text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'get_my_referrals',
    'get_my_referrals_v2',
    'get_my_verified_referrals',
    'register_for_competition'
  ] LOOP
    SELECT p.prosrc INTO v_source
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=v_name;
    IF v_source IS NULL OR pg_catalog.strpos(v_source, 'private.current_user_is_better_auth()')=0 THEN
      RAISE EXCEPTION 'STAGE3_IDENTITY_PERSONAL_RPC_ISSUER_GUARD_MISSING:%', v_name;
    END IF;
  END LOOP;
END;
$stage3_identity_personal_rpc_postflight$;


-- Stage 7 Tranche 08: enforce Better Auth identity before reading protected
-- organizer serials, certificate assets, or collective certificate orders.
-- Owner/organizer scoping is included in the initial lookup to avoid
-- distinguishing another user's object from an absent object.

CREATE OR REPLACE FUNCTION public.assign_organizer_serial(p_serial_id uuid, p_certificate_id uuid)
 RETURNS organizer_serials
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_serial public.organizer_serials;
  v_cert public.certificates;
  v_code text;
begin
  if not private.current_user_is_better_auth() then
    raise exception 'BETTER_AUTH_ISSUER_REQUIRED';
  end if;
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select s.*
    into v_serial
  from public.organizer_serials s
  where s.id = p_serial_id
    and (
      private.current_user_is_admin()
      or private.current_user_can_manage_organizer(s.organizer_id)
    )
  for update;

  if not found then
    raise exception 'SERIAL_NOT_FOUND';
  end if;

  select c.*
    into v_cert
  from public.certificates c
  join public.competitions comp
    on comp.id = c.competition_id
  where c.id = p_certificate_id
    and comp.organizer_id = v_serial.organizer_id
    and (
      private.current_user_is_admin()
      or private.current_user_can_manage_organizer(comp.organizer_id)
    );

  if not found then
    raise exception 'CERTIFICATE_NOT_FOUND';
  end if;

  if v_serial.source_order_id is not null then
    if not exists (
      select 1 from public.orders
      where id = v_serial.source_order_id and status = 'PAID'
    ) then
      raise exception 'SERIAL_PURCHASE_NOT_PAID';
    end if;
  else
    perform private.require_organizer_entitlement(v_serial.organizer_id, 'certificate_serials');
  end if;

  if v_serial.status <> 'AVAILABLE' then
    raise exception 'SERIAL_UNAVAILABLE';
  end if;

  select verification_code
    into v_code
  from public.certificate_verifications
  where certificate_id = p_certificate_id
  order by issued_at desc nulls last
  limit 1;

  if v_code is null then
    raise exception 'CERTIFICATE_VERIFICATION_NOT_FOUND';
  end if;

  update public.organizer_serials
  set status = 'ASSIGNED',
      certificate_id = p_certificate_id,
      assigned_at = now(),
      qr_payload = '/verify/' || v_code
  where id = p_serial_id
  returning * into v_serial;

  update public.certificates
  set serial_number = v_serial.serial_code,
      updated_at = now()
  where id = p_certificate_id;

  return v_serial;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_certificate_asset(
  p_certificate_id uuid,
  p_public_id text,
  p_secure_url text,
  p_width integer DEFAULT NULL::integer,
  p_height integer DEFAULT NULL::integer,
  p_version bigint DEFAULT NULL::bigint,
  p_resource_type text DEFAULT 'raw'::text,
  p_asset_kind text DEFAULT 'certificate'::text,
  p_config jsonb DEFAULT '{}'::jsonb
)
 RETURNS certificate_assets
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cert public.certificates%ROWTYPE;
  v_asset public.certificate_assets%ROWTYPE;
begin
  if not private.current_user_is_better_auth() then
    raise exception 'BETTER_AUTH_ISSUER_REQUIRED';
  end if;
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select c.*
    into v_cert
  from public.certificates c
  where c.id = p_certificate_id
    and (
      c.user_id = v_uid
      or private.current_user_is_admin()
      or (
        c.competition_id is not null
        and exists (
          select 1
          from public.competitions comp
          where comp.id = c.competition_id
            and private.current_user_is_organizer_for(comp.organizer_id)
        )
      )
    );

  -- Missing and out-of-scope certificates deliberately share the same result.
  if not found then
    raise exception 'CERTIFICATE_NOT_FOUND';
  end if;

  select a.*
    into v_asset
  from public.certificate_assets a
  where a.certificate_id = p_certificate_id
    and a.revision = v_cert.current_revision
    and a.asset_kind = p_asset_kind
  order by a.created_at desc
  limit 1;

  if found then
    update public.certificate_assets
    set public_id = p_public_id,
        secure_url = p_secure_url,
        width = p_width,
        height = p_height,
        version = p_version,
        resource_type = p_resource_type,
        config = p_config,
        updated_at = now()
    where id = v_asset.id
    returning * into v_asset;
  else
    insert into public.certificate_assets(
      certificate_id, revision, public_id, secure_url, width, height,
      version, resource_type, asset_kind, config
    )
    values (
      p_certificate_id, v_cert.current_revision, p_public_id, p_secure_url,
      p_width, p_height, p_version, p_resource_type, p_asset_kind, p_config
    )
    returning * into v_asset;
  end if;

  return v_asset;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_collective_certificate_order(p_certificate_id uuid)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_cert public.collective_certificates%rowtype;
  v_cp public.collective_participants%rowtype;
  v_order public.orders%rowtype;
  v_price numeric;
  v_gateway_method public.organizer_payment_methods%rowtype;
begin
  if not private.current_user_is_better_auth() then
    raise exception 'BETTER_AUTH_ISSUER_REQUIRED';
  end if;
  if v_uid is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  -- Resolve the certificate only through the caller-owned participant or
  -- verified Admin scope, so another user's certificate cannot be probed.
  select cc, cp
    into v_cert, v_cp
  from public.collective_certificates cc
  join public.collective_participants cp
    on cp.id = cc.collective_participant_id
  where cc.id = p_certificate_id
    and (
      cp.managed_by_user_id = v_uid
      or cp.user_id = v_uid
      or private.current_user_is_admin()
    )
  for update of cc;

  if not found then
    raise exception 'FORBIDDEN';
  end if;
  if v_cert.status not in ('ELIGIBLE', 'DRAFT') then
    raise exception 'CERTIFICATE_NOT_ORDERABLE';
  end if;

  v_price := public.get_collective_certificate_price();
  if v_price <= 0 then
    raise exception 'CERTIFICATE_PRICE_NOT_CONFIGURED';
  end if;

  if not exists (
    select 1
    from public.payment_gateway_state s
    where s.id = true
      and s.automatic_payments_enabled = true
      and s.active_provider in ('MIDTRANS', 'XENITHPAY')
  ) then
    raise exception 'GLOBAL_GATEWAY_NOT_ACTIVE';
  end if;

  select *
    into v_gateway_method
  from public.organizer_payment_methods
  where is_active = true
    and details->>'global_gateway' = 'true'
  limit 1;

  if not found then
    raise exception 'GLOBAL_PAYMENT_METHOD_NOT_CONFIGURED';
  end if;

  select o.*
    into v_order
  from public.collective_certificate_orders cco
  join public.orders o on o.id = cco.order_id
  where cco.collective_certificate_id = v_cert.id
    and o.status not in ('CANCELLED', 'REFUNDED')
  order by o.created_at desc
  limit 1
  for update of o;

  if found then
    if v_order.status = 'PAID' then
      return v_order;
    end if;
    if v_order.status = 'PENDING_PAYMENT' and v_order.payment_method_id is null then
      if exists (select 1 from public.payment_intents pi where pi.order_id = v_order.id) then
        raise exception 'PAYMENT_SESSION_ALREADY_EXISTS';
      end if;
      update public.orders
      set payment_method = v_gateway_method.name,
          payment_provider = 'GLOBAL',
          payment_method_id = v_gateway_method.id,
          payment_proof_url = null,
          payment_proof_status = 'NOT_SUBMITTED',
          updated_at = now()
      where id = v_order.id
      returning * into v_order;
      return v_order;
    end if;
    if v_order.payment_method_id = v_gateway_method.id then
      return v_order;
    end if;
    raise exception 'PAYMENT_METHOD_LOCKED';
  end if;

  insert into public.orders(
    user_id, status, subtotal, discount, shipping_cost, total, currency,
    payment_method, payment_provider, payment_method_id, contact_name,
    contact_email, contact_note, contact_fields, payment_proof_status
  )
  values (
    v_uid, 'PENDING_PAYMENT', v_price, 0, 0, v_price, 'IDR',
    v_gateway_method.name, 'GLOBAL', v_gateway_method.id, v_cp.full_name, null,
    'Kolektif certificate: ' || v_cp.participant_code,
    jsonb_build_object(
      'collective_certificate_id', v_cert.id,
      'participant_code', v_cp.participant_code
    ),
    'NOT_SUBMITTED'
  )
  returning * into v_order;

  insert into public.order_items(
    order_id, product_type, product_ref, name, quantity, unit_price,
    line_total, metadata
  )
  values (
    v_order.id, 'DIGITAL_ITEM', 'COLLECTIVE_CERTIFICATE',
    'Sertifikat Peserta Kolektif — ' || v_cp.full_name, 1, v_price, v_price,
    jsonb_build_object(
      'collective_certificate_id', v_cert.id,
      'participant_id', v_cp.id
    )
  );

  insert into public.collective_certificate_orders(
    collective_certificate_id, order_id, payer_user_id, amount, status
  )
  values (v_cert.id, v_order.id, v_uid, v_price, 'PENDING')
  on conflict (collective_certificate_id) do update
  set order_id = excluded.order_id,
      payer_user_id = excluded.payer_user_id,
      amount = excluded.amount,
      status = 'PENDING',
      updated_at = now();

  update public.collective_certificates
  set status = 'ELIGIBLE',
      updated_at = now()
  where id = v_cert.id;

  return v_order;
end;
$function$;


COMMIT;
