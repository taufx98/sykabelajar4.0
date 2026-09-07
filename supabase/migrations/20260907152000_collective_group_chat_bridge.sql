-- Bridge the existing collective portal identity into unified /pesan group chat.
-- No legacy DM/helpdesk or collective event-chat tables are removed.

create table if not exists public.chat_group_collective_reads (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  collective_participant_id uuid not null references public.collective_participants(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (group_id, collective_participant_id)
);

create index if not exists idx_chat_group_collective_reads_participant on public.chat_group_collective_reads(collective_participant_id, group_id);

alter table public.chat_group_collective_reads enable row level security;
revoke all on public.chat_group_collective_reads from anon, authenticated;

create or replace function private.chat_group_collective_id_from_realtime(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path=public,private
as $$
  select s.collective_participant_id
  from private.collective_chat_realtime_sessions s
  where s.auth_user_id=p_uid
    and s.expires_at>now()
  order by s.updated_at desc
  limit 1
$$;

create or replace function private.chat_group_can_read(p_group_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path=public,private
as $$
  select exists(
    select 1 from public.chat_group_members m
    where m.group_id=p_group_id and m.user_id=p_uid and m.status='ACTIVE'
  ) or exists(
    select 1
    from public.chat_group_members m
    where m.group_id=p_group_id
      and m.collective_participant_id=private.chat_group_collective_id_from_realtime(p_uid)
      and m.status='ACTIVE'
  )
$$;

create or replace function public.list_collective_chat_groups(p_access_token text)
returns table(
  id uuid,
  name text,
  description text,
  group_type text,
  competition_id uuid,
  owner_user_id uuid,
  join_mode text,
  member_count bigint,
  last_message text,
  last_message_at timestamptz,
  my_role text,
  unread_count bigint
)
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  return query
  select
    g.id,g.name,g.description,g.group_type,g.competition_id,g.owner_user_id,g.join_mode,
    (select count(*) from public.chat_group_members m where m.group_id=g.id and m.status='ACTIVE'),
    (select m.body from public.chat_group_messages m where m.group_id=g.id order by m.created_at desc limit 1),
    (select m.created_at from public.chat_group_messages m where m.group_id=g.id order by m.created_at desc limit 1),
    coalesce((select m.role from public.chat_group_members m where m.group_id=g.id and m.collective_participant_id=v_cp and m.status='ACTIVE'),'MEMBER'),
    (select count(*) from public.chat_group_messages m where m.group_id=g.id
       and m.created_at>coalesce((select r.last_read_at from public.chat_group_collective_reads r where r.group_id=g.id and r.collective_participant_id=v_cp),'epoch'::timestamptz))
  from public.chat_groups g
  join public.chat_group_members gm on gm.group_id=g.id
  where gm.collective_participant_id=v_cp and gm.status='ACTIVE'
  order by coalesce((select max(m.created_at) from public.chat_group_messages m where m.group_id=g.id),g.updated_at) desc;
end;
$$;

create or replace function public.get_collective_chat_group_messages(
  p_access_token text,
  p_group_id uuid,
  p_limit integer default 50,
  p_before timestamptz default null
)
returns table(
  id uuid,
  group_id uuid,
  sender_user_id uuid,
  sender_collective_participant_id uuid,
  sender_name text,
  sender_role text,
  body text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.chat_group_members m where m.group_id=p_group_id and m.collective_participant_id=v_cp and m.status='ACTIVE') then
    raise exception 'ACCESS_DENIED';
  end if;
  return query
  select
    m.id,m.group_id,m.sender_user_id,m.sender_collective_participant_id,
    coalesce(case when m.sender_collective_participant_id is not null then cp.full_name else p.full_name end,'Pengguna'),
    case
      when m.sender_collective_participant_id is not null then 'PESERTA'
      when gm.role='OWNER' then 'OWNER'
      when gm.role='ADMIN' then 'ADMIN'
      else 'MEMBER'
    end,
    m.body,m.created_at
  from public.chat_group_messages m
  left join public.profiles p on p.id=m.sender_user_id
  left join public.collective_participants cp on cp.id=m.sender_collective_participant_id
  left join public.chat_group_members gm on gm.group_id=m.group_id and gm.user_id=m.sender_user_id and gm.status='ACTIVE'
  where m.group_id=p_group_id
    and (p_before is null or m.created_at<p_before)
  order by m.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;

create or replace function public.send_collective_chat_group_message(p_access_token text,p_group_id uuid,p_body text)
returns public.chat_group_messages
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));
  v_body text:=trim(coalesce(p_body,''));
  v_row public.chat_group_messages;
  v_count integer;
  v_group public.chat_groups;
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if char_length(v_body)<1 or char_length(v_body)>2000 then raise exception 'CHAT_BODY_INVALID'; end if;
  select * into v_group from public.chat_groups where id=p_group_id;
  if not found then raise exception 'GROUP_NOT_FOUND'; end if;
  if not exists(select 1 from public.chat_group_members m where m.group_id=p_group_id and m.collective_participant_id=v_cp and m.status='ACTIVE') then
    raise exception 'ACCESS_DENIED';
  end if;
  select count(*) into v_count from public.chat_group_messages where sender_collective_participant_id=v_cp and created_at>now()-interval '1 minute';
  if v_count>=10 then raise exception 'CHAT_RATE_LIMIT'; end if;
  if exists(select 1 from public.chat_group_messages where sender_collective_participant_id=v_cp and body=v_body and created_at>now()-interval '10 seconds') then
    raise exception 'CHAT_DUPLICATE';
  end if;
  insert into public.chat_group_messages(group_id,sender_collective_participant_id,body)
  values(p_group_id,v_cp,v_body)
  returning * into v_row;
  update public.chat_groups set updated_at=now() where id=p_group_id;
  return v_row;
end;
$$;

create or replace function public.list_collective_chat_group_members(p_access_token text,p_group_id uuid)
returns table(
  id uuid,
  user_id uuid,
  collective_participant_id uuid,
  display_name text,
  username text,
  avatar_url text,
  member_role text,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path=public,private
as $$
declare
  v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.chat_group_members m where m.group_id=p_group_id and m.collective_participant_id=v_cp and m.status='ACTIVE') then
    raise exception 'ACCESS_DENIED';
  end if;
  return query
  select m.id,m.user_id,m.collective_participant_id,
    coalesce(case when m.user_id is not null then p.full_name else cp.full_name end,'Pengguna'),
    case when m.user_id is not null then p.username else null end,
    case when m.user_id is not null then p.avatar_url else cp.photo_url end,
    m.role,m.joined_at
  from public.chat_group_members m
  left join public.profiles p on p.id=m.user_id
  left join public.collective_participants cp on cp.id=m.collective_participant_id
  where m.group_id=p_group_id and m.status='ACTIVE';
end;
$$;

create or replace function public.mark_collective_chat_group_read(p_access_token text,p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path=public,private
as $$
declare v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  if not exists(select 1 from public.chat_group_members where group_id=p_group_id and collective_participant_id=v_cp and status='ACTIVE') then raise exception 'ACCESS_DENIED'; end if;
  insert into public.chat_group_collective_reads(group_id,collective_participant_id,last_read_at)
  values(p_group_id,v_cp,now())
  on conflict(group_id,collective_participant_id) do update set last_read_at=now();
  return true;
end;
$$;

create or replace function public.join_collective_chat_group(p_access_token text,p_invite_token text)
returns jsonb
language plpgsql
security definer
set search_path=public,private,extensions
as $$
declare
  v_cp uuid:=private.collective_session_participant(trim(coalesce(p_access_token,'')));
  v_group public.chat_groups;
  v_comp uuid;
  v_hash text:=encode(digest(trim(coalesce(p_invite_token,'')),'sha256'),'hex');
begin
  if v_cp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  select cp.competition_id into v_comp from public.collective_participants cp where cp.id=v_cp and cp.status='ACTIVE';
  if v_comp is null then raise exception 'COLLECTIVE_SESSION_INVALID'; end if;
  select * into v_group from public.chat_groups where invite_token_hash=v_hash and join_mode='link' limit 1;
  if not found then raise exception 'GROUP_INVITE_INVALID'; end if;
  if v_group.group_type='event' and v_group.competition_id<>v_comp then raise exception 'GROUP_EVENT_NOT_ELIGIBLE'; end if;
  insert into public.chat_group_members(group_id,collective_participant_id,role,status)
  values(v_group.id,v_cp,'MEMBER','ACTIVE')
  on conflict(group_id,collective_participant_id) do update set status='ACTIVE';
  return jsonb_build_object('ok',true,'group_id',v_group.id,'name',v_group.name);
end;
$$;

-- Replace the realtime read policy with one that supports the existing anonymous
-- Supabase auth bridge used by collective portal sessions without opening reads globally.
drop policy if exists chat_group_messages_select on public.chat_group_messages;
create policy chat_group_messages_select on public.chat_group_messages
for select to authenticated
using(private.chat_group_can_read(group_id,auth.uid()));

revoke execute on function public.list_collective_chat_groups(text) from anon;
revoke execute on function public.get_collective_chat_group_messages(text,uuid,integer,timestamptz) from anon;
revoke execute on function public.send_collective_chat_group_message(text,uuid,text) from anon;
revoke execute on function public.list_collective_chat_group_members(text,uuid) from anon;
revoke execute on function public.mark_collective_chat_group_read(text,uuid) from anon;
revoke execute on function public.join_collective_chat_group(text,text) from anon;
grant execute on function public.list_collective_chat_groups(text) to authenticated;
grant execute on function public.get_collective_chat_group_messages(text,uuid,integer,timestamptz) to authenticated;
grant execute on function public.send_collective_chat_group_message(text,uuid,text) to authenticated;
grant execute on function public.list_collective_chat_group_members(text,uuid) to authenticated;
grant execute on function public.mark_collective_chat_group_read(text,uuid) to authenticated;
grant execute on function public.join_collective_chat_group(text,text) to authenticated;
