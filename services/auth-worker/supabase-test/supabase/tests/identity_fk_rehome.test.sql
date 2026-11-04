begin;

select extensions.plan(12);

-- Simulate the data-preserving root backfill that must happen before any
-- child foreign key is changed.
insert into private.app_users (id, email_verified_at, phone, phone_verified_at, created_at)
select id, email_verified_at, phone, phone_verified_at, created_at
from private.legacy_auth_users
on conflict (id) do nothing;

-- Rehome all fixture FKs from the legacy identity table to private.app_users.
-- Preserve source/target column order, MATCH behavior, ON UPDATE, ON DELETE,
-- deferrability, initial timing and validation state.
do $rehome$
declare
  fk record;
  local_columns text;
  referenced_columns text;
  match_action text;
  update_action text;
  delete_action text;
  deferrability text;
  validation_clause text;
begin
  for fk in
    select c.oid, c.conrelid, c.confrelid, c.conname, c.conkey, c.confkey,
           c.confmatchtype, c.confupdtype, c.confdeltype,
           c.condeferrable, c.condeferred, c.convalidated,
           src_ns.nspname as source_schema,
           src.relname as source_table
    from pg_constraint c
    join pg_class src on src.oid = c.conrelid
    join pg_namespace src_ns on src_ns.oid = src.relnamespace
    where c.contype = 'f'
      and c.confrelid = 'private.legacy_auth_users'::regclass
      and src_ns.nspname in ('public', 'private')
    order by src_ns.nspname, src.relname, c.conname
  loop
    select string_agg(format('%I', a.attname), ', ' order by k.ord)
      into local_columns
    from unnest(fk.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a
      on a.attrelid = fk.conrelid
     and a.attnum = k.attnum;

    select string_agg(format('%I', a.attname), ', ' order by k.ord)
      into referenced_columns
    from unnest(fk.confkey) with ordinality as k(attnum, ord)
    join pg_attribute a
      on a.attrelid = fk.confrelid
     and a.attnum = k.attnum;

    match_action := case fk.confmatchtype
      when 's' then 'SIMPLE'
      when 'f' then 'FULL'
      else null
    end;
    update_action := case fk.confupdtype
      when 'a' then 'NO ACTION'
      when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'
      when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT'
    end;
    delete_action := case fk.confdeltype
      when 'a' then 'NO ACTION'
      when 'r' then 'RESTRICT'
      when 'c' then 'CASCADE'
      when 'n' then 'SET NULL'
      when 'd' then 'SET DEFAULT'
    end;

    if local_columns is null
       or referenced_columns is null
       or match_action is null
       or update_action is null
       or delete_action is null then
      raise exception 'Unsupported or incomplete FK metadata for %.%.%',
        fk.source_schema, fk.source_table, fk.conname;
    end if;

    deferrability :=
      case when fk.condeferrable then ' DEFERRABLE' else ' NOT DEFERRABLE' end ||
      case when fk.condeferred then ' INITIALLY DEFERRED' else ' INITIALLY IMMEDIATE' end;
    validation_clause := case when fk.convalidated then '' else ' NOT VALID' end;

    execute format(
      'alter table %I.%I drop constraint %I',
      fk.source_schema, fk.source_table, fk.conname
    );

    execute format(
      'alter table %I.%I add constraint %I foreign key (%s) references private.app_users (%s) match %s on update %s on delete %s%s%s',
      fk.source_schema, fk.source_table, fk.conname,
      local_columns, referenced_columns, match_action,
      update_action, delete_action, deferrability, validation_clause
    );
  end loop;
end;
$rehome$;

select extensions.is(
  (select count(*)::integer from private.app_users),
  4,
  'all legacy user UUIDs are backfilled to the application identity root'
);

select extensions.is(
  (select count(*)::integer
   from pg_constraint
   where contype = 'f'
     and conrelid in (
       'public.auth_rehome_cascade_fixture'::regclass,
       'public.auth_rehome_set_null_fixture'::regclass,
       'public.auth_rehome_no_action_fixture'::regclass,
       'public.auth_rehome_restrict_fixture'::regclass
     )
     and confrelid = 'private.app_users'::regclass),
  4,
  'all four fixture foreign keys now reference private.app_users'
);

select extensions.is(
  (select confdeltype::text from pg_constraint where conname = 'auth_rehome_cascade_fixture_user_id_fkey'),
  'c',
  'CASCADE behavior is preserved'
);
select extensions.is(
  (select confdeltype::text from pg_constraint where conname = 'auth_rehome_set_null_fixture_user_id_fkey'),
  'n',
  'SET NULL behavior is preserved'
);
select extensions.is(
  (select confdeltype::text from pg_constraint where conname = 'auth_rehome_no_action_fixture_user_id_fkey'),
  'a',
  'NO ACTION behavior is preserved'
);
select extensions.is(
  (select confdeltype::text from pg_constraint where conname = 'auth_rehome_restrict_fixture_user_id_fkey'),
  'r',
  'RESTRICT behavior is preserved'
);

select extensions.lives_ok(
  $$delete from private.app_users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'identity with a CASCADE child can be deleted'
);
select extensions.is(
  (select count(*)::integer from public.auth_rehome_cascade_fixture where marker = 'cascade-child'),
  0,
  'CASCADE deletes the dependent row'
);

select extensions.lives_ok(
  $$delete from private.app_users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  'identity with a SET NULL child can be deleted'
);
select extensions.is(
  (select user_id is null from public.auth_rehome_set_null_fixture where marker = 'set-null-audit'),
  true,
  'SET NULL preserves the audit row while clearing its actor UUID'
);

select extensions.throws_ok(
  $$delete from private.app_users where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$,
  '23503',
  null,
  'NO ACTION blocks deletion while a dependent row exists'
);

select extensions.throws_ok(
  $$delete from private.app_users where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'$$,
  '23503',
  null,
  'RESTRICT blocks deletion while a dependent row exists'
);

select * from extensions.finish();

rollback;
