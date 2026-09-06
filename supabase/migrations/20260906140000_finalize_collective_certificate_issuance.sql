-- Finalize collective certificate issuance lifecycle:
-- prepare => ELIGIBLE without serial; paid order => atomic serial + publish.
create or replace function public.prepare_collective_certificate(p_participant_id uuid)
returns public.collective_certificates
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $$
declare
  cp public.collective_participants%rowtype;
  a public.attempts%rowtype;
  c public.competitions%rowtype;
  out_cert public.collective_certificates%rowtype;
  v_canonical uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into cp from public.collective_participants where id=p_participant_id;
  if cp.id is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  if not (cp.managed_by_user_id=auth.uid() or cp.user_id=auth.uid() or private.current_user_is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into c from public.competitions where id=cp.competition_id;
  select * into a from public.attempts where collective_participant_id=cp.id and status='FINALIZED' order by finalized_at desc nulls last,created_at desc limit 1;
  if a.id is null then raise exception 'RESULT_NOT_FINALIZED'; end if;
  if c.status not in ('RESULT_PUBLISHED','ARCHIVED') then raise exception 'RESULT_NOT_PUBLISHED'; end if;
  v_canonical:=private.ensure_canonical_participant_for_collective(cp.id);
  select * into out_cert from public.collective_certificates where collective_participant_id=cp.id;
  if out_cert.id is not null then
    update public.collective_certificates
      set canonical_participant_id=coalesce(canonical_participant_id,v_canonical), updated_at=now()
    where id=out_cert.id
    returning * into out_cert;
    return out_cert;
  end if;
  insert into public.collective_certificates(
    collective_participant_id,canonical_participant_id,competition_id,status,serial_number,verification_code
  ) values (
    cp.id,v_canonical,c.id,'ELIGIBLE',null,
    'VC-COL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,14))
  ) returning * into out_cert;
  return out_cert;
end;
$$;

create or replace function public.issue_collective_certificate_after_payment(p_certificate_id uuid)
returns public.collective_certificates
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_catalog'
as $$
declare
  cert public.collective_certificates%rowtype;
  cp public.collective_participants%rowtype;
  c public.competitions%rowtype;
  v_serial text;
  v_try integer := 0;
begin
  select * into cert from public.collective_certificates where id=p_certificate_id for update;
  if not found then raise exception 'CERTIFICATE_NOT_FOUND'; end if;
  if cert.status='PUBLISHED' and cert.serial_number is not null then return cert; end if;
  if cert.status not in ('ELIGIBLE','DRAFT') then raise exception 'CERTIFICATE_NOT_ISSUABLE'; end if;
  select * into cp from public.collective_participants where id=cert.collective_participant_id;
  if not found then raise exception 'PARTICIPANT_NOT_FOUND'; end if;
  select * into c from public.competitions where id=cert.competition_id;
  perform pg_advisory_xact_lock(hashtextextended('collective-certificate-serial:'||cert.competition_id::text,0));
  loop
    v_try := v_try + 1;
    v_serial := 'SK-COL-'||to_char(now(),'YYYYMM')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
    exit when not exists(select 1 from public.collective_certificates x where x.serial_number=v_serial);
    if v_try > 5 then raise exception 'SERIAL_ALLOCATION_RETRY_EXHAUSTED'; end if;
  end loop;
  update public.collective_certificates
  set serial_number=v_serial,
      status='PUBLISHED',
      issued_at=coalesce(issued_at,now()),
      certificate_url='https://sykabelajar.my.id/sertifikat-kolektif/'||verification_code,
      updated_at=now()
  where id=cert.id
  returning * into cert;
  return cert;
end;
$$;

create or replace function public.sync_collective_certificate_order_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public','private','pg_catalog'
as $$
declare
  v_certificate_id uuid;
begin
  if new.status='PAID' and old.status is distinct from 'PAID' then
    update public.collective_certificate_orders
      set status='PAID', updated_at=now()
    where order_id=new.id
    returning collective_certificate_id into v_certificate_id;
    if v_certificate_id is not null then
      perform public.issue_collective_certificate_after_payment(v_certificate_id);
    end if;
  elsif new.status in ('CANCELLED','REFUNDED') and old.status is distinct from new.status then
    update public.collective_certificate_orders
      set status=new.status, updated_at=now()
    where order_id=new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.issue_collective_certificate_after_payment(uuid) from anon, authenticated;
revoke execute on function public.sync_collective_certificate_order_paid() from anon, authenticated;
grant execute on function public.issue_collective_certificate_after_payment(uuid) to service_role;
grant execute on function public.sync_collective_certificate_order_paid() to service_role;
