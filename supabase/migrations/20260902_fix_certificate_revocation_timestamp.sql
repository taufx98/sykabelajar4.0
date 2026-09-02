begin;

create or replace function public.admin_transition_certificate(
  p_certificate_id uuid,
  p_to_status certificate_status,
  p_reason text default null
)
returns public.certificates
language plpgsql
security definer
set search_path to public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_before public.certificates%rowtype;
  v_after public.certificates%rowtype;
begin
  if v_uid is null or not exists (
    select 1
    from public.user_roles
    where user_id = v_uid
      and role = 'admin'
      and is_active = true
  ) then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_before
  from public.certificates
  where id = p_certificate_id
  for update;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;

  update public.certificates
  set status = p_to_status,
      current_revision = coalesce(current_revision, 0) + 1,
      updated_at = now()
  where id = p_certificate_id
  returning * into v_after;

  update public.certificate_verifications
  set status = p_to_status,
      revoked_at = case when p_to_status = 'REVOKED' then now() else null end
  where certificate_id = p_certificate_id;

  insert into public.audit_logs(
    actor_user_id,
    action,
    entity_type,
    entity_id,
    reason,
    before_data,
    after_data
  ) values (
    v_uid,
    'CERTIFICATE_TRANSITION',
    'certificate',
    p_certificate_id::text,
    p_reason,
    to_jsonb(v_before),
    to_jsonb(v_after)
  );

  return v_after;
end;
$function$;

commit;
