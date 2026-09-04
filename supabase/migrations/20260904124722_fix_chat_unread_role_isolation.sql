-- Unread counts must follow the same role boundary as thread loading.
create or replace function public.get_my_unread_chat_count()
returns bigint
language sql
security definer
set search_path = public, private
as $$
select count(*)::bigint
from public.chat_messages m
join public.chat_threads t on t.id=m.thread_id
where m.sender_id<>auth.uid()
  and (t.user_id=auth.uid() or t.participant_id=auth.uid() or (public.is_active_admin(auth.uid()) and t.thread_type='ticket'))
  and m.created_at>coalesce((select r.last_read_at from public.chat_thread_reads r where r.thread_id=t.id and r.user_id=auth.uid()),'epoch'::timestamptz)
  and t.status='open';
$$;
revoke all on function public.get_my_unread_chat_count() from public, anon;
grant execute on function public.get_my_unread_chat_count() to authenticated;
