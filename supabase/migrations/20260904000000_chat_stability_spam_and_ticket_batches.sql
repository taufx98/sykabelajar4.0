create unique index if not exists uq_chat_threads_open_dm_pair on public.chat_threads (least(user_id, participant_id), greatest(user_id, participant_id)) where thread_type='dm' and status='open' and participant_id is not null;
create index if not exists idx_chat_threads_ticket_status_updated on public.chat_threads (thread_type, status, updated_at desc);
create index if not exists idx_chat_messages_thread_sender_created on public.chat_messages (thread_id, sender_id, created_at desc);

create table if not exists public.chat_spam_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  strike_count integer not null default 0 check (strike_count between 0 and 4),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.chat_spam_controls enable row level security;
drop policy if exists "Chat spam control owner read" on public.chat_spam_controls;
create policy "Chat spam control owner read" on public.chat_spam_controls for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.get_chat_spam_status()
returns jsonb language plpgsql security definer set search_path='public'
as $$
declare v_uid uuid := auth.uid(); v public.chat_spam_controls;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v from public.chat_spam_controls where user_id=v_uid;
  if not found or v.window_started_at <= now()-interval '7 days' then
    return jsonb_build_object('warning_level',0,'strike_count',0,'blocked_until',null,'reset_at',now()+interval '7 days');
  end if;
  return jsonb_build_object('warning_level',v.strike_count,'strike_count',v.strike_count,'blocked_until',v.blocked_until,'reset_at',v.window_started_at+interval '7 days');
end;
$$;

create or replace function public.get_admin_chat_history(p_search text default null, p_rating integer default null, p_handled_by uuid default null, p_sort_desc boolean default true, p_limit integer default 100)
returns table(thread_id uuid,user_id uuid,user_name text,username text,status text,rating integer,handled_by uuid,handled_name text,handled_username text,created_at timestamptz,closed_at timestamptz,subject text,description text,message_count bigint)
language plpgsql security definer set search_path='public','private'
as $$
begin
  if not private.current_user_is_admin() then raise exception 'ACCESS_DENIED'; end if;
  return query
  select t.id,t.user_id,coalesce(p.full_name,p.username,'User'),p.username,t.status,t.rating,t.handled_by,hp.full_name,hp.username,t.created_at,t.closed_at,t.subject,t.description,
         (select count(*) from public.chat_messages m where m.thread_id=t.id)
  from public.chat_threads t
  left join public.profiles p on p.id=t.user_id
  left join public.profiles hp on hp.id=t.handled_by
  where t.thread_type='ticket' and t.status='closed'
    and (p_search is null or trim(p_search)='' or coalesce(p.full_name,'') ilike '%'||trim(p_search)||'%' or coalesce(p.username,'') ilike '%'||trim(p_search)||'%')
    and (p_rating is null or t.rating=p_rating)
    and (p_handled_by is null or t.handled_by=p_handled_by)
  order by case when p_sort_desc then t.closed_at end desc, case when not p_sort_desc then t.closed_at end asc
  limit least(greatest(coalesce(p_limit,100),1),500);
end;
$$;

create or replace function public.load_my_threads_v2(p_limit integer default 50)
returns setof jsonb language sql security definer set search_path='public'
as $$
with base as (
  select t.*,p1.full_name user_name,p1.username,p1.avatar_url,p2.full_name other_user_name,p2.username other_username,p2.avatar_url other_avatar_url,lm.body last_message,lm.created_at last_message_at
  from public.chat_threads t
  left join public.profiles p1 on p1.id=t.user_id
  left join public.profiles p2 on p2.id=t.participant_id
  left join lateral (select m.body,m.created_at from public.chat_messages m where m.thread_id=t.id and m.created_at>=coalesce((select h.hidden_at from public.chat_thread_hidden h where h.thread_id=t.id and h.user_id=auth.uid()),'epoch'::timestamptz) order by m.created_at desc limit 1) lm on true
  where (t.user_id=auth.uid() or t.participant_id=auth.uid() or public.is_active_admin(auth.uid()))
    and (public.is_active_admin(auth.uid()) is false or t.thread_type='ticket')
    and (not exists(select 1 from public.chat_thread_hidden h where h.thread_id=t.id and h.user_id=auth.uid()) or exists(select 1 from public.chat_messages m join public.chat_thread_hidden h on h.thread_id=m.thread_id and h.user_id=auth.uid() where m.thread_id=t.id and m.created_at>h.hidden_at))
  order by coalesce(lm.created_at,t.updated_at,t.created_at) desc
  limit least(greatest(coalesce(p_limit,50),1),50)
)
select to_jsonb(base)||jsonb_build_object('unread_count',case when base.thread_type='ticket' and base.status='closed' then 0 else least(99,(select count(*) from public.chat_messages m where m.thread_id=base.id and m.sender_id<>auth.uid() and m.created_at>coalesce((select r.last_read_at from public.chat_thread_reads r where r.thread_id=base.id and r.user_id=auth.uid()),'epoch'::timestamptz))) end)
from base;
$$;

