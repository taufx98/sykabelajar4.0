create or replace function public.regenerate_collective_participant_password(p_participant_id uuid)
returns table(participant_code text, temporary_password text, password_version integer)
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_uid uuid := auth.uid();
  v_code text;
  v_version integer;
  v_old_version integer;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select cp.participant_code into v_code from public.collective_participants as cp where cp.id=p_participant_id and cp.managed_by_user_id=v_uid and cp.status='ACTIVE';
  if not found then raise exception 'FORBIDDEN'; end if;
  select pac.password_version into v_old_version from public.participant_access_credentials as pac where pac.collective_participant_id=p_participant_id for update;
  if not found then raise exception 'ACCESS_NOT_READY'; end if;

  temporary_password := 'SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
  update public.participant_access_credentials as pac
  set password_hash=crypt(temporary_password,gen_salt('bf',12)),password_version=pac.password_version+1,failed_attempts=0,locked_until=null,enabled=true,updated_at=now()
  where pac.collective_participant_id=p_participant_id
  returning pac.password_version into v_version;

  participant_code:=v_code; password_version:=v_version;
  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data,request_id)
  values(v_uid,'COLLECTIVE_CREDENTIAL_REGENERATED','collective_participant',p_participant_id::text,'Credential peserta diregenerasi oleh guru/pengelola.',jsonb_build_object('password_version',v_old_version),jsonb_build_object('password_version',v_version,'previous_credential_invalidated',true),null);
  return next;
end;
$function$;
