create table if not exists public.chat_user_moderation (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  blocked_at timestamptz not null default now(),
  blocked_by uuid references public.profiles(id) on delete set null,
  reason text,
  updated_at timestamptz not null default now()
);

alter table public.chat_user_moderation enable row level security;

drop policy if exists chat_user_moderation_admin_select on public.chat_user_moderation;
create policy chat_user_moderation_admin_select on public.chat_user_moderation for select to authenticated using (public.is_active_admin(auth.uid()));

drop policy if exists chat_user_moderation_admin_write on public.chat_user_moderation;
create policy chat_user_moderation_admin_write on public.chat_user_moderation for all to authenticated using (public.is_active_admin(auth.uid())) with check (public.is_active_admin(auth.uid()));

create or replace function public.get_chat_access_status()
returns jsonb
language sql
stable
security definer
set search_path to public, private
as $$
  select jsonb_build_object(
    'blocked', exists(select 1 from public.chat_user_moderation where user_id = auth.uid()),
    'reason', (select reason from public.chat_user_moderation where user_id = auth.uid())
  )
$$;

create or replace function public.admin_set_chat_user_block(p_user_id uuid, p_blocked boolean, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to public, private
as $$
begin
  if auth.uid() is null or not public.is_active_admin(auth.uid()) then raise exception 'ACCESS_DENIED'; end if;
  if p_user_id is null or p_user_id = auth.uid() then raise exception 'INVALID_TARGET'; end if;
  if p_blocked then
    insert into public.chat_user_moderation(user_id, blocked_by, reason, updated_at)
    values(p_user_id, auth.uid(), nullif(trim(p_reason), ''), now())
    on conflict (user_id) do update set blocked_at = now(), blocked_by = excluded.blocked_by, reason = excluded.reason, updated_at = now();
  else
    delete from public.chat_user_moderation where user_id = p_user_id;
  end if;
  return jsonb_build_object('user_id', p_user_id, 'blocked', p_blocked);
end;
$$;

create or replace function public.admin_get_chat_user_moderation(p_search text default null, p_limit integer default 50)
returns setof jsonb
language sql
stable
security definer
set search_path to public
as $$
  select to_jsonb(x) from (
    select m.user_id, m.blocked_at, m.blocked_by, m.reason, p.username, p.full_name, p.avatar_url
    from public.chat_user_moderation m
    join public.profiles p on p.id = m.user_id
    where public.is_active_admin(auth.uid())
      and (nullif(trim(p_search), '') is null or p.username ilike '%'||trim(p_search)||'%' or p.full_name ilike '%'||trim(p_search)||'%')
    order by m.updated_at desc
    limit least(greatest(coalesce(p_limit,50),1),100)
  ) x;
$$;

revoke all on function public.get_chat_access_status() from public, anon;
grant execute on function public.get_chat_access_status() to authenticated;
revoke all on function public.admin_set_chat_user_block(uuid,boolean,text) from public, anon;
grant execute on function public.admin_set_chat_user_block(uuid,boolean,text) to authenticated;
revoke all on function public.admin_get_chat_user_moderation(text,integer) from public, anon;
grant execute on function public.admin_get_chat_user_moderation(text,integer) to authenticated;

create index if not exists chat_user_moderation_updated_idx on public.chat_user_moderation(updated_at desc);
