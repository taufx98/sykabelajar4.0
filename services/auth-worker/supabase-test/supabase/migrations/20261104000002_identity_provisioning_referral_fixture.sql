-- Disposable, synthetic Stage 3 fixture for Better Auth identity provisioning and referral lifecycle.
-- It deliberately creates no auth.users identities and contains no production records.

create extension if not exists pgtap with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

do $$ begin
  create type public.app_role as enum ('student', 'teacher', 'organizer_member', 'admin');
exception when duplicate_object then null;
end $$;

alter table private.app_users
  add column email_verified_at timestamptz,
  add column phone_verified_at timestamptz,
  add column verified_phone_identity_hash text,
  add column updated_at timestamptz not null default clock_timestamp();

create table public.profiles (
  id uuid primary key references private.app_users(id) on delete cascade,
  full_name text not null default '',
  username text unique,
  account_type text not null default 'student'
    check (account_type in ('student', 'teacher', 'organizer')),
  edu_coin bigint not null default 0,
  total_xp bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp()
);

create table public.user_roles (
  user_id uuid not null references private.app_users(id) on delete cascade,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, role)
);

create table public.user_settings (
  user_id uuid primary key references private.app_users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  notification_preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table private.referral_program_settings (
  id boolean primary key default true check (id),
  is_active boolean not null default true,
  base_reward_amount integer not null default 5 check (base_reward_amount between 1 and 100000),
  event_reward_amount integer check (event_reward_amount between 1 and 100000),
  starts_at timestamptz,
  ends_at timestamptz,
  check (starts_at is null or ends_at is null or ends_at > starts_at)
);

create table public.referral_codes (
  user_id uuid primary key references private.app_users(id) on delete cascade,
  code text not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references private.app_users(id) on delete cascade,
  referred_user_id uuid not null references private.app_users(id) on delete cascade,
  reward_amount numeric not null default 5 check (reward_amount > 0),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'VERIFIED', 'CREDITED', 'REVOKED')),
  created_at timestamptz not null default clock_timestamp(),
  verified_at timestamptz,
  last_checked_at timestamptz,
  verified_activity text
);
create unique index referral_events_one_referred_user_idx
  on public.referral_events (referred_user_id);

create table public.edu_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete cascade,
  event_type text not null,
  event_id text not null,
  amount numeric not null,
  reason text,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, event_type, event_id)
);

create table public.daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.app_users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp()
);

insert into private.referral_program_settings (id, is_active, base_reward_amount)
values (true, true, 5);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_settings enable row level security;
alter table public.referral_codes enable row level security;
alter table public.referral_events enable row level security;
alter table public.edu_coin_ledger enable row level security;
alter table public.daily_checkins enable row level security;
alter table private.app_users enable row level security;
alter table private.referral_program_settings enable row level security;

revoke all on table public.profiles, public.user_roles, public.user_settings,
  public.referral_codes, public.referral_events, public.edu_coin_ledger,
  public.daily_checkins from public, anon, authenticated;
revoke all on table private.app_users, private.referral_program_settings
  from public, anon, authenticated;
grant all on table public.profiles, public.user_roles, public.user_settings,
  public.referral_codes, public.referral_events, public.edu_coin_ledger,
  public.daily_checkins to service_role;
grant all on table private.app_users, private.referral_program_settings
  to service_role;

