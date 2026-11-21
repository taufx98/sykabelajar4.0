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
AS $function$ DECLARE v_uid uuid:=auth.uid();v_attempt public.attempts%ROWTYPE;v_question public.questions%ROWTYPE;v_answer public.answers%ROWTYPE;v_org uuid;v_plan text;v_key text;v_answer_text text;v_similarity numeric:=0;v_score numeric:=0;BEGIN IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;SELECT * INTO v_attempt FROM public.attempts WHERE id=p_attempt_id;IF NOT FOUND THEN RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';END IF;SELECT * INTO v_question FROM public.questions WHERE id=p_question_id;IF NOT FOUND OR lower(v_question.type) NOT IN('essay','long-answer') THEN RAISE EXCEPTION 'ESSAY_QUESTION_REQUIRED';END IF;SELECT organizer_id INTO v_org FROM public.competitions WHERE id=v_attempt.competition_id;IF NOT(private.current_user_is_active_organizer_member(v_org) OR private.current_user_is_admin()) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;SELECT op.plan_code INTO v_plan FROM public.organizer_plans op WHERE op.organizer_id=v_org AND op.is_active=true AND op.starts_at<=now() AND(op.ends_at IS NULL OR op.ends_at>now()) ORDER BY op.starts_at DESC,op.created_at DESC LIMIT 1;IF NOT EXISTS(SELECT 1 FROM public.plan_entitlements pe WHERE pe.plan_code=v_plan AND pe.capability='essay_ai_assessment' AND coalesce(pe.limit_value,0)>0) THEN RAISE EXCEPTION 'PREMIUM_REQUIRED';END IF;IF coalesce(v_question.config->'ai_assessment'->>'enabled','false')<>'true' THEN RAISE EXCEPTION 'AI_ASSESSMENT_DISABLED';END IF;v_key:=coalesce(v_question.config->>'answer_key','');IF v_key='' THEN RAISE EXCEPTION 'ANSWER_KEY_REQUIRED';END IF;SELECT * INTO v_answer FROM public.answers WHERE attempt_id=p_attempt_id AND question_id=p_question_id LIMIT 1;v_answer_text:=coalesce(v_answer.answer_json->>'value',v_answer.answer_json->>'answer','');v_similarity:=public.calculate_essay_similarity(v_key,v_answer_text);v_score:=round(coalesce(v_question.points,0)*v_similarity/100,2);INSERT INTO public.grading_items(attempt_id,question_id,grader_id,score,feedback) VALUES(p_attempt_id,p_question_id,v_uid,v_score,'AI Similarity Grade: '||to_char(v_similarity,'FM990D00')||'%') ON CONFLICT(attempt_id,question_id) DO UPDATE SET grader_id=excluded.grader_id,score=excluded.score,feedback=excluded.feedback,updated_at=now();RETURN jsonb_build_object('score',v_score,'max_score',coalesce(v_question.points,0),'similarity_percent',v_similarity,'feedback','AI Similarity Grade: '||to_char(v_similarity,'FM990D00')||'%');END;$function$;

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
AS $function$ DECLARE v_uid uuid:=auth.uid();v_org uuid;v_count integer:=0;r record;v_rank text;v_title text;v_points numeric;v_cert boolean;v_award_id uuid;BEGIN IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED';END IF;SELECT organizer_id INTO v_org FROM public.competitions WHERE id=p_competition_id;IF v_org IS NULL THEN RAISE EXCEPTION 'COMPETITION_NOT_FOUND';END IF;IF NOT private.current_user_is_admin() AND NOT private.current_user_is_active_organizer_member(v_org) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;FOR r IN SELECT a.participant_id,max(a.score) AS score,row_number() over(order by max(a.score) desc,min(a.finalized_at),a.participant_id) AS pos FROM public.attempts a WHERE a.competition_id=p_competition_id AND a.status='FINALIZED' GROUP BY a.participant_id ORDER BY max(a.score) DESC LOOP IF r.pos=1 THEN v_rank:='FIRST';ELSIF r.pos=2 THEN v_rank:='SECOND';ELSIF r.pos=3 THEN v_rank:='THIRD';ELSE v_rank:='PARTICIPANT';END IF;SELECT cr.title,cr.points,cr.certificate_enabled INTO v_title,v_points,v_cert FROM public.competition_rewards cr WHERE cr.competition_id=p_competition_id AND cr.rank_code=v_rank ORDER BY cr.created_at LIMIT 1;IF v_title IS NULL THEN v_title:=CASE v_rank WHEN 'FIRST' THEN 'Juara 1' WHEN 'SECOND' THEN 'Juara 2' WHEN 'THIRD' THEN 'Juara 3' ELSE 'Peserta' END;v_points:=0;v_cert:=(v_rank<>'PARTICIPANT');END IF;SELECT id INTO v_award_id FROM public.awards WHERE user_id=r.participant_id AND competition_id=p_competition_id AND rank_code=v_rank LIMIT 1;IF v_award_id IS NULL THEN INSERT INTO public.awards(user_id,competition_id,rank_code,title,points,issued_at,visibility) VALUES(r.participant_id,p_competition_id,v_rank,v_title,coalesce(v_points,0),now(),'PUBLIC') RETURNING id INTO v_award_id;v_count:=v_count+1;END IF;IF v_cert THEN BEGIN PERFORM public.issue_certificate_for_award(v_award_id);EXCEPTION WHEN OTHERS THEN INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,reason) VALUES(v_uid,'CERTIFICATE_ISSUE_DEFERRED','award',v_award_id::text,SQLERRM);END;END IF;END LOOP;INSERT INTO public.audit_logs(actor_user_id,action,entity_type,entity_id,reason) VALUES(v_uid,'AWARDS_GENERATED','competition',p_competition_id::text,'Generated from finalized attempts');RETURN v_count;END;$function$;

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
      OR private.current_user_is_admin()
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
      OR private.current_user_is_admin()
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
      OR private.current_user_is_admin()
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
        OR private.current_user_is_admin()
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
        OR private.current_user_is_admin()
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

  -- Private social aggregates are only available to the Better Auth owner.
  IF NOT v_is_public AND v_uid IS DISTINCT FROM p_profile_id THEN
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

COMMIT;
