alter table public.chat_threads
  add column if not exists updated_at timestamptz not null default now();

create index if not exists chat_threads_updated_at_idx
  on public.chat_threads(updated_at desc);

create or replace function public.send_chat_message(p_thread_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_uid uuid := auth.uid();
  v_thread public.chat_threads;
  v_msg public.chat_messages;
  v_other uuid;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if nullif(trim(p_body),'') is null then raise exception 'MESSAGE_REQUIRED'; end if;

  select * into v_thread from public.chat_threads where id=p_thread_id for update;
  if not found then raise exception 'THREAD_NOT_FOUND'; end if;
  if v_thread.status<>'open' then raise exception 'THREAD_CLOSED'; end if;
  if not(v_thread.user_id=v_uid or v_thread.participant_id=v_uid or public.is_active_admin(v_uid)) then raise exception 'ACCESS_DENIED'; end if;
  if v_thread.thread_type='dm' and public.is_chat_blocked(v_thread.user_id,v_thread.participant_id) then raise exception 'CHAT_BLOCKED'; end if;

  insert into public.chat_messages(thread_id,sender_id,body)
  values(p_thread_id,v_uid,trim(p_body))
  returning * into v_msg;

  update public.chat_threads
    set updated_at = v_msg.created_at
  where id = p_thread_id;

  if v_thread.thread_type='dm' then
    v_other:=case when v_thread.user_id=v_uid then v_thread.participant_id else v_thread.user_id end;
    update public.chat_thread_hidden
      set hidden_at=v_msg.created_at
    where thread_id=p_thread_id and user_id=v_other;
  end if;

  return v_msg;
end;
$function$;
