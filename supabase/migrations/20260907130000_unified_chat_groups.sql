-- Unified Chat Groups for /pesan.
-- Keeps existing DM/support threads untouched while adding WhatsApp-style groups.

create table if not exists public.chat_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  group_type text not null default 'general' check (group_type in ('general','event','class')),
  competition_id uuid references public.competitions(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  join_mode text not null default 'invite_only' check (join_mode in ('invite_only','link')),
  invite_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  collective_participant_id uuid references public.collective_participants(id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('OWNER','ADMIN','MEMBER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REMOVED','LEFT')),
  joined_at timestamptz not null default now(),
  unique (group_id,user_id),
  unique (group_id,collective_participant_id),
  check ((user_id is not null) <> (collective_participant_id is not null))
);

create table if not exists public.chat_group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  sender_user_id uuid references auth.users(id) on delete set null,
  sender_collective_participant_id uuid references public.collective_participants(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check ((sender_user_id is not null) <> (sender_collective_participant_id is not null))
);

create table if not exists public.chat_group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  token_hash text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_group_reads (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id,user_id)
);

create unique index if not exists uq_chat_groups_invite_token_hash on public.chat_groups(invite_token_hash) where invite_token_hash is not null;
create index if not exists idx_chat_group_members_user on public.chat_group_members(user_id,status,group_id);
create index if not exists idx_chat_group_members_collective on public.chat_group_members(collective_participant_id,status,group_id);
create index if not exists idx_chat_group_messages_group_created on public.chat_group_messages(group_id,created_at desc);

alter table public.chat_groups enable row level security;
alter table public.chat_group_members enable row level security;
alter table public.chat_group_messages enable row level security;
alter table public.chat_group_invites enable row level security;
alter table public.chat_group_reads enable row level security;
revoke all on public.chat_groups,public.chat_group_members,public.chat_group_messages,public.chat_group_invites,public.chat_group_reads from anon,authenticated;

create or replace function private.chat_group_user_is_member(p_group_id uuid,p_uid uuid)
returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from public.chat_group_members where group_id=p_group_id and user_id=p_uid and status='ACTIVE');
$$;
create or replace function private.chat_group_user_is_admin(p_group_id uuid,p_uid uuid)
returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from public.chat_group_members where group_id=p_group_id and user_id=p_uid and status='ACTIVE' and role in ('OWNER','ADMIN'));
$$;
create or replace function private.chat_group_collective_identity(p_access_token text)
returns uuid language sql stable security definer set search_path=public,private as $$
select private.collective_session_participant(trim(coalesce(p_access_token,'')));
$$;

create or replace function public.create_chat_group(p_name text,p_description text default null,p_group_type text default 'general',p_competition_id uuid default null,p_join_mode text default 'invite_only')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_uid uuid:=auth.uid();v_group public.chat_groups;v_token text;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'GROUP_NAME_REQUIRED'; end if;
 if p_group_type not in ('general','event','class') then raise exception 'GROUP_TYPE_INVALID'; end if;
 if p_join_mode not in ('invite_only','link') then raise exception 'JOIN_MODE_INVALID'; end if;
 if p_group_type='event' and p_competition_id is null then raise exception 'EVENT_COMPETITION_REQUIRED'; end if;
 v_token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 insert into public.chat_groups(name,description,group_type,competition_id,owner_user_id,join_mode,invite_token_hash) values(trim(p_name),nullif(trim(p_description),''),p_group_type,p_competition_id,v_uid,p_join_mode,encode(digest(v_token,'sha256'),'hex')) returning * into v_group;
 insert into public.chat_group_members(group_id,user_id,role) values(v_group.id,v_uid,'OWNER');
 return jsonb_build_object('id',v_group.id,'name',v_group.name,'description',v_group.description,'group_type',v_group.group_type,'competition_id',v_group.competition_id,'join_mode',v_group.join_mode,'invite_token',v_token,'created_at',v_group.created_at);
end;$$;