create or replace function public.create_ticket_thread(p_subject text,p_description text)
returns public.chat_threads language plpgsql security definer set search_path='public','private'
as $$
declare v_uid uuid:=auth.uid(); v_admin uuid; v_thread public.chat_threads; v_subject text:=nullif(trim(p_subject),''); v_description text:=nullif(trim(p_description),'');
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if v_subject is null then raise exception 'SUBJECT_REQUIRED'; end if;
  if v_description is null then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if exists(select 1 from public.chat_threads where user_id=v_uid and thread_type='ticket' and status='open') then raise exception 'ACTIVE_TICKET_EXISTS'; end if;
  select ur.user_id into v_admin from public.user_roles ur where ur.role='admin'::app_role and ur.is_active=true order by ur.created_at limit 1;
  if v_admin is null then raise exception 'ADMIN_UNAVAILABLE'; end if;
  insert into public.chat_threads(user_id,participant_id,status,thread_type,subject,description) values(v_uid,v_admin,'open','ticket',v_subject,v_description) returning * into v_thread;
  insert into public.chat_messages(thread_id,sender_id,body) values(v_thread.id,v_uid,v_subject||E'\n\n'||v_description);
  return v_thread;
end;
$$;

create or replace function public.send_chat_message(p_thread_id uuid,p_body text)
returns public.chat_messages language plpgsql security definer set search_path='public','private'
as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads; v_msg public.chat_messages; v_other uuid; v_spam public.chat_spam_controls; v_now timestamptz:=now(); v_count integer; v_next integer; v_minutes integer; v_until timestamptz;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if nullif(trim(p_body),'') is null then raise exception 'MESSAGE_REQUIRED'; end if;
  select * into v_thread from public.chat_threads where id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  if v_thread.status<>'open' then raise exception 'THREAD_CLOSED'; end if;
  if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or public.is_active_admin(v_uid)) then raise exception 'ACCESS_DENIED'; end if;
  if v_thread.thread_type='dm' and public.is_chat_blocked(v_thread.user_id,v_thread.participant_id) then raise exception 'CHAT_BLOCKED'; end if;
  if not public.is_active_admin(v_uid) then
    select * into v_spam from public.chat_spam_controls where user_id=v_uid for update;
    if found and v_spam.window_started_at<=v_now-interval '7 days' then
      update public.chat_spam_controls set window_started_at=v_now,strike_count=0,blocked_until=null,updated_at=v_now where user_id=v_uid returning * into v_spam;
    elsif not found then
      insert into public.chat_spam_controls(user_id) values(v_uid) returning * into v_spam;
    end if;
    if v_spam.blocked_until is not null and v_spam.blocked_until>v_now then
      raise exception 'SPAM_COOLDOWN:%:%',v_spam.strike_count,to_char(v_spam.blocked_until,'YYYY-MM-DD"T"HH24:MI:SSOF');
    end if;
    select count(*) into v_count from public.chat_messages where sender_id=v_uid and created_at>=v_now-interval '10 seconds';
    if v_count>=4 then
      v_next:=least(4,v_spam.strike_count+1);
      v_minutes:=case v_next when 1 then 1 when 2 then 10 when 3 then 60 else 1440 end;
      v_until:=v_now+make_interval(mins=>v_minutes);
      update public.chat_spam_controls set strike_count=v_next,blocked_until=v_until,updated_at=v_now where user_id=v_uid;
      raise exception 'SPAM_COOLDOWN:%:%',v_next,to_char(v_until,'YYYY-MM-DD"T"HH24:MI:SSOF');
    end if;
  end if;
  insert into public.chat_messages(thread_id,sender_id,body) values(p_thread_id,v_uid,trim(p_body)) returning * into v_msg;
  update public.chat_threads set updated_at=v_msg.created_at where id=p_thread_id;
  if v_thread.thread_type='dm' then
    v_other:=case when v_thread.user_id=v_uid then v_thread.participant_id else v_thread.user_id end;
    update public.chat_thread_hidden set hidden_at=v_msg.created_at where thread_id=p_thread_id and user_id=v_other;
  end if;
  return v_msg;
end;
$$;

revoke all on function public.get_chat_spam_status() from public,anon;
grant execute on function public.get_chat_spam_status() to authenticated;
revoke all on function public.send_chat_message(uuid,text) from anon;
grant execute on function public.send_chat_message(uuid,text) to authenticated;
