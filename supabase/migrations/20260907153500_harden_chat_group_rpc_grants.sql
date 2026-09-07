-- Group RPCs are invoked by authenticated accounts or the existing anonymous-auth
-- bridge used by collective portal sessions. Do not leave SECURITY DEFINER RPCs
-- executable by PUBLIC/anon.

do $$
declare r record;
begin
  for r in
    select p.oid,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as signature
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'create_chat_group',
        'list_my_chat_groups',
        'get_chat_group_members',
        'get_chat_group_messages',
        'send_chat_group_message',
        'add_chat_group_member',
        'remove_chat_group_member',
        'rename_chat_group',
        'mark_chat_group_read',
        'create_chat_group_invite',
        'join_chat_group',
        'list_collective_chat_groups',
        'get_collective_chat_group_messages',
        'send_collective_chat_group_message',
        'list_collective_chat_group_members',
        'mark_collective_chat_group_read',
        'join_collective_chat_group'
      )
  loop
    execute format('revoke execute on function %s from public', r.signature);
    execute format('revoke execute on function %s from anon', r.signature);
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;
end $$;