create or replace function public.list_my_chat_groups()
returns table(id uuid,name text,description text,group_type text,competition_id uuid,owner_user_id uuid,join_mode text,member_count bigint,last_message text,last_message_at timestamptz,my_role text,unread_count bigint)
language sql security definer set search_path=public as $$
select g.id,g.name,g.description,g.group_type,g.competition_id,g.owner_user_id,g.join_mode,
(select count(*) from public.chat_group_members m where m.group_id=g.id and m.status='ACTIVE'),
(select m.body from public.chat_group_messages m where m.group_id=g.id order by m.created_at desc limit 1),
(select m.created_at from public.chat_group_messages m where m.group_id=g.id order by m.created_at desc limit 1),
gm.role,
(select count(*) from public.chat_group_messages m where m.group_id=g.id and m.created_at>coalesce((select r.last_read_at from public.chat_group_reads r where r.group_id=g.id and r.user_id=auth.uid()),'epoch'::timestamptz) and m.sender_user_id is distinct from auth.uid())
from public.chat_groups g join public.chat_group_members gm on gm.group_id=g.id where gm.user_id=auth.uid() and gm.status='ACTIVE' order by coalesce((select max(m.created_at) from public.chat_group_messages m where m.group_id=g.id),g.updated_at) desc;
$$;

create or replace function public.get_chat_group_members(p_group_id uuid)
returns table(id uuid,user_id uuid,collective_participant_id uuid,display_name text,username text,avatar_url text,member_role text,member_status text,joined_at timestamptz)
language sql security definer set search_path=public as $$
select m.id,m.user_id,m.collective_participant_id,coalesce(case when m.user_id is not null then p.full_name else cp.full_name end,'Pengguna'),case when m.user_id is not null then p.username else null end,case when m.user_id is not null then p.avatar_url else cp.photo_url end,m.role,m.status,m.joined_at
from public.chat_group_members m left join public.profiles p on p.id=m.user_id left join public.collective_participants cp on cp.id=m.collective_participant_id
where m.group_id=p_group_id and m.status='ACTIVE' and private.chat_group_user_is_member(p_group_id,auth.uid());
$$;

create or replace function public.get_chat_group_messages(p_group_id uuid,p_limit integer default 50,p_before timestamptz default null)
returns table(id uuid,sender_user_id uuid,sender_collective_participant_id uuid,sender_name text,sender_role text,body text,created_at timestamptz)
language sql security definer set search_path=public as $$
select m.id,m.sender_user_id,m.sender_collective_participant_id,coalesce(case when m.sender_collective_participant_id is not null then cp.full_name else p.full_name end,'Pengguna'),case when m.sender_collective_participant_id is not null then 'PESERTA' when gm.role='OWNER' then 'GURU' when gm.role='ADMIN' then 'ADMIN' else 'MEMBER' end,m.body,m.created_at
from public.chat_group_messages m left join public.profiles p on p.id=m.sender_user_id left join public.collective_participants cp on cp.id=m.sender_collective_participant_id left join public.chat_group_members gm on gm.group_id=m.group_id and gm.user_id=m.sender_user_id and gm.status='ACTIVE'
where m.group_id=p_group_id and private.chat_group_user_is_member(p_group_id,auth.uid()) and (p_before is null or m.created_at<p_before) order by m.created_at desc limit greatest(1,least(coalesce(p_limit,50),100));
$$;

create or replace function public.send_chat_group_message(p_group_id uuid,p_body text)
returns public.chat_group_messages language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid();v_row public.chat_group_messages;v_body text:=trim(coalesce(p_body,''));
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if char_length(v_body)<1 or char_length(v_body)>2000 then raise exception 'CHAT_BODY_INVALID'; end if;
 if not private.chat_group_user_is_member(p_group_id,v_uid) then raise exception 'ACCESS_DENIED'; end if;
 insert into public.chat_group_messages(group_id,sender_user_id,body) values(p_group_id,v_uid,v_body) returning * into v_row;
 update public.chat_groups set updated_at=now() where id=p_group_id; return v_row;
end;$$;

