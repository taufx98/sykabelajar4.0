-- Persist chat anti-spam strikes/cooldowns without rolling back the state when a message is denied.
-- The original implementation updated chat_spam_controls and then raised an exception in the same transaction;
-- PostgreSQL rolled the update back. This migration returns a nullable composite instead and lets the client
-- surface the persisted cooldown.

create or replace function public.chat_spam_gate()
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_uid uuid := auth.uid();
  v_spam public.chat_spam_controls;
  v_now timestamptz := now();
  v_count integer := 0;
  v_next integer;
  v_minutes integer;
  v_until timestamptz;
begin
  if v_uid is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if public.is_active_admin(v_uid) then
    return jsonb_build_object('blocked',false,'strike_count',0,'blocked_until',null);
  end if;

  select * into v_spam
  from public.chat_spam_controls
  where user_id=v_uid
  for update;

  if found and v_spam.window_started_at <= v_now-interval '7 days' then
    update public.chat_spam_controls
    set window_started_at=v_now,strike_count=0,blocked_until=null,updated_at=v_now
    where user_id=v_uid
    returning * into v_spam;
  elsif not found then
    insert into public.chat_spam_controls(user_id,window_started_at,strike_count,blocked_until,updated_at)
    values(v_uid,v_now,0,null,v_now)
    returning * into v_spam;
  end if;

  if v_spam.blocked_until is not null and v_spam.blocked_until > v_now then
    return jsonb_build_object(
      'blocked',true,
      'strike_count',v_spam.strike_count,
      'blocked_until',v_spam.blocked_until,
      'reset_at',v_spam.window_started_at+interval '7 days'
    );
  end if;

  select count(*) into v_count
  from public.chat_messages
  where sender_id=v_uid
    and created_at >= v_now-interval '10 seconds';

  if v_count >= 4 then
    v_next := least(4,v_spam.strike_count+1);
    v_minutes := case v_next
      when 1 then 1
      when 2 then 10
      when 3 then 60
      else 1440
    end;
    v_until := v_now+make_interval(mins=>v_minutes);

    update public.chat_spam_controls
    set strike_count=v_next,blocked_until=v_until,updated_at=v_now
    where user_id=v_uid;

    return jsonb_build_object(
      'blocked',true,
      'strike_count',v_next,
      'blocked_until',v_until,
      'reset_at',v_spam.window_started_at+interval '7 days'
    );
  end if;

  return jsonb_build_object(
    'blocked',false,
    'strike_count',v_spam.strike_count,
    'blocked_until',null,
    'reset_at',v_spam.window_started_at+interval '7 days'
  );
end;
$$;

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
  return jsonb_build_object('warning_level',v.strike_count,'strike_count',v.strike_count,'blocked_until',case when v.blocked_until is not null and v.blocked_until>now() then v.blocked_until else null end,'reset_at',v.window_started_at+interval '7 days');
end;
$$;

create or replace function public.send_chat_message(p_thread_id uuid,p_body text)
returns public.chat_messages language plpgsql security definer set search_path='public','private'
as $$
declare v_uid uuid:=auth.uid(); v_thread public.chat_threads; v_msg public.chat_messages; v_other uuid; v_gate jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if nullif(trim(p_body),'') is null then raise exception 'MESSAGE_REQUIRED'; end if;
  select * into v_thread from public.chat_threads where id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  if v_thread.status<>'open' then raise exception 'THREAD_CLOSED'; end if;
  if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or public.is_active_admin(v_uid)) then raise exception 'ACCESS_DENIED'; end if;
  if v_thread.thread_type='dm' and public.is_chat_blocked(v_thread.user_id,v_thread.participant_id) then raise exception 'CHAT_BLOCKED'; end if;

  v_gate := public.chat_spam_gate();
  if coalesce((v_gate->>'blocked')::boolean,false) then
    return null;
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

create or replace function public.create_ticket_thread(p_subject text,p_description text)
returns public.chat_threads language plpgsql security definer set search_path='public','private'
as $$
declare v_uid uuid:=auth.uid(); v_admin uuid; v_thread public.chat_threads; v_subject text:=nullif(trim(p_subject),''); v_description text:=nullif(trim(p_description),''); v_gate jsonb;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if v_subject is null then raise exception 'SUBJECT_REQUIRED'; end if;
  if v_description is null then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if exists(select 1 from public.chat_threads where user_id=v_uid and thread_type='ticket' and status='open') then raise exception 'ACTIVE_TICKET_EXISTS'; end if;
  select ur.user_id into v_admin from public.user_roles ur where ur.role='admin'::app_role and ur.is_active=true order by ur.created_at limit 1;
  if v_admin is null then raise exception 'ADMIN_UNAVAILABLE'; end if;

  v_gate := public.chat_spam_gate();
  if coalesce((v_gate->>'blocked')::boolean,false) then
    return null;
  end if;

  insert into public.chat_threads(user_id,participant_id,status,thread_type,subject,description) values(v_uid,v_admin,'open','ticket',v_subject,v_description) returning * into v_thread;
  insert into public.chat_messages(thread_id,sender_id,body) values(v_thread.id,v_uid,v_subject||E'\n\n'||v_description);
  return v_thread;
end;
$$;

revoke all on function public.chat_spam_gate() from public,anon;
grant execute on function public.chat_spam_gate() to authenticated;
revoke all on function public.get_chat_spam_status() from public,anon;
grant execute on function public.get_chat_spam_status() to authenticated;
revoke all on function public.send_chat_message(uuid,text) from public,anon;
grant execute on function public.send_chat_message(uuid,text) to authenticated;
revoke all on function public.create_ticket_thread(text,text) from public,anon;
grant execute on function public.create_ticket_thread(text,text) to authenticated;
