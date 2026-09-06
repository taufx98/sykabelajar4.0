create or replace function public.provision_collective_registration(p_registration_id uuid)
returns table(participant_id uuid, participant_code text, temporary_password text, full_name text, class_name text, grade text, photo_url text)
language plpgsql
security definer
set search_path = public, private, extensions
as $function$
declare
  v_uid uuid := auth.uid();
  v_reg public.collective_registrations%rowtype;
  r record;
  v_password text;
  v_is_new_credential boolean;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED'; end if;
  select cr.* into v_reg from public.collective_registrations as cr where cr.id=p_registration_id and cr.teacher_user_id=v_uid for update;
  if not found then raise exception 'FORBIDDEN'; end if;
  if v_reg.status not in ('PAID','PROVISIONED') then raise exception 'REGISTRATION_NOT_READY'; end if;
  perform private.provision_collective_registration(p_registration_id);

  for r in
    select cp.id,cp.participant_code,cp.full_name,cp.class_name,cp.grade,cp.photo_url,
           pac.id as credential_id,pac.enabled as credential_enabled,pac.password_version
    from public.collective_participants as cp
    left join public.participant_access_credentials as pac on pac.collective_participant_id=cp.id
    where cp.registration_id=p_registration_id and cp.managed_by_user_id=v_uid and cp.status='ACTIVE'
    order by cp.created_at
  loop
    v_password := '';
    v_is_new_credential := false;
    if r.credential_id is null then
      v_password := 'SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
      insert into public.participant_access_credentials(collective_participant_id,password_hash,password_version,failed_attempts,enabled)
      values(r.id,crypt(v_password,gen_salt('bf',12)),1,0,true);
      v_is_new_credential := true;
    elsif not coalesce(r.credential_enabled,false) then
      v_password := 'SK'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));
      update public.participant_access_credentials as pac
      set password_hash=crypt(v_password,gen_salt('bf',12)),password_version=pac.password_version+1,failed_attempts=0,locked_until=null,enabled=true,updated_at=now()
      where pac.id=r.credential_id;
      v_is_new_credential := true;
    end if;

    participant_id:=r.id; participant_code:=r.participant_code; temporary_password:=v_password; full_name:=r.full_name; class_name:=r.class_name; grade:=r.grade; photo_url:=r.photo_url; return next;

    if v_is_new_credential then
      insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,reason,before_data,after_data,request_id)
      values(v_uid,'COLLECTIVE_CREDENTIAL_PROVISIONED','collective_participant',r.id::text,'Credential peserta dibuat/diaktifkan setelah pendaftaran dibayar.',jsonb_build_object('enabled',coalesce(r.credential_enabled,false),'password_version',coalesce(r.password_version,0)),jsonb_build_object('enabled',true),null);
    end if;
  end loop;

  update public.collective_registrations as cr set status='PROVISIONED',updated_at=now() where cr.id=v_reg.id and cr.status='PAID';
end;
$function$;