create or replace function public.add_chat_group_member(p_group_id uuid,p_user_id uuid default null,p_collective_participant_id uuid default null)
returns public.chat_group_members language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid();v_group public.chat_groups;v_comp uuid;v_member public.chat_group_members;
begin
 if v_uid is null or not private.chat_group_user_is_admin(p_group_id,v_uid) then raise exception 'ACCESS_DENIED'; end if;
 if (p_user_id is null)=(p_collective_participant_id is null) then raise exception 'MEMBER_IDENTITY_REQUIRED'; end if;
 select * into v_group from public.chat_groups where id=p_group_id; if not found then raise exception 'GROUP_NOT_FOUND'; end if;
 if p_user_id is not null and not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'USER_NOT_FOUND'; end if;
 if p_collective_participant_id is not null then select competition_id into v_comp from public.collective_participants where id=p_collective_participant_id and status='ACTIVE'; if v_comp is null then raise exception 'PARTICIPANT_NOT_FOUND'; end if; if v_group.group_type='event' and v_comp<>v_group.competition_id then raise exception 'EVENT_SCOPE_MISMATCH'; end if; end if;
 insert into public.chat_group_members(group_id,user_id,collective_participant_id,role,status) values(p_group_id,p_user_id,p_collective_participant_id,'MEMBER','ACTIVE') on conflict do update set status='ACTIVE',role='MEMBER' returning * into v_member; return v_member;
end;$$;

create or replace function public.remove_chat_group_member(p_group_id uuid,p_member_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not private.chat_group_user_is_admin(p_group_id,auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
 update public.chat_group_members set status='REMOVED' where id=p_member_id and group_id=p_group_id and role<>'OWNER'; return found;
end;$$;

create or replace function public.rename_chat_group(p_group_id uuid,p_name text)
returns public.chat_groups language plpgsql security definer set search_path=public as $$
declare v_group public.chat_groups;
begin
 if not private.chat_group_user_is_admin(p_group_id,auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
 if nullif(trim(p_name),'') is null then raise exception 'GROUP_NAME_REQUIRED'; end if;
 update public.chat_groups set name=trim(p_name),updated_at=now() where id=p_group_id returning * into v_group; if not found then raise exception 'GROUP_NOT_FOUND'; end if; return v_group;
end;$$;

create or replace function public.mark_chat_group_read(p_group_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not private.chat_group_user_is_member(p_group_id,auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
 insert into public.chat_group_reads(group_id,user_id,last_read_at) values(p_group_id,auth.uid(),now()) on conflict(group_id,user_id) do update set last_read_at=now(); return true;
end;$$;

create or replace function public.create_chat_group_invite(p_group_id uuid)
returns text language plpgsql security definer set search_path=public,extensions as $$
declare v_token text:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
begin
 if not private.chat_group_user_is_admin(p_group_id,auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
 update public.chat_groups set join_mode='link',invite_token_hash=encode(digest(v_token,'sha256'),'hex'),updated_at=now() where id=p_group_id; if not found then raise exception 'GROUP_NOT_FOUND'; end if;
 insert into public.chat_group_invites(group_id,token_hash,created_by) values(p_group_id,encode(digest(v_token,'sha256'),'hex'),auth.uid()); return v_token;
end;$$;

create or replace function public.join_chat_group(p_invite_token text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare v_uid uuid:=auth.uid();v_hash text:=encode(digest(trim(coalesce(p_invite_token,'')),'sha256'),'hex');v_group public.chat_groups;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 select * into v_group from public.chat_groups where invite_token_hash=v_hash and join_mode='link'; if not found then raise exception 'GROUP_INVITE_INVALID'; end if;
 insert into public.chat_group_members(group_id,user_id,role,status) values(v_group.id,v_uid,'MEMBER','ACTIVE') on conflict do update set status='ACTIVE'; return jsonb_build_object('ok',true,'group_id',v_group.id,'name',v_group.name);
end;$$;

create policy chat_group_messages_select on public.chat_group_messages for select to authenticated using(private.chat_group_user_is_member(group_id,auth.uid()));
create policy chat_group_messages_insert on public.chat_group_messages for insert to authenticated with check(sender_user_id=auth.uid() and sender_collective_participant_id is null and private.chat_group_user_is_member(group_id,auth.uid()));

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_group_messages') then alter publication supabase_realtime add table public.chat_group_messages; end if;
end $$;
