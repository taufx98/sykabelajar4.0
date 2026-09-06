-- SYKABELAJAR 4.0 — Phase 3
-- Canonical Participant -> Attempt -> Result -> Certificate contract.
-- Safe for the current production schema (Phase 2 already applied).

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id) on delete cascade,
  registration_id uuid null references public.registrations(id) on delete set null,
  user_id uuid null references public.profiles(id) on delete set null,
  collective_participant_id uuid null references public.collective_participants(id) on delete set null,
  participant_type text not null default 'INDIVIDUAL',
  participant_code text null,
  full_name text not null,
  class_name text null,
  grade text null,
  school_id uuid null references public.schools(id) on delete set null,
  photo_url text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint participants_type_check check (participant_type in ('INDIVIDUAL','COLLECTIVE')),
  constraint participants_identity_check check (((user_id is not null)::int + (collective_participant_id is not null)::int) = 1),
  constraint participants_collective_code_check check (participant_type <> 'COLLECTIVE' or participant_code is not null)
);

create unique index if not exists participants_individual_competition_uidx on public.participants(competition_id,user_id) where user_id is not null;
create unique index if not exists participants_collective_competition_uidx on public.participants(competition_id,collective_participant_id) where collective_participant_id is not null;
create unique index if not exists participants_collective_code_uidx on public.participants(competition_id,participant_code) where participant_code is not null;
create index if not exists participants_competition_idx on public.participants(competition_id);
create index if not exists participants_user_idx on public.participants(user_id) where user_id is not null;
create index if not exists participants_collective_idx on public.participants(collective_participant_id) where collective_participant_id is not null;

alter table public.participants enable row level security;
revoke all on public.participants from anon,authenticated;
drop policy if exists participants_self_select on public.participants;
drop policy if exists participants_manager_select on public.participants;
create policy participants_self_select on public.participants for select to authenticated using ((select auth.uid())=user_id);
create policy participants_manager_select on public.participants for select to authenticated using (exists(select 1 from public.collective_participants cp where cp.id=participants.collective_participant_id and (cp.managed_by_user_id=(select auth.uid()) or private.current_user_is_admin())));

create or replace function public.sync_participant_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=now(); return new; end; $$;
drop trigger if exists trg_participants_updated_at on public.participants;
create trigger trg_participants_updated_at before update on public.participants for each row execute function public.sync_participant_updated_at();

create or replace function private.ensure_canonical_participant_for_user(p_competition_id uuid,p_registration_id uuid default null)
returns uuid language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare v_uid uuid:=auth.uid();v_id uuid;v_reg public.registrations%rowtype;v_profile public.profiles%rowtype;
begin
 if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED';end if;
 if p_registration_id is not null then
  select * into v_reg from public.registrations where id=p_registration_id and user_id=v_uid and competition_id=p_competition_id limit 1;
  if not found then raise exception 'REGISTRATION_NOT_FOUND';end if;
 else
  select * into v_reg from public.registrations where competition_id=p_competition_id and user_id=v_uid and status in ('APPROVED','ACTIVE') order by created_at desc limit 1;
 end if;
 select * into v_profile from public.profiles where id=v_uid limit 1;
 if not found then raise exception 'PROFILE_NOT_FOUND';end if;
 select id into v_id from public.participants where competition_id=p_competition_id and user_id=v_uid limit 1;
 if v_id is null then
  insert into public.participants(competition_id,registration_id,user_id,participant_type,full_name,grade,school_id,photo_url)
  values(p_competition_id,v_reg.id,v_uid,'INDIVIDUAL',coalesce(v_profile.full_name,v_profile.username,'Participant'),v_profile.grade,v_profile.school_id,v_profile.avatar_url)
  returning id into v_id;
 else
  update public.participants set registration_id=coalesce(v_reg.id,registration_id),full_name=coalesce(v_profile.full_name,v_profile.username,full_name),grade=coalesce(v_profile.grade,grade),school_id=coalesce(v_profile.school_id,school_id),photo_url=coalesce(v_profile.avatar_url,photo_url) where id=v_id;
 end if;
 return v_id;
