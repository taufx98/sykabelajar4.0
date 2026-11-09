-- Expose only the caller's own application role row to Better Auth resource JWTs.
-- The Worker uses this caller-scoped read for admin authorization; no service-role
-- key is needed for provider settings. Writes remain server-only.
-- This migration is part of the isolated Supabase test/staging fixture only.

alter table public.user_roles enable row level security;

revoke all on table public.user_roles from public, anon, authenticated;
grant select on table public.user_roles to authenticated;
grant usage on type public.app_role to authenticated;

drop policy if exists user_roles_better_auth_select_own on public.user_roles;
create policy user_roles_better_auth_select_own
  on public.user_roles
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and (select auth.jwt() ->> 'iss') = 'https://auth.sykabelajar.my.id/api/auth'
  );
