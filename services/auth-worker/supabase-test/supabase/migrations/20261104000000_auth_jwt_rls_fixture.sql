-- Isolated, synthetic fixture for Better Auth JWT claim and RLS semantics.
-- This database is disposable and does not load application or production records.

create extension if not exists pgtap with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table private.auth_identity_rls_fixture (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  marker text not null
);

alter table private.auth_identity_rls_fixture enable row level security;

revoke all on table private.auth_identity_rls_fixture from public, anon, authenticated;
grant select, insert, update on table private.auth_identity_rls_fixture to authenticated;

create policy auth_identity_fixture_owner_all
  on private.auth_identity_rls_fixture
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
