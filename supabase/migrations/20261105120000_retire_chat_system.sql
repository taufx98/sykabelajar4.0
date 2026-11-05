-- Retire all end-user chat access without deleting historical conversations or participant data.
-- Chat UI, RPC execution, table exposure and chat-specific Realtime delivery are disabled.
-- Keep the chat tables and records temporarily for retention, audit and possible later export.
-- Do not remove private.apply_referral_qualification or its generic trigger function: they
-- continue to support comments, follows, check-ins and daily-task referral qualification.

begin;

do $retire_chat$
declare
  r record;
begin
  -- Remove direct Data API privileges from every public/private relation dedicated to chat.
  -- service_role is intentionally untouched for controlled maintenance or archival.
  for r in
    select n.nspname, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relname ilike '%chat%'
      and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format(
      'revoke all privileges on table %I.%I from public, anon, authenticated',
      r.nspname, r.relname
    );
    if r.relkind in ('r', 'p') then
      execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
    end if;
  end loop;

  -- Disable every explicitly named chat RPC, plus legacy support/DM RPC names
  -- whose return types or definitions depend on chat tables.
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prokind = 'f'
      and (
        p.proname ilike '%chat%'
        or (n.nspname = 'public' and p.proname in (
          'create_ticket_thread',
          'get_or_create_dm_thread',
          'load_my_threads'
        ))
        or (n.nspname = 'private' and p.proname in (
          'collective_realtime_bind',
          'collective_realtime_can_read'
        ))
      )
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      r.signature
    );
  end loop;

  -- Remove chat-only tables from the Realtime publication without touching
  -- notifications, follows, comments, posts, competition or exam subscriptions.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for r in
      select schemaname, tablename
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and tablename ilike '%chat%'
    loop
      execute format(
        'alter publication supabase_realtime drop table %I.%I',
        r.schemaname, r.tablename
      );
    end loop;
  end if;
end
$retire_chat$;

-- Referral capture remains active for the other supported activities.
drop trigger if exists trg_referral_activity_chat on public.chat_messages;

commit;
