create table if not exists private.organizer_free_identity_claims (
  identity_hash text primary key,
  owner_user_id uuid not null,
  organizer_id uuid not null unique references public.organizers(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists organizer_free_identity_claims_owner_idx
  on private.organizer_free_identity_claims(owner_user_id);

alter table private.organizer_free_identity_claims enable row level security;

create unique index if not exists referral_events_one_referred_user_idx
  on public.referral_events(referred_user_id);

create or replace function public.create_organizer(p_name text, p_slug text)
returns table(id uuid, name text, slug text, access_code text)
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  v_uid uuid := auth.uid();
  v_user auth.users;
  v_id uuid;
  v_code text := encode(gen_random_bytes(5),'hex');
  v_slug text := lower(regexp_replace(trim(p_slug),'[^a-zA-Z0-9]+','-','g'));
  v_phone text;
  v_identity_hash text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if nullif(trim(p_name),'') is null then raise exception 'ORGANIZER_NAME_REQUIRED'; end if;
  if nullif(trim(v_slug),'') is null then raise exception 'ORGANIZER_SLUG_REQUIRED'; end if;
  if exists(select 1 from public.organizers where owner_user_id=v_uid) then raise exception 'ORGANIZER_LIMIT_REACHED'; end if;

  select * into v_user from auth.users where id=v_uid;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_user.email_confirmed_at is null then raise exception 'EMAIL_VERIFICATION_REQUIRED'; end if;
  if v_user.phone_confirmed_at is null then raise exception 'PHONE_VERIFICATION_REQUIRED'; end if;

  v_phone := regexp_replace(coalesce(v_user.phone,''),'[^0-9]+','','g');
  if length(v_phone) < 8 then raise exception 'PHONE_VERIFICATION_REQUIRED'; end if;
  v_identity_hash := encode(digest(v_phone,'sha256'),'hex');

  if exists(select 1 from private.organizer_free_identity_claims where identity_hash=v_identity_hash) then
    raise exception 'FREE_ORGANIZER_ALREADY_CLAIMED';
  end if;

  insert into public.organizers(name,slug,owner_user_id,status)
    values(trim(p_name),trim(both '-' from v_slug),v_uid,'ACTIVE') returning id into v_id;
  insert into public.organizer_members(organizer_id,user_id,member_role,is_active,role,status)
    values(v_id,v_uid,'owner',true,'owner','ACTIVE')
    on conflict(organizer_id,user_id) do update set member_role='owner',is_active=true,role='owner',status='ACTIVE',updated_at=now();
  insert into public.organizer_plans(organizer_id,plan_code,starts_at,ends_at,is_active)
    values(v_id,'FREE',now(),now()+interval '6 months',true);
  insert into private.organizer_access_codes(organizer_id,code_hash,rotated_by)
    values(v_id,crypt(v_code,gen_salt('bf',10)),v_uid);
  insert into private.organizer_free_identity_claims(identity_hash,owner_user_id,organizer_id)
    values(v_identity_hash,v_uid,v_id);
  return query select o.id,o.name,o.slug,v_code from public.organizers o where o.id=v_id;
exception
  when unique_violation then
    raise exception 'FREE_ORGANIZER_ALREADY_CLAIMED';
end;
$function$;

create or replace function public.register_for_competition_v4_8(
  p_competition_id uuid,
  p_participation_key text default null,
  p_competition_level_id uuid default null,
  p_social_proof_url text default null,
  p_twibbon_completed boolean default false,
  p_social_platform text default null,
  p_social_username text default null,
  p_referral_code text default null
)
returns public.registrations
language plpgsql
security definer
set search_path = public
as $function$
declare
  u uuid := auth.uid();
  v_result public.registrations;
  v_referrer uuid;
begin
  if u is null then raise exception 'AUTHORIZATION_REQUIRED'; end if;

  if p_referral_code is not null then
    select user_id into v_referrer
    from public.referral_codes
    where code=upper(trim(p_referral_code));

    if v_referrer is not null and v_referrer=u then
      v_referrer := null;
    end if;

    if v_referrer is not null and not exists (
      select 1 from auth.users au
      where au.id=v_referrer and au.email_confirmed_at is not null
    ) then
      v_referrer := null;
    end if;
  end if;

  insert into public.registrations(
    competition_id,user_id,competition_level_id,participation_key,social_proof_url,metadata
  ) values (
    p_competition_id,u,p_competition_level_id,p_participation_key,nullif(trim(p_social_proof_url),''),
    jsonb_build_object(
      'twibbon_completed',coalesce(p_twibbon_completed,false),
      'social_platform',nullif(lower(trim(p_social_platform)),''),
      'social_username',nullif(regexp_replace(trim(coalesce(p_social_username,'')),'^@',''),'')
    )
  ) returning * into v_result;

  if v_referrer is not null then
    insert into public.referral_events(referrer_user_id,referred_user_id,competition_id,registration_id,reward_amount,status)
    values(v_referrer,u,p_competition_id,v_result.id,5,'PENDING')
    on conflict (referred_user_id) do nothing;
  end if;

  insert into public.audit_logs(actor_user_id,action,entity_type,entity_id,after_data)
  values(u,'registration.create','registration',v_result.id::text,to_jsonb(v_result));

  insert into public.notifications(user_id,type,title,body,data)
  values(u,
    case when v_result.status='ACTIVE' then 'REGISTRATION_APPROVED' else 'REGISTRATION_SUBMITTED' end,
    case when v_result.status='ACTIVE' then 'Pendaftaran otomatis disetujui' else 'Pendaftaran dikirim' end,
    case when v_result.status='ACTIVE' then 'Pendaftaran kamu langsung aktif sesuai aturan paket organizer.' else 'Pendaftaran kamu menunggu persetujuan penyelenggara.' end,
    jsonb_build_object('competition_id',v_result.competition_id,'registration_id',v_result.id));

  return v_result;
end;
$function$;

create or replace function public.verify_pending_referrals()
returns integer
language plpgsql
security definer
set search_path = public, private
as $function$
declare
  r record;
  n integer := 0;
  activity text;
  ts timestamptz;
begin
  for r in
    select re.*
    from public.referral_events re
    join auth.users au on au.id=re.referred_user_id
    where re.verified_at is null
      and re.status='PENDING'
      and au.email_confirmed_at is not null
      and re.created_at >= now()-interval '24 hours'
  loop
    activity:=null;
    ts:=null;

    select 'daily_checkin',created_at into activity,ts
    from public.daily_checkins
    where user_id=r.referred_user_id and created_at>=r.created_at
    order by created_at limit 1;

    if activity is null then
      select 'comment',created_at into activity,ts
      from public.comments
      where user_id=r.referred_user_id and created_at>=r.created_at
      order by created_at limit 1;
    end if;

    if activity is null then
      select 'follow',created_at into activity,ts
      from public.follows
      where follower_id=r.referred_user_id and created_at>=r.created_at
      order by created_at limit 1;
    end if;

    if activity is null then
      select 'chat',created_at into activity,ts
      from public.chat_messages
      where sender_id=r.referred_user_id and created_at>=r.created_at
      order by created_at limit 1;
    end if;

    if activity is null then
      select 'daily_task',completed_at into activity,ts
      from public.daily_task_claims
      where user_id=r.referred_user_id and status='COMPLETED' and completed_at>=r.created_at
      order by completed_at limit 1;
    end if;

    if activity is not null then
      update public.referral_events
      set verified_at=coalesce(ts,now()),verified_activity=activity,status='VERIFIED',last_checked_at=now()
      where id=r.id and verified_at is null;

      insert into public.edu_coin_ledger(user_id,event_type,event_id,amount,reason)
      values(r.referrer_user_id,'REFERRAL_REGISTRATION',r.id::text,r.reward_amount,'Referral pendaftaran tervalidasi')
      on conflict (user_id,event_type,event_id) do nothing;

      n:=n+1;
    else
      update public.referral_events set last_checked_at=now() where id=r.id;
    end if;
  end loop;
  return n;
end;
$function$;

revoke execute on function public.create_organizer(text,text) from public, anon;
grant execute on function public.create_organizer(text,text) to authenticated;
revoke execute on function public.register_for_competition_v4_8(uuid,text,uuid,text,boolean,text,text,text) from public, anon;
grant execute on function public.register_for_competition_v4_8(uuid,text,uuid,text,boolean,text,text,text) to authenticated;
revoke execute on function public.verify_pending_referrals() from public, anon, authenticated;
grant execute on function public.verify_pending_referrals() to service_role;