create or replace function private.credit_profile_currency(
  p_user_id uuid, p_currency text, p_amount numeric
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_user_id is null or p_amount is null or p_amount = 0 then return; end if;
  if p_amount < 0 or p_amount <> trunc(p_amount) then
    raise exception using errcode = '22023', message = 'INVALID_PROFILE_REWARD_AMOUNT';
  end if;
  if upper(p_currency) = 'COIN' then
    update public.profiles
      set edu_coin = coalesce(edu_coin, 0) + p_amount::bigint,
          updated_at = pg_catalog.clock_timestamp()
      where id = p_user_id;
  elsif upper(p_currency) = 'XP' then
    update public.profiles
      set total_xp = coalesce(total_xp, 0) + p_amount::bigint,
          updated_at = pg_catalog.clock_timestamp()
      where id = p_user_id;
  else
    raise exception using errcode = '22023', message = 'INVALID_PROFILE_CURRENCY';
  end if;
  if not found then raise exception 'PROFILE_NOT_FOUND'; end if;
end;
$$;

create or replace function private.apply_referral_qualification(
  p_referred_user_id uuid, p_activity text, p_occurred_at timestamptz
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_referral public.referral_events%rowtype;
  v_email_verified_at timestamptz;
  v_activity text;
  v_activity_at timestamptz;
  v_ledger_id uuid;
begin
  if p_referred_user_id is null or p_occurred_at is null
     or p_activity not in ('daily_checkin', 'comment', 'follow', 'chat', 'daily_task') then
    return false;
  end if;

  select re.* into v_referral
  from public.referral_events re
  where re.referred_user_id = p_referred_user_id
    and re.status = 'PENDING'
    and re.verified_at is null
    and p_occurred_at >= re.created_at
    and p_occurred_at < re.created_at + interval '24 hours'
    and pg_catalog.clock_timestamp() < re.created_at + interval '24 hours'
  for update;
  if not found then return false; end if;

  if v_referral.verified_activity is not null
     and v_referral.last_checked_at is not null then
    v_activity := v_referral.verified_activity;
    v_activity_at := v_referral.last_checked_at;
  else
    v_activity := p_activity;
    v_activity_at := p_occurred_at;
  end if;

  if v_activity_at < v_referral.created_at
     or v_activity_at >= v_referral.created_at + interval '24 hours'
     or pg_catalog.clock_timestamp() >= v_referral.created_at + interval '24 hours' then
    return false;
  end if;

  select au.email_verified_at into v_email_verified_at
  from private.app_users au where au.id = p_referred_user_id;
  if not found then return false; end if;

  if v_email_verified_at is null then
    if v_referral.verified_activity is null then
      update public.referral_events
      set verified_activity = v_activity, last_checked_at = v_activity_at
      where id = v_referral.id and status = 'PENDING'
        and verified_at is null and verified_activity is null;
    end if;
    return false;
  end if;

  update public.referral_events
  set verified_at = v_activity_at, verified_activity = v_activity,
      status = 'VERIFIED', last_checked_at = pg_catalog.clock_timestamp()
  where id = v_referral.id and status = 'PENDING' and verified_at is null;
  if not found then return false; end if;

  v_ledger_id := null;
  insert into public.edu_coin_ledger
    (user_id, event_type, event_id, amount, reason)
  values
    (v_referral.referrer_user_id, 'REFERRAL_REGISTRATION',
     v_referral.id::text, v_referral.reward_amount,
     'Referral pendaftaran tervalidasi')
  on conflict (user_id, event_type, event_id) do nothing
  returning id into v_ledger_id;

  if v_ledger_id is not null then
    perform private.credit_profile_currency(
      v_referral.referrer_user_id, 'COIN', v_referral.reward_amount
    );
  end if;
  return true;
end;
$$;

create or replace function private.handle_referral_daily_checkin()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.apply_referral_qualification(
    new.user_id, 'daily_checkin', new.created_at
  );
  return new;
end;
$$;
create trigger trg_fixture_referral_daily_checkin
after insert on public.daily_checkins
for each row execute function private.handle_referral_daily_checkin();

create or replace function private.provision_better_auth_user(
  p_user_id uuid,
  p_account_type text,
  p_full_name text,
  p_username text,
  p_referral_code text default null,
  p_email_verified boolean default false
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_type text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_type, 'student')));
  v_role public.app_role;
  v_referrer_id uuid;
  v_reward_amount integer;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'USER_ID_REQUIRED';
  end if;
  if v_type not in ('student', 'teacher', 'organizer') then
    raise exception using errcode = '22023', message = 'UNSUPPORTED_ACCOUNT_TYPE';
  end if;

  v_role := case v_type
    when 'teacher' then 'teacher'::public.app_role
    when 'organizer' then 'organizer_member'::public.app_role
    else 'student'::public.app_role
  end;

  insert into private.app_users (id, email_verified_at)
  values (
    p_user_id,
    case when coalesce(p_email_verified, false)
      then pg_catalog.clock_timestamp() else null end
  )
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, username, account_type)
  values (p_user_id, coalesce(nullif(pg_catalog.btrim(p_full_name), ''), ''),
          nullif(pg_catalog.lower(pg_catalog.btrim(p_username)), ''), v_type)
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role, is_active)
  values (p_user_id, v_role, true)
  on conflict (user_id, role) do nothing;

  insert into public.user_settings (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  if nullif(pg_catalog.btrim(p_referral_code), '') is not null then
    select rc.user_id into v_referrer_id
    from public.referral_codes rc
    join private.app_users au on au.id = rc.user_id
    where rc.code = pg_catalog.btrim(p_referral_code)
      and rc.user_id <> p_user_id
      and au.email_verified_at is not null;

    if v_referrer_id is not null then
      select case
        when s.event_reward_amount is not null
         and (s.starts_at is null or pg_catalog.clock_timestamp() >= s.starts_at)
         and (s.ends_at is null or pg_catalog.clock_timestamp() < s.ends_at)
          then s.event_reward_amount
        else s.base_reward_amount
      end into v_reward_amount
      from private.referral_program_settings s
      where s.id = true and s.is_active = true;

      if v_reward_amount is not null then
        insert into public.referral_events
          (referrer_user_id, referred_user_id, reward_amount, status, created_at)
        values
          (v_referrer_id, p_user_id, v_reward_amount, 'PENDING',
           pg_catalog.clock_timestamp())
        on conflict (referred_user_id) do nothing;
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'user_id', p_user_id, 'account_type', v_type, 'role', v_role
  );
end;
$$;

create or replace function private.complete_better_auth_email_verification(
  p_user_id uuid, p_verified_at timestamptz
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_event public.referral_events%rowtype;
begin
  if p_user_id is null or p_verified_at is null then
    raise exception using errcode = '22023', message = 'VERIFICATION_INPUT_REQUIRED';
  end if;

  update private.app_users
  set email_verified_at = p_verified_at,
      updated_at = pg_catalog.clock_timestamp()
  where id = p_user_id and email_verified_at is null;
  if not found then
    if exists (select 1 from private.app_users where id = p_user_id) then
      return false;
    end if;
    raise exception 'USER_IDENTITY_NOT_FOUND';
  end if;

  select re.* into v_event
  from public.referral_events re
  where re.referred_user_id = p_user_id
    and re.status = 'PENDING'
    and re.verified_at is null
    and re.verified_activity is not null
    and re.last_checked_at is not null
  for update;
  if found then
    perform private.apply_referral_qualification(
      p_user_id, v_event.verified_activity, v_event.last_checked_at
    );
  end if;
  return true;
end;
$$;

revoke all on function private.credit_profile_currency(uuid, text, numeric)
  from public, anon, authenticated;
revoke all on function private.apply_referral_qualification(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.handle_referral_daily_checkin()
  from public, anon, authenticated, service_role;
revoke all on function private.provision_better_auth_user(uuid, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function private.complete_better_auth_email_verification(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function private.provision_better_auth_user(uuid, text, text, text, text, boolean)
  to service_role;
grant execute on function private.complete_better_auth_email_verification(uuid, timestamptz)
  to service_role;