end; $$;
revoke all on function private.ensure_canonical_participant_for_user(uuid,uuid) from public,anon,authenticated;

create or replace function private.ensure_canonical_participant_for_collective(p_collective_participant_id uuid)
returns uuid language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare v_cp public.collective_participants%rowtype;v_id uuid;
begin
 select * into v_cp from public.collective_participants where id=p_collective_participant_id and status='ACTIVE' limit 1;
 if not found then raise exception 'COLLECTIVE_PARTICIPANT_NOT_FOUND';end if;
 select id into v_id from public.participants where competition_id=v_cp.competition_id and collective_participant_id=v_cp.id limit 1;
 if v_id is null then
  insert into public.participants(competition_id,registration_id,collective_participant_id,participant_type,participant_code,full_name,class_name,grade,school_id,photo_url)
  values(v_cp.competition_id,v_cp.registration_id,v_cp.id,'COLLECTIVE',v_cp.participant_code,v_cp.full_name,v_cp.class_name,v_cp.grade,v_cp.school_id,v_cp.photo_url)
  returning id into v_id;
 else
  update public.participants set registration_id=v_cp.registration_id,participant_code=v_cp.participant_code,full_name=v_cp.full_name,class_name=v_cp.class_name,grade=v_cp.grade,school_id=v_cp.school_id,photo_url=v_cp.photo_url where id=v_id;
 end if;
 return v_id;
end; $$;
revoke all on function private.ensure_canonical_participant_for_collective(uuid) from public,anon,authenticated;

alter table public.attempts add column if not exists canonical_participant_id uuid null references public.participants(id) on delete restrict;
create index if not exists attempts_canonical_participant_idx on public.attempts(canonical_participant_id);
alter table public.certificates add column if not exists canonical_participant_id uuid null references public.participants(id) on delete restrict;
create index if not exists certificates_canonical_participant_idx on public.certificates(canonical_participant_id);
alter table public.collective_certificates add column if not exists canonical_participant_id uuid null references public.participants(id) on delete restrict;
create index if not exists collective_certificates_canonical_participant_idx on public.collective_certificates(canonical_participant_id);

update public.attempts a set canonical_participant_id=p.id from public.participants p where a.canonical_participant_id is null and a.participant_id is not null and p.competition_id=a.competition_id and p.user_id=a.participant_id;
update public.attempts a set canonical_participant_id=p.id from public.participants p where a.canonical_participant_id is null and a.collective_participant_id is not null and p.competition_id=a.competition_id and p.collective_participant_id=a.collective_participant_id;
update public.certificates c set canonical_participant_id=p.id from public.participants p where c.canonical_participant_id is null and p.competition_id=c.competition_id and p.user_id=c.user_id;
update public.collective_certificates c set canonical_participant_id=p.id from public.participants p where c.canonical_participant_id is null and p.competition_id=c.competition_id and p.collective_participant_id=c.collective_participant_id;

create or replace function public.start_competition_attempt(p_competition_id uuid)
returns public.attempts language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare v_uid uuid:=auth.uid();v_registration public.registrations%rowtype;v_existing public.attempts%rowtype;v_attempt public.attempts%rowtype;v_duration integer;v_attempt_number integer;v_canonical uuid;
begin
 if v_uid is null then raise exception 'AUTHORIZATION_REQUIRED';end if;
 select * into v_registration from public.registrations where competition_id=p_competition_id and user_id=v_uid and status in ('APPROVED','ACTIVE') order by created_at desc limit 1;
 if not found then raise exception 'REGISTRATION_NOT_APPROVED';end if;
 perform 1 from public.competitions where id=p_competition_id and status='LIVE';if not found then raise exception 'COMPETITION_NOT_LIVE';end if;
 v_canonical:=private.ensure_canonical_participant_for_user(p_competition_id,v_registration.id);
 select * into v_existing from public.attempts where competition_id=p_competition_id and participant_id=v_uid and status='IN_PROGRESS' order by created_at desc limit 1;
 if found then update public.attempts set canonical_participant_id=coalesce(canonical_participant_id,v_canonical) where id=v_existing.id returning * into v_existing;return v_existing;end if;
 select coalesce(max(attempt_number),0)+1 into v_attempt_number from public.attempts where competition_id=p_competition_id and participant_id=v_uid;
 select coalesce((config->>'duration_minutes')::integer,60) into v_duration from public.competitions where id=p_competition_id;
 insert into public.attempts(competition_id,participant_id,canonical_participant_id,registration_id,attempt_number,status,started_at,expires_at,idempotency_key) values(p_competition_id,v_uid,v_canonical,v_registration.id,v_attempt_number,'IN_PROGRESS',now(),now()+make_interval(mins=>greatest(1,v_duration)),gen_random_uuid()) returning * into v_attempt;
 return v_attempt;
