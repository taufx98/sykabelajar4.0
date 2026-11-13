# Better Auth Production Promotion Decision — 14 November 2026

## Owner-approved target

The accepted staging verification is frozen. SYKABELAJAR will use a one-time promotion rather than maintain two active Better Auth environments:

- Keep `https://auth.sykabelajar.my.id/api/auth` unchanged as the final issuer.
- Reuse the existing Cloudflare Worker resource and the already-tested Worker implementation.
- Create one new, empty Production D1 database, then change the existing Worker binding/configuration/secrets to Production during the approved maintenance window.
- Keep the staging D1 database and its test data unchanged and disconnected from live authentication after promotion.
- Do not create `auth-staging.sykabelajar.my.id`, do not create a duplicate Worker, and do not repeat already-accepted staging tests.
- Keep Supabase DB2 as the application database/RLS authority. Better Auth supplies the fresh identity UUID and ES256 token.

## Code corrections prepared

1. The Supabase provisioning module previously allowed only the isolated staging Supabase host. It now supports exactly two pinned destinations:
   - staging `https://ydamszdfsxqisanazdkb.supabase.co` (default when the environment selector is absent);
   - Production `https://mvdczyitbkxkldjughor.supabase.co` only when `SUPABASE_PROVISIONING_ENV=production` is explicitly set.
   Any unknown environment or cross-target URL fails closed. Staging tests continue to use the staging target.
2. First-party OAuth callback URLs are now derived from the configured app origins. A Production Worker with no `DEV_APP_ORIGIN` accepts only `https://sykabelajar.my.id/auth/oidc/callback`; staging retains both its staging callback and the canonical Production callback for the accepted PKCE setup.
3. Unit coverage was added for exact Production/staging provisioning target selection and environment-specific callback allowlists.

These changes prepare the existing implementation for the agreed promotion. They do not deploy or configure Production.

## Latest read-only Production baseline

Project `mvdczyitbkxkldjughor` is healthy on PostgreSQL 17.6. The current live catalog contains 69 application FKs across 62 source tables referencing `auth.users`, zero application FKs to `private.app_users`, and three non-internal `auth.users` triggers. `private.app_users` is not yet present. This confirms the Stage 3 Production identity migration has not been applied.

## Remaining release gates

- Full encrypted Production DB2 backup plus a successful restore rehearsal in a disposable PostgreSQL 17-compatible environment.
- Immediate preflight of the Production catalog and review of the exact 69-FK generated plan.
- Apply the Stage 3 identity/provisioning foundation and FK cutover to Production DB2 in the maintenance window.
- Create and migrate the empty Production D1; set Production-only Worker secrets/configuration.
- Register the unchanged issuer in Production DB2 Custom OIDC and verify discovery/JWKS/ES256/issuer/audience/subject/role.
- Configure real transactional email and prove verification and password reset before opening public signup.
- Promote the existing Worker resource, enable Production provisioning, bootstrap the first admin through the protected owner flow, then switch the main website frontend.
- Pass Production login/session/API/Storage/Realtime/Edge smoke tests, verify monitoring and Better Auth-compatible rollback, then close the migration.

## Scope and safety

- New users receive new Better Auth UUIDs. No old Supabase Auth password, session, UUID, account or role is imported or switched; old rows remain untouched.
- No Production DB2 DDL/DML, Worker deployment, D1 creation, secret change, DNS change, frontend routing change or PR merge has been performed as part of this checkpoint.
- PR #177 remains Draft and unmerged.
