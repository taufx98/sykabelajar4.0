begin;

-- The base verification table is not a client-write surface. Public verification
-- must go through a read-only projection with only intentionally public fields.
revoke all on table public.certificate_verifications from anon, authenticated;

create or replace view public.certificate_verifications_public as
select
  certificate_id,
  verification_code,
  status,
  public_name,
  competition_title,
  achievement_title,
  issued_at,
  revoked_at
from public.certificate_verifications;

grant select on public.certificate_verifications_public to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.certificate_verifications_public from anon, authenticated;

-- Once a serial is assigned, its QR becomes the immutable public certificate
-- verification URL. Available serials may still carry the serial code until assignment.
create or replace function public.assign_organizer_serial(p_serial_id uuid, p_certificate_id uuid)
returns public.organizer_serials
language plpgsql
security definer
set search_path to public, private
as $function$
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

  perform private.require_organizer_entitlement(v_org,'certificate_serials');

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
      qr_payload = 'https://sykabelajar.id/verify/' || v_code
  where id = p_serial_id
  returning * into v_serial;

  update public.certificates
  set serial_number = v_serial.serial_code,
      updated_at = now()
  where id = p_certificate_id;

  return v_serial;
end;
$function$;

-- Backfill QR payloads for any serials already assigned before this migration.
update public.organizer_serials s
set qr_payload = 'https://sykabelajar.id/verify/' || v.verification_code
from public.certificate_verifications v
where s.certificate_id = v.certificate_id
  and s.status = 'ASSIGNED'
  and v.verification_code is not null;

commit;