end; $$;
revoke all on function public.start_competition_attempt(uuid) from public,anon;grant execute on function public.start_competition_attempt(uuid) to authenticated;

create or replace function public.start_collective_competition_attempt(p_access_token text,p_competition_id uuid)
returns public.attempts language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare v_cp uuid:=private.collective_session_participant(p_access_token);v_existing public.attempts%rowtype;v_attempt public.attempts%rowtype;v_duration integer;v_num integer;v_canonical uuid;v_registration_id uuid;
begin
 if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID';end if;
 perform 1 from public.collective_participants where id=v_cp and competition_id=p_competition_id and status='ACTIVE';if not found then raise exception 'PARTICIPANT_NOT_REGISTERED';end if;
 perform 1 from public.competitions where id=p_competition_id and status='LIVE';if not found then raise exception 'COMPETITION_NOT_LIVE';end if;
 v_canonical:=private.ensure_canonical_participant_for_collective(v_cp);select registration_id into v_registration_id from public.collective_participants where id=v_cp;
 select * into v_existing from public.attempts where competition_id=p_competition_id and collective_participant_id=v_cp and status='IN_PROGRESS' order by created_at desc limit 1;
 if found then update public.attempts set canonical_participant_id=coalesce(canonical_participant_id,v_canonical) where id=v_existing.id returning * into v_existing;return v_existing;end if;
 select coalesce(max(attempt_number),0)+1 into v_num from public.attempts where competition_id=p_competition_id and collective_participant_id=v_cp;
 select coalesce((config->>'duration_minutes')::integer,60) into v_duration from public.competitions where id=p_competition_id;
 insert into public.attempts(competition_id,participant_id,collective_participant_id,canonical_participant_id,registration_id,attempt_number,status,started_at,expires_at,idempotency_key) values(p_competition_id,null,v_cp,v_canonical,v_registration_id,v_num,'IN_PROGRESS',now(),now()+make_interval(mins=>greatest(1,v_duration)),gen_random_uuid()) returning * into v_attempt;
 update public.collective_access_sessions set last_seen_at=now() where token_hash=private.hash_collective_token(p_access_token) and revoked_at is null;return v_attempt;
end; $$;
revoke all on function public.start_collective_competition_attempt(text,uuid) from public;grant execute on function public.start_collective_competition_attempt(text,uuid) to anon,authenticated;

create or replace view public.participant_results with (security_invoker=true) as
select p.id participant_id,p.competition_id,p.participant_type,p.user_id,p.collective_participant_id,p.full_name,p.class_name,p.grade,p.school_id,p.participant_code,a.id attempt_id,a.status attempt_status,a.score,a.started_at,a.submitted_at,a.finalized_at,row_number() over(partition by a.competition_id order by a.score desc,a.finalized_at asc nulls last,a.created_at asc) rank_position
from public.participants p left join lateral (select a.* from public.attempts a where a.canonical_participant_id=p.id order by case when a.status='FINALIZED' then 0 else 1 end,a.finalized_at desc nulls last,a.created_at desc limit 1) a on true;
revoke all on public.participant_results from anon,authenticated;

create or replace function public.get_my_canonical_participant(p_competition_id uuid)
returns public.participants language sql security definer set search_path='public','private','pg_catalog' as $$select p from public.participants p where p.competition_id=p_competition_id and p.user_id=auth.uid() limit 1$$;
revoke all on function public.get_my_canonical_participant(uuid) from public,anon;grant execute on function public.get_my_canonical_participant(uuid) to authenticated;

