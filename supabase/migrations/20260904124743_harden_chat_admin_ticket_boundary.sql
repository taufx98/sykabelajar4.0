-- Admin access to messages is limited to support tickets; private DMs remain participant-only.
create or replace function public.get_chat_messages_page(p_thread_id uuid, p_limit integer default 50, p_before timestamptz default null)
returns setof public.chat_messages
language plpgsql
security definer
set search_path = public, private
as $$
declare v_uid uuid:=auth.uid(); v_hidden_at timestamptz; v_limit integer:=least(greatest(coalesce(p_limit,50),1),100);
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if not exists(select 1 from public.chat_threads t where t.id=p_thread_id and (t.user_id=v_uid or t.participant_id=v_uid or (public.is_active_admin(v_uid) and t.thread_type='ticket'))) then raise exception 'ACCESS_DENIED'; end if;
 select h.hidden_at into v_hidden_at from public.chat_thread_hidden h where h.thread_id=p_thread_id and h.user_id=v_uid;
 return query select m.* from public.chat_messages m where m.thread_id=p_thread_id and (v_hidden_at is null or m.created_at>v_hidden_at) and (p_before is null or m.created_at<p_before) order by m.created_at desc limit v_limit;
end;
$$;

create or replace function public.send_chat_message(p_thread_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path = public, private
as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads; v_other uuid; v_spam public.chat_spam_controls; v_now timestamptz:=now(); v_count integer; v_next integer; v_minutes integer; v_until timestamptz; v_msg public.chat_messages;
begin
 if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
 if nullif(trim(p_body),'') is null then raise exception 'MESSAGE_REQUIRED'; end if;
 select * into v_thread from public.chat_threads where id=p_thread_id for update;
 if not found then raise exception 'THREAD_NOT_FOUND'; end if;
 if v_thread.status<>'open' then raise exception 'THREAD_CLOSED'; end if;
 if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or (public.is_active_admin(v_uid) and v_thread.thread_type='ticket')) then raise exception 'ACCESS_DENIED'; end if;
 if v_thread.thread_type='dm' and public.is_chat_blocked(v_thread.user_id,v_thread.participant_id) then raise exception 'CHAT_BLOCKED'; end if;
 if not public.is_active_admin(v_uid) then
  select * into v_spam from public.chat_spam_controls where user_id=v_uid for update;
  if found and v_spam.window_started_at<=v_now-interval '7 days' then update public.chat_spam_controls set window_started_at=v_now,strike_count=0,blocked_until=null,updated_at=v_now where user_id=v_uid returning * into v_spam;
  elsif not found then insert into public.chat_spam_controls(user_id) values(v_uid) returning * into v_spam; end if;
  if v_spam.blocked_until is not null and v_spam.blocked_until>v_now then raise exception 'SPAM_COOLDOWN:%:%',v_spam.strike_count,to_char(v_spam.blocked_until,'YYYY-MM-DD"T"HH24:MI:SSOF'); end if;
  select count(*) into v_count from public.chat_messages where sender_id=v_uid and created_at>=v_now-interval '10 seconds';
  if v_count>=4 then v_next:=least(4,v_spam.strike_count+1); v_minutes:=case v_next when 1 then 1 when 2 then 10 when 3 then 60 else 1440 end; v_until:=v_now+make_interval(mins=>v_minutes); update public.chat_spam_controls set strike_count=v_next,blocked_until=v_until,updated_at=v_now where user_id=v_uid; raise exception 'SPAM_COOLDOWN:%:%',v_next,to_char(v_until,'YYYY-MM-DD"T"HH24:MI:SSOF'); end if;
 end if;
 insert into public.chat_messages(thread_id,sender_id,body) values(p_thread_id,v_uid,trim(p_body)) returning * into v_msg;
 update public.chat_threads set updated_at=v_msg.created_at where id=p_thread_id;
 if v_thread.thread_type='dm' then v_other:=case when v_thread.user_id=v_uid then v_thread.participant_id else v_thread.user_id end; update public.chat_thread_hidden set hidden_at=v_msg.created_at where thread_id=p_thread_id and user_id=v_other; end if;
 return v_msg;
end;
$$;
revoke all on function public.get_chat_messages_page(uuid,integer,timestamptz) from public, anon;
grant execute on function public.get_chat_messages_page(uuid,integer,timestamptz) to authenticated;
revoke all on function public.send_chat_message(uuid,text) from public, anon;
grant execute on function public.send_chat_message(uuid,text) to authenticated;
