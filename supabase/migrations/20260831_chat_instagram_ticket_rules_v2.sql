-- SykaBelajar Chat V2
-- Instagram-style profile messaging, single active admin ticket, secure message lifecycle,
-- persistent per-thread read state and follow request notifications.

with ranked as (
  select id,row_number() over(partition by user_id order by created_at desc,id desc) rn
  from public.chat_threads
  where status='open' and thread_type='ticket'
)
update public.chat_threads t
set status='closed',closed_at=coalesce(t.closed_at,now())
from ranked r
where t.id=r.id and r.rn>1;

create unique index if not exists uniq_open_support_ticket_per_user
  on public.chat_threads(user_id)
  where status='open' and thread_type='ticket';
create index if not exists idx_chat_threads_type_status_created
  on public.chat_threads(thread_type,status,created_at desc);

create or replace function public.is_active_admin(p_uid uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles ur where ur.user_id=p_uid and ur.role='admin'::app_role and ur.is_active=true);
$$;

create or replace function public.create_support_ticket(p_subject text,p_description text)
returns public.chat_threads language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_admin uuid; v_thread public.chat_threads; v_subject text:=nullif(trim(p_subject),''); v_description text:=nullif(trim(p_description),'');
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if v_subject is null then raise exception 'SUBJECT_REQUIRED'; end if;
 if v_description is null then raise exception 'DESCRIPTION_REQUIRED'; end if;
 select * into v_thread from public.chat_threads where user_id=v_uid and thread_type='ticket' and status='open' order by created_at desc limit 1;
 if found then raise exception 'ACTIVE_TICKET_EXISTS'; end if;
 select user_id into v_admin from public.user_roles where role='admin'::app_role and is_active=true order by created_at limit 1;
 if v_admin is null then raise exception 'ADMIN_UNAVAILABLE'; end if;
 insert into public.chat_threads(user_id,participant_id,status,thread_type,subject,description)
 values(v_uid,v_admin,'open','ticket',v_subject,v_description) returning * into v_thread;
 return v_thread;
exception when unique_violation then raise exception 'ACTIVE_TICKET_EXISTS';
end; $$;

create or replace function public.get_or_create_support_thread()
returns public.chat_threads language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 select * into v_thread from public.chat_threads where user_id=v_uid and thread_type='ticket' and status='open' order by created_at desc limit 1;
 if found then return v_thread; end if;
 raise exception 'ACTIVE_TICKET_NOT_FOUND';
end; $$;

create or replace function public.send_chat_message(p_thread_id uuid,p_body text)
returns public.chat_messages language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads; v_msg public.chat_messages;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if nullif(trim(p_body),'') is null then raise exception 'MESSAGE_REQUIRED'; end if;
 select * into v_thread from public.chat_threads where id=p_thread_id;
 if not found then raise exception 'THREAD_NOT_FOUND'; end if;
 if v_thread.status<>'open' then raise exception 'THREAD_CLOSED'; end if;
 if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or public.is_active_admin(v_uid)) then raise exception 'ACCESS_DENIED'; end if;
 insert into public.chat_messages(thread_id,sender_id,body) values(p_thread_id,v_uid,trim(p_body)) returning * into v_msg;
 return v_msg;
end; $$;

create or replace function public.get_or_create_dm_thread(p_other_user_id uuid)
returns public.chat_threads language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if p_other_user_id is null or p_other_user_id=v_uid then raise exception 'INVALID_RECIPIENT'; end if;
 if not exists(select 1 from public.profiles where id=p_other_user_id) then raise exception 'USER_NOT_FOUND'; end if;
 if not exists(select 1 from public.follows f where f.follower_id=v_uid and f.following_id=p_other_user_id and f.status in('approved','auto')) then raise exception 'FOLLOW_REQUIRED'; end if;
 select * into v_thread from public.chat_threads where status='open' and thread_type='dm' and ((user_id=v_uid and participant_id=p_other_user_id) or (user_id=p_other_user_id and participant_id=v_uid)) order by created_at desc limit 1;
 if found then return v_thread; end if;
 begin
   insert into public.chat_threads(user_id,participant_id,status,thread_type) values(v_uid,p_other_user_id,'open','dm') returning * into v_thread;
 exception when unique_violation then
   select * into v_thread from public.chat_threads where status='open' and thread_type='dm' and ((user_id=v_uid and participant_id=p_other_user_id) or (user_id=p_other_user_id and participant_id=v_uid)) order by created_at desc limit 1;
 end;
 return v_thread;
end; $$;