create or replace function public.get_canonical_competition_result(p_participant_id uuid)
returns jsonb language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare p public.participants;a public.attempts;v_rank bigint;
begin
 select * into p from public.participants where id=p_participant_id;if not found then raise exception 'PARTICIPANT_NOT_FOUND';end if;
 if not private.current_user_is_admin() and (p.user_id is null or p.user_id<>auth.uid()) and not exists(select 1 from public.collective_participants cp where cp.id=p.collective_participant_id and cp.managed_by_user_id=auth.uid()) then raise exception 'NOT_AUTHORIZED';end if;
 select * into a from public.attempts where canonical_participant_id=p.id and status='FINALIZED' order by finalized_at desc nulls last,created_at desc limit 1;
 if not found then return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,'name',p.full_name,'attempt',null,'rank',null);end if;
 select 1+count(*) into v_rank from public.attempts x where x.competition_id=p.competition_id and x.status='FINALIZED' and x.canonical_participant_id is not null and x.score>a.score;
 return jsonb_build_object('participant_id',p.id,'competition_id',p.competition_id,'participant_type',p.participant_type,'name',p.full_name,'attempt',jsonb_build_object('id',a.id,'status',a.status,'score',a.score,'finalized_at',a.finalized_at),'rank',v_rank);
end; $$;
revoke all on function public.get_canonical_competition_result(uuid) from public,anon;grant execute on function public.get_canonical_competition_result(uuid) to authenticated;

create or replace function public.get_my_canonical_competition_result(p_competition_id uuid)
returns jsonb language plpgsql security definer set search_path='public','private','pg_catalog' as $$declare v_pid uuid;begin if auth.uid() is null then raise exception 'AUTHORIZATION_REQUIRED';end if;select id into v_pid from public.participants where competition_id=p_competition_id and user_id=auth.uid() limit 1;if v_pid is null then raise exception 'PARTICIPANT_NOT_FOUND';end if;return public.get_canonical_competition_result(v_pid);end;$$;
revoke all on function public.get_my_canonical_competition_result(uuid) from public,anon;grant execute on function public.get_my_canonical_competition_result(uuid) to authenticated;

create or replace function public.list_my_canonical_certificates()
returns table(participant_id uuid,competition_id uuid,participant_type text,user_id uuid,collective_participant_id uuid,full_name text,certificate_id uuid,certificate_type text,status text,serial_number text,certificate_url text,certificate_public_id text,issued_at timestamptz)
language sql security definer set search_path='public','private','pg_catalog' as $$select pc.participant_id,pc.competition_id,pc.participant_type,pc.user_id,pc.collective_participant_id,pc.full_name,pc.certificate_id,pc.certificate_type,pc.status,pc.serial_number,pc.certificate_url,pc.certificate_public_id,pc.issued_at from public.participant_certificates pc where pc.user_id=auth.uid() order by pc.issued_at desc nulls last$$;
revoke all on function public.list_my_canonical_certificates() from public,anon;grant execute on function public.list_my_canonical_certificates() to authenticated;

create or replace function public.issue_certificate_for_award(p_award_id uuid)
returns public.certificates language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare v_uid uuid:=auth.uid();v_award public.awards%rowtype;v_certificate public.certificates%rowtype;v_code text;v_org uuid;v_canonical uuid;v_profile public.profiles%rowtype;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;select * into v_award from public.awards where id=p_award_id;if not found then raise exception 'AWARD_NOT_FOUND';end if;select organizer_id into v_org from public.competitions where id=v_award.competition_id;
 if not exists(select 1 from public.user_roles where user_id=v_uid and role='admin' and is_active=true) and not exists(select 1 from public.organizer_members where organizer_id=v_org and user_id=v_uid and status='ACTIVE') then raise exception 'FORBIDDEN';end if;
 select id into v_canonical from public.participants where competition_id=v_award.competition_id and user_id=v_award.user_id limit 1;
 if v_canonical is null then select * into v_profile from public.profiles where id=v_award.user_id;insert into public.participants(competition_id,user_id,participant_type,full_name,grade,school_id,photo_url) values(v_award.competition_id,v_award.user_id,'INDIVIDUAL',coalesce(v_profile.full_name,v_profile.username,'Participant'),v_profile.grade,v_profile.school_id,v_profile.avatar_url) returning id into v_canonical;end if;
 select * into v_certificate from public.certificates where user_id=v_award.user_id and competition_id=v_award.competition_id order by created_at desc limit 1;if found then update public.certificates set canonical_participant_id=coalesce(canonical_participant_id,v_canonical) where id=v_certificate.id returning * into v_certificate;return v_certificate;end if;
 insert into public.certificates(user_id,competition_id,canonical_participant_id,status,current_revision) values(v_award.user_id,v_award.competition_id,v_canonical,'GENERATED',1) returning * into v_certificate;
 v_code:='SYKA-'||upper(substr(encode(gen_random_bytes(7),'hex'),1,12));insert into public.certificate_verifications(certificate_id,verification_code,status,public_name,competition_title,achievement_title,issued_at) select v_certificate.id,v_code,'GENERATED',p.full_name,c.title,v_award.title,now() from public.profiles p join public.competitions c on c.id=v_award.competition_id where p.id=v_award.user_id;return v_certificate;
