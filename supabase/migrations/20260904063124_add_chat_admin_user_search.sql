create or replace function public.admin_search_chat_users(p_search text default null, p_limit integer default 20)
returns setof jsonb
language sql
stable
security definer
set search_path to public
as $$
  select to_jsonb(x) from (
    select p.id, p.username, p.full_name, p.avatar_url,
      exists(select 1 from public.chat_user_moderation m where m.user_id=p.id) as chat_blocked
    from public.profiles p
    where public.is_active_admin(auth.uid())
      and p.id <> auth.uid()
      and (nullif(trim(p_search), '') is null or p.username ilike '%'||trim(p_search)||'%' or p.full_name ilike '%'||trim(p_search)||'%')
    order by p.full_name nulls last, p.username nulls last
    limit least(greatest(coalesce(p_limit,20),1),50)
  ) x;
$$;
revoke all on function public.admin_search_chat_users(text,integer) from public, anon;
grant execute on function public.admin_search_chat_users(text,integer) to authenticated;
