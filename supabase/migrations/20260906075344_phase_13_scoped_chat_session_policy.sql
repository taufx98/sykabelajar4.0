create policy collective_chat_realtime_sessions_self_select on private.collective_chat_realtime_sessions
  for select to authenticated
  using ((select auth.uid()) = auth_user_id);