end; $$;
revoke all on function public.issue_certificate_for_award(uuid) from public,anon;grant execute on function public.issue_certificate_for_award(uuid) to authenticated;

create or replace function public.prepare_collective_certificate(p_participant_id uuid)
returns public.collective_certificates language plpgsql security definer set search_path='public','private','pg_catalog' as $$
declare cp public.collective_participants%rowtype;a public.attempts%rowtype;c public.competitions%rowtype;out_cert public.collective_certificates%rowtype;v_serial text;v_code text;v_canonical uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;select * into cp from public.collective_participants where id=p_participant_id;if cp.id is null then raise exception 'PARTICIPANT_NOT_FOUND';end if;
 if not (cp.managed_by_user_id=auth.uid() or cp.user_id=auth.uid() or private.current_user_is_admin()) then raise exception 'FORBIDDEN';end if;
 select * into c from public.competitions where id=cp.competition_id;select * into a from public.attempts where collective_participant_id=cp.id and status='FINALIZED' order by finalized_at desc nulls last,created_at desc limit 1;if a.id is null then raise exception 'RESULT_NOT_FINALIZED';end if;
 if c.status not in ('RESULT_PUBLISHED','ARCHIVED') then raise exception 'RESULT_NOT_PUBLISHED';end if;
 v_canonical:=private.ensure_canonical_participant_for_collective(cp.id);select * into out_cert from public.collective_certificates where collective_participant_id=cp.id;
 if out_cert.id is not null then update public.collective_certificates set canonical_participant_id=coalesce(canonical_participant_id,v_canonical) where id=out_cert.id returning * into out_cert;return out_cert;end if;
 v_serial:='SK-COL-'||to_char(now(),'YYYYMM')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));v_code:='VC-COL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,14));
 insert into public.collective_certificates(collective_participant_id,canonical_participant_id,competition_id,status,serial_number,verification_code) values(cp.id,v_canonical,c.id,'ELIGIBLE',v_serial,v_code) returning * into out_cert;return out_cert;
end; $$;
revoke all on function public.prepare_collective_certificate(uuid) from public,anon;grant execute on function public.prepare_collective_certificate(uuid) to authenticated;

create or replace view public.participant_certificates with (security_invoker=true) as
select p.id participant_id,p.competition_id,p.participant_type,p.user_id,p.collective_participant_id,p.full_name,c.id certificate_id,'INDIVIDUAL'::text certificate_type,c.status::text status,c.serial_number,c.certificate_url,c.certificate_public_id,c.issued_at from public.participants p join public.certificates c on c.canonical_participant_id=p.id
union all
select p.id participant_id,p.competition_id,p.participant_type,p.user_id,p.collective_participant_id,p.full_name,cc.id certificate_id,'COLLECTIVE'::text certificate_type,cc.status::text status,cc.serial_number,cc.certificate_url,cc.certificate_public_id,cc.issued_at from public.participants p join public.collective_certificates cc on cc.canonical_participant_id=p.id;
revoke all on public.participant_certificates from anon,authenticated;
