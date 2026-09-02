create or replace function public.get_public_competitions()
returns table(
  id uuid, organizer_id uuid, slug text, title text, short_description text, description text,
  category text, status competition_status, registration_starts_at timestamptz,
  registration_ends_at timestamptz, starts_at timestamptz, ends_at timestamptz,
  announcement_at timestamptz, poster_url text, juknis_url text, visibility text,
  participant_count bigint
)
language sql
security definer
set search_path = public
as $$
  select * from public.get_public_competitions_v2(6);
$$;

create or replace function public.load_my_threads_v2(p_limit integer default 50)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
with base as (
  select t.*,
    p1.full_name user_name,p1.username,p1.avatar_url,
    p2.full_name other_user_name,p2.username other_username,p2.avatar_url other_avatar_url,
    lm.body last_message,lm.created_at last_message_at
  from public.chat_threads t
  left join public.profiles p1 on p1.id=t.user_id
  left join public.profiles p2 on p2.id=t.participant_id
  left join lateral (
    select m.body,m.created_at from public.chat_messages m
    where m.thread_id=t.id
      and m.created_at >= coalesce((select h.hidden_at from public.chat_thread_hidden h where h.thread_id=t.id and h.user_id=auth.uid()),'epoch'::timestamptz)
    order by m.created_at desc limit 1
  ) lm on true
  where (t.user_id=auth.uid() or t.participant_id=auth.uid() or public.is_active_admin(auth.uid()))
    and (not exists(select 1 from public.chat_thread_hidden h where h.thread_id=t.id and h.user_id=auth.uid())
      or exists(select 1 from public.chat_messages m join public.chat_thread_hidden h on h.thread_id=m.thread_id and h.user_id=auth.uid() where m.thread_id=t.id and m.created_at>h.hidden_at))
  order by coalesce(lm.created_at,t.created_at) desc
  limit least(greatest(coalesce(p_limit,50),1),50)
)
select to_jsonb(base)||jsonb_build_object(
  'unread_count',
  case when base.thread_type='ticket' and base.status='closed' then 0 else least(1,(
    select count(*) from public.chat_messages m
    where m.thread_id=base.id and m.sender_id<>auth.uid()
      and m.created_at>coalesce((select r.last_read_at from public.chat_thread_reads r where r.thread_id=base.id and r.user_id=auth.uid()),'epoch'::timestamptz)
  )) end
)
from base;
$$;

create or replace function public.load_my_threads()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select * from public.load_my_threads_v2(50);
$$;

revoke execute on function public.get_public_competitions() from anon, authenticated;
grant execute on function public.get_public_competitions() to anon, authenticated;
revoke execute on function public.load_my_threads() from anon;
grant execute on function public.load_my_threads() to authenticated;
revoke execute on function public.load_my_threads_v2(integer) from public, anon;
grant execute on function public.load_my_threads_v2(integer) to authenticated;
