-- Staging-only contract for the Better Auth third-party OIDC issuer.
-- Synthetic UUIDs only. This fixture is used by local Supabase CI and must
-- never be applied to the production application project.

create table public.auth_oidc_acceptance_rows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  marker text not null
);

comment on table public.auth_oidc_acceptance_rows is
  'Synthetic Better Auth OIDC issuer/RLS fixture. Never used by application data.';

alter table public.auth_oidc_acceptance_rows enable row level security;
alter table public.auth_oidc_acceptance_rows force row level security;

revoke all on table public.auth_oidc_acceptance_rows from public, anon, authenticated;
grant select, insert, update, delete on table public.auth_oidc_acceptance_rows to authenticated;

create policy auth_oidc_acceptance_owner_all
  on public.auth_oidc_acceptance_rows
  for all
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy auth_oidc_acceptance_issuer_guard
  on public.auth_oidc_acceptance_rows
  as restrictive
  for all
  to authenticated
  using ((select auth.jwt()->>'iss') = 'https://auth.sykabelajar.my.id/api/auth')
  with check ((select auth.jwt()->>'iss') = 'https://auth.sykabelajar.my.id/api/auth');
