-- Profile social + chat authorization rules used by the 4.0 frontend.
-- Public profile counts never expose follower rows; they are returned through a SECURITY DEFINER RPC.

create or replace function public.get_public_profile_social(p_profile_id uuid)
returns table(follower_count bigint, following_count bigint, follow_status text)
language sql
stable
security definer
set search_path = public
as $$
select
  (select count(*)::bigint from public.follows f where f.following_id=p_profile_id and f.status in ('approved','auto')),
  (select count(*)::bigint from public.follows f where f.follower_id=p_profile_id and f.status in ('approved','auto')),
  case
    when auth.uid() is null or auth.uid()=p_profile_id then 'none'
    else coalesce((select f.status from public.follows f where f.follower_id=auth.uid() and f.following_id=p_profile_id limit 1),'none')
  end;
$$;

revoke all on function public.get_public_profile_social(uuid) from public, anon, authenticated;
grant execute on function public.get_public_profile_social(uuid) to authenticated;

create or replace function public.get_or_create_dm_thread(p_other_user_id uuid)
returns public.chat_threads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_thread public.chat_threads;
  v_target public.profiles;
  v_follow_ok boolean;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_other_user_id is null or p_other_user_id=v_uid then raise exception 'INVALID_RECIPIENT'; end if;
  select * into v_target from public.profiles where id=p_other_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  -- DM requires an approved follow relationship in either direction.
  select exists(
    select 1 from public.follows f
    where ((f.follower_id=v_uid and f.following_id=p_other_user_id)
        or (f.follower_id=p_other_user_id and f.following_id=v_uid))
      and f.status in ('approved','auto')
  ) into v_follow_ok;
  if not v_follow_ok then raise exception 'FOLLOW_REQUIRED'; end if;

  select * into v_thread
  from public.chat_threads
  where status='open' and thread_type='dm'
    and ((user_id=v_uid and participant_id=p_other_user_id)
      or (user_id=p_other_user_id and participant_id=v_uid))
  order by created_at desc limit 1;
  if found then return v_thread; end if;

  begin
    insert into public.chat_threads(user_id,participant_id,status,thread_type)
    values(v_uid,p_other_user_id,'open','dm') returning * into v_thread;
  exception when unique_violation then
    select * into v_thread
    from public.chat_threads
    where status='open' and thread_type='dm'
      and ((user_id=v_uid and participant_id=p_other_user_id)
        or (user_id=p_other_user_id and participant_id=v_uid))
    order by created_at desc limit 1;
  end;
  return v_thread;
end;
$$;

revoke all on function public.get_or_create_dm_thread(uuid) from public, anon, authenticated;
grant execute on function public.get_or_create_dm_thread(uuid) to authenticated;
