create or replace function public.bind_collective_chat_realtime(p_access_token text)
returns jsonb
language sql
security definer
set search_path=public,private,extensions
as $$ select private.collective_realtime_bind(p_access_token); $$;

revoke all on function public.bind_collective_chat_realtime(text) from public;
grant execute on function public.bind_collective_chat_realtime(text) to authenticated;
