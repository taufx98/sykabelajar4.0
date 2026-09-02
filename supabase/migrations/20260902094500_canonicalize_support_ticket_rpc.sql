begin;

create or replace function public.create_ticket_thread(p_subject text, p_description text)
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

  select * into v_thread
  from public.chat_threads
  where user_id = v_uid
    and thread_type = 'ticket'
    and status = 'open'
  order by created_at desc
  limit 1;
  if found then raise exception 'ACTIVE_TICKET_EXISTS'; end if;

  select ur.user_id into v_admin
  from public.user_roles ur
  where ur.role = 'admin'::app_role
    and ur.is_active = true
  order by ur.created_at
  limit 1;
  if v_admin is null then raise exception 'ADMIN_UNAVAILABLE'; end if;

  insert into public.chat_threads(user_id, participant_id, status, thread_type, subject, description)
  values(v_uid, v_admin, 'open', 'ticket', v_subject, v_description)
  returning * into v_thread;

  insert into public.chat_messages(thread_id, sender_id, body)
  values(v_thread.id, v_uid, format('📋 %s%n%n%s', v_subject, v_description));

  return v_thread;
exception
  when unique_violation then raise exception 'ACTIVE_TICKET_EXISTS';
end;
$$;

drop function if exists public.create_support_ticket(text,text);

commit;
