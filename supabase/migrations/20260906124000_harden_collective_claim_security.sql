create or replace function public.claim_collective_participant(p_participant_code text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_cp public.collective_participants%rowtype;
  v_ac public.participant_access_credentials%rowtype;
  v_claimed_before boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;

  select cp.* into v_cp
  from public.collective_participants as cp
  where upper(cp.participant_code)=upper(trim(p_participant_code))
    and cp.status='ACTIVE'
  limit 1
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','INVALID_CREDENTIALS'); end if;

  v_claimed_before := v_cp.user_id is not null;
  if v_claimed_before and v_cp.user_id<>v_uid then
    return jsonb_build_object('ok',false,'reason','ALREADY_CLAIMED');
  end if;

  select pac.* into v_ac
  from public.participant_access_credentials as pac
  where pac.collective_participant_id=v_cp.id
    and pac.enabled=true
  limit 1
  for update;

  if not found then return jsonb_build_object('ok',false,'reason','ACCESS_NOT_READY'); end if;
  if v_ac.locked_until is not null and v_ac.locked_until>now() then
    return jsonb_build_object('ok',false,'reason','LOCKED');
  end if;

  if crypt(coalesce(p_password,''),v_ac.password_hash) is distinct from v_ac.password_hash then
    update public.participant_access_credentials as pac
    set failed_attempts=pac.failed_attempts+1,
        locked_until=case when pac.failed_attempts+1>=5 then now()+interval '15 minutes' else pac.locked_until end,
        updated_at=now()
    where pac.id=v_ac.id;
    return jsonb_build_object('ok',false,'reason','INVALID_CREDENTIALS');
  end if;

  update public.participant_access_credentials as pac
  set failed_attempts=0, locked_until=null, updated_at=now()
  where pac.id=v_ac.id;

  if not v_claimed_before then
    update public.collective_participants as cp
    set user_id=v_uid, updated_at=now()
    where cp.id=v_cp.id;

    insert into public.audit_logs (
      actor_user_id, action, entity_type, entity_id, reason, before_data, after_data, request_id
    ) values (
      v_uid,
      'COLLECTIVE_PARTICIPANT_CLAIMED',
      'collective_participant',
      v_cp.id::text,
      'Participant riwayat ditautkan ke akun penuh.',
      jsonb_build_object('user_id',v_cp.user_id),
      jsonb_build_object('user_id',v_uid,'competition_id',v_cp.competition_id),
      null
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'participant_id',v_cp.id,
    'competition_id',v_cp.competition_id,
    'participant_code',v_cp.participant_code,
    'already_claimed_by_current_user',v_claimed_before
  );
end;
$function$;
