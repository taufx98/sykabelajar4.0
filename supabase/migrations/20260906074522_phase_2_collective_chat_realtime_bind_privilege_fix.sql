revoke execute on function public.bind_collective_chat_realtime(text) from anon;
revoke execute on function public.bind_collective_chat_realtime(text) from public;
grant execute on function public.bind_collective_chat_realtime(text) to authenticated;
