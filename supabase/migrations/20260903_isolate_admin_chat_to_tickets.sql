create or replace function public.get_my_unread_chat_count()
returns bigint
language sql
stable
security definer
set search_path to 'public', 'private'
as $$
  select count(*)::bigint
  from public.chat_threads t
  where (
    (public.is_active_admin(auth.uid()) and t.thread_type = 'ticket')
    or
    (not public.is_active_admin(auth.uid()) and (t.user_id = auth.uid() or t.participant_id = auth.uid()))
  )
  and not exists (
    select 1
    from public.chat_thread_hidden h
    where h.thread_id = t.id
      and h.user_id = auth.uid()
  )
  and exists (
    select 1
    from public.chat_messages m
    where m.thread_id = t.id
      and m.sender_id <> auth.uid()
      and m.created_at > coalesce(
        (
          select r.last_read_at
          from public.chat_thread_reads r
          where r.thread_id = t.id
            and r.user_id = auth.uid()
        ),
        'epoch'::timestamptz
      )
    limit 1
  );
$$;