create or replace function public.create_follow_request(p_target_user_id uuid)
returns public.follows language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_target public.profiles; v_follow public.follows; v_status text; v_actor_name text; v_actor_username text;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if p_target_user_id is null or p_target_user_id=v_uid then raise exception 'INVALID_TARGET'; end if;
 select * into v_target from public.profiles where id=p_target_user_id;
 if not found then raise exception 'USER_NOT_FOUND'; end if;
 select * into v_follow from public.follows where follower_id=v_uid and following_id=p_target_user_id limit 1;
 if found then return v_follow; end if;
 v_status:=case when coalesce(v_target.is_public,true) then 'approved' else 'pending' end;
 insert into public.follows(follower_id,following_id,status) values(v_uid,p_target_user_id,v_status) returning * into v_follow;
 if v_status='pending' then
   select coalesce(full_name,'User'),username into v_actor_name,v_actor_username from public.profiles where id=v_uid;
   insert into public.notifications(user_id,type,title,body,data)
   values(p_target_user_id,'follow-request','Permintaan Mengikuti',v_actor_name||' ingin mengikuti Anda.',jsonb_build_object('follower_id',v_uid,'following_id',p_target_user_id,'link','/profile/'||coalesce(v_actor_username,'')));
 end if;
 return v_follow;
end; $$;

create or replace function public.respond_follow_request(p_follower_id uuid,p_accept boolean)
returns public.follows language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_follow public.follows; v_out public.follows; v_name text; v_username text;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 select * into v_follow from public.follows where follower_id=p_follower_id and following_id=v_uid for update;
 if not found then raise exception 'FOLLOW_REQUEST_NOT_FOUND'; end if;
 if v_follow.status<>'pending' then return v_follow; end if;
 if p_accept then
   update public.follows set status='approved' where id=v_follow.id returning * into v_out;
   select coalesce(full_name,'User'),username into v_name,v_username from public.profiles where id=v_uid;
   insert into public.notifications(user_id,type,title,body,data)
   values(p_follower_id,'follow-accepted','Permintaan Diikuti Diterima',v_name||' menerima permintaan mengikuti Anda.',jsonb_build_object('follower_id',p_follower_id,'following_id',v_uid,'link','/profile/'||coalesce(v_username,'')));
 else
   delete from public.follows where id=v_follow.id;
   v_out:=v_follow; v_out.status:='rejected';
 end if;
 return v_out;
end; $$;

create or replace function public.get_follow_status(p_follower_id uuid,p_following_id uuid)
returns text language sql security definer set search_path=public as $$
 select coalesce((select status from public.follows where follower_id=p_follower_id and following_id=p_following_id limit 1),'none');
$$;

create or replace function public.remove_follow(p_target_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 delete from public.follows where follower_id=v_uid and following_id=p_target_user_id;
end; $$;

create or replace function public.close_chat_thread(p_thread_id uuid,p_rating integer default null)
returns public.chat_threads language plpgsql security definer set search_path=public as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads; v_out public.chat_threads;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if p_rating is not null and(p_rating<1 or p_rating>5) then raise exception 'INVALID_RATING'; end if;
 select * into v_thread from public.chat_threads where id=p_thread_id for update;
 if not found then raise exception 'THREAD_NOT_FOUND'; end if;
 if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or public.is_active_admin(v_uid)) then raise exception 'ACCESS_DENIED'; end if;
 update public.chat_threads set status='closed',closed_at=coalesce(closed_at,now()),rating=coalesce(p_rating,rating) where id=p_thread_id returning * into v_out;
 return v_out;
end; $$;

create or replace function public.get_my_unread_chat_count()
returns bigint language sql security definer set search_path=public as $$
select count(*)::bigint from public.chat_messages m join public.chat_threads t on t.id=m.thread_id
where m.sender_id<>auth.uid() and(t.user_id=auth.uid() or t.participant_id=auth.uid() or public.is_active_admin(auth.uid()))
and m.created_at>coalesce((select r.last_read_at from public.chat_thread_reads r where r.thread_id=t.id and r.user_id=auth.uid()),'epoch'::timestamptz);
$$;

alter table public.follows enable row level security;
drop policy if exists "Users can manage own follows" on public.follows;
drop policy if exists "Users can view follows" on public.follows;
create policy "Users view related follows" on public.follows for select using(auth.uid()=follower_id or auth.uid()=following_id);
create policy "Users delete own follows" on public.follows for delete using(auth.uid()=follower_id or auth.uid()=following_id);
revoke insert,update on public.follows from authenticated,anon;

revoke all on function public.create_support_ticket(text,text) from public;
grant execute on function public.create_support_ticket(text,text) to authenticated;
grant execute on function public.get_or_create_dm_thread(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid,text) to authenticated;
grant execute on function public.close_chat_thread(uuid,integer) to authenticated;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
grant execute on function public.get_my_unread_chat_count() to authenticated;
grant execute on function public.create_follow_request(uuid) to authenticated;
grant execute on function public.respond_follow_request(uuid,boolean) to authenticated;
grant execute on function public.get_follow_status(uuid,uuid) to authenticated;
grant execute on function public.remove_follow(uuid) to authenticated;
