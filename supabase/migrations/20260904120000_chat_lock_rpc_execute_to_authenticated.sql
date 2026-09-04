-- Chat RPC hardening: browser clients must be authenticated to execute chat operations.
-- The functions themselves also enforce authorization; this removes unnecessary PUBLIC/anon EXECUTE access.

revoke all on function public.block_chat_user(uuid) from public, anon;
revoke all on function public.unblock_chat_user(uuid) from public, anon;
revoke all on function public.is_chat_blocked(uuid, uuid) from public, anon;
revoke all on function public.get_or_create_dm_thread(uuid) from public, anon;
revoke all on function public.load_my_threads_v2(integer) from public, anon;
revoke all on function public.get_chat_messages_page(uuid, integer, timestamptz) from public, anon;
revoke all on function public.mark_chat_thread_read(uuid) from public, anon;
revoke all on function public.claim_chat_ticket(uuid) from public, anon;
revoke all on function public.close_chat_thread(uuid, integer) from public, anon;

grant execute on function public.block_chat_user(uuid) to authenticated;
grant execute on function public.unblock_chat_user(uuid) to authenticated;
grant execute on function public.is_chat_blocked(uuid, uuid) to authenticated;
grant execute on function public.get_or_create_dm_thread(uuid) to authenticated;
grant execute on function public.load_my_threads_v2(integer) to authenticated;
grant execute on function public.get_chat_messages_page(uuid, integer, timestamptz) to authenticated;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
grant execute on function public.claim_chat_ticket(uuid) to authenticated;
grant execute on function public.close_chat_thread(uuid, integer) to authenticated;
