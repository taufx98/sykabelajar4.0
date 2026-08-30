-- Helpdesk ticket lifecycle rules.
-- One active ticket per user is enforced by the existing partial unique index.

create or replace function public.create_support_ticket(p_subject text, p_description text)
returns public.chat_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_admin uuid;
  v_thread public.chat_threads;
  v_subject text := nullif(trim(p_subject), '');
  v_description text := nullif(trim(p_description), '');
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if v_subject is null then raise exception 'SUBJECT_REQUIRED'; end if;
  if v_description is null then raise exception 'DESCRIPTION_REQUIRED'; end if;
  if exists(select 1 from public.chat_threads where user_id=v_uid and thread_type='ticket' and status='open') then
    raise exception 'ACTIVE_TICKET_EXISTS';
  end if;
  select user_id into v_admin from public.user_roles where role='admin'::app_role and is_active=true order by created_at limit 1;
  if v_admin is null then raise exception 'ADMIN_UNAVAILABLE'; end if;

  insert into public.chat_threads(user_id,participant_id,status,thread_type,subject,description)
  values(v_uid,v_admin,'open','ticket',v_subject,v_description)
  returning * into v_thread;

  insert into public.chat_messages(thread_id,sender_id,body)
  values(v_thread.id,v_uid,format('📋 %s\n\n%s',v_subject,v_description));
  return v_thread;
exception when unique_violation then raise exception 'ACTIVE_TICKET_EXISTS';
end;
$$;

revoke all on function public.create_support_ticket(text,text) from public, anon, authenticated;
grant execute on function public.create_support_ticket(text,text) to authenticated;

create or replace function public.close_chat_thread(p_thread_id uuid, p_rating integer default null)
returns public.chat_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.chat_threads;
  v_out public.chat_threads;
  v_is_admin boolean;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_rating is not null and (p_rating<1 or p_rating>5) then raise exception 'INVALID_RATING'; end if;
  select * into v_thread from public.chat_threads where id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  v_is_admin := public.is_active_admin(v_uid);

  if v_thread.thread_type='ticket' then
    if v_thread.status='open' then
      if not v_is_admin then raise exception 'ADMIN_CLOSE_REQUIRED'; end if;
      update public.chat_threads set status='closed',closed_at=coalesce(closed_at,now()) where id=p_thread_id returning * into v_out;
      return v_out;
    end if;
    if p_rating is not null then
      if v_uid <> v_thread.user_id and not v_is_admin then raise exception 'ACCESS_DENIED'; end if;
      update public.chat_threads set rating=p_rating where id=p_thread_id returning * into v_out;
      return v_out;
    end if;
    return v_thread;
  end if;

  if not (v_thread.user_id=v_uid or v_thread.participant_id=v_uid or v_is_admin) then raise exception 'ACCESS_DENIED'; end if;
  if v_thread.status='closed' then return v_thread; end if;
  update public.chat_threads set status='closed',closed_at=now(),rating=coalesce(p_rating,rating) where id=p_thread_id returning * into v_out;
  return v_out;
end;
$$;

revoke all on function public.close_chat_thread(uuid,integer) from public, anon, authenticated;
grant execute on function public.close_chat_thread(uuid,integer) to authenticated;
