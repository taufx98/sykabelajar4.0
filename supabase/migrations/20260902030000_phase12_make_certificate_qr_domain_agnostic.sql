create or replace function public.assign_organizer_serial(p_serial_id uuid, p_certificate_id uuid)
returns public.organizer_serials
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_serial public.organizer_serials;
  v_cert public.certificates;
  v_org uuid;
  v_code text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_serial
  from public.organizer_serials
  where id = p_serial_id
  for update;
  if not found then raise exception 'SERIAL_NOT_FOUND'; end if;

  select * into v_cert
  from public.certificates
  where id = p_certificate_id;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;

  select organizer_id into v_org
  from public.competitions
  where id = v_cert.competition_id;
  if v_org is null or v_org <> v_serial.organizer_id then
    raise exception 'SERIAL_CERTIFICATE_ORGANIZER_MISMATCH';
  end if;

  if not (private.current_user_is_admin() or private.current_user_can_manage_organizer(v_org)) then
    raise exception 'ACCESS_DENIED';
  end if;

  perform private.require_organizer_entitlement(v_org, 'certificate_serials');

  if v_serial.status <> 'AVAILABLE' then raise exception 'SERIAL_UNAVAILABLE'; end if;

  select verification_code into v_code
  from public.certificate_verifications
  where certificate_id = p_certificate_id
  order by issued_at desc nulls last
  limit 1;
  if v_code is null then raise exception 'CERTIFICATE_VERIFICATION_NOT_FOUND'; end if;

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
$$;

revoke execute on function public.assign_organizer_serial(uuid, uuid) from anon;
grant execute on function public.assign_organizer_serial(uuid, uuid) to authenticated, service_role;
