create or replace function public.send_chat_message(p_thread_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path to public, private
as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads; v_msg public.chat_messages; v_other uuid; v_gate jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if exists(select 1 from public.chat_user_moderation where user_id=v_uid) then raise exception 'CHAT_ADMIN_BLOCKED'; end if;
  if nullif(trim(p_body),'') is null then raise exception 'MESSAGE_REQUIRED'; end if;
  select * into v_thread from public.chat_threads where id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  if v_thread.status<>'open' then raise exception 'THREAD_CLOSED'; end if;
  if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or public.is_active_admin(v_uid)) then raise exception 'ACCESS_DENIED'; end if;
  if v_thread.thread_type='dm' and public.is_chat_blocked(v_thread.user_id,v_thread.participant_id) then raise exception 'CHAT_BLOCKED'; end if;
  v_gate := public.chat_spam_gate();
  if coalesce((v_gate->>'blocked')::boolean,false) then return null; end if;
  insert into public.chat_messages(thread_id,sender_id,body) values(p_thread_id,v_uid,trim(p_body)) returning * into v_msg;
  update public.chat_threads set updated_at=v_msg.created_at where id=p_thread_id;
  if v_thread.thread_type='dm' then
    v_other:=case when v_thread.user_id=v_uid then v_thread.participant_id else v_thread.user_id end;
    if exists(select 1 from public.chat_user_moderation where user_id=v_other) then raise exception 'CHAT_ADMIN_BLOCKED'; end if;
    update public.chat_thread_hidden set hidden_at=v_msg.created_at where thread_id=p_thread_id and user_id=v_other;
  end if;
  return v_msg;
end;
$$;

create or replace function public.create_ticket_thread(p_subject text, p_description text)
returns public.chat_threads
language plpgsql
security definer
set search_path to public, private
as $$
declare v_uid uuid:=auth.uid(); v_admin uuid; v_thread public.chat_threads; v_subject text:=nullif(trim(p_subject),''); v_description text:=nullif(trim(p_description),''); v_gate jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if exists(select 1 from public.chat_user_moderation where user_id=v_uid) then raise exception 'CHAT_ADMIN_BLOCKED'; end if;
  if v_subject is null then raise exception 'SUBJECT_REQUIRED'; end if;
  if v_description is null then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if exists(select 1 from public.chat_threads where user_id=v_uid and thread_type='ticket' and status='open') then raise exception 'ACTIVE_TICKET_EXISTS'; end if;
  select ur.user_id into v_admin from public.user_roles ur where ur.role='admin'::app_role and ur.is_active=true order by ur.created_at limit 1;
  if v_admin is null then raise exception 'ADMIN_UNAVAILABLE'; end if;
  v_gate := public.chat_spam_gate();
  if coalesce((v_gate->>'blocked')::boolean,false) then return null; end if;
  insert into public.chat_threads(user_id,participant_id,status,thread_type,subject,description) values(v_uid,v_admin,'open','ticket',v_subject,v_description) returning * into v_thread;
  insert into public.chat_messages(thread_id,sender_id,body) values(v_thread.id,v_uid,v_subject||E'\n\n'||v_description);
  return v_thread;
end;
$$;

revoke all on function public.send_chat_message(uuid,text) from public, anon;
grant execute on function public.send_chat_message(uuid,text) to authenticated;
revoke all on function public.create_ticket_thread(text,text) from public, anon;
grant execute on function public.create_ticket_thread(text,text) to authenticated;
