# Better Auth Production Promotion Decision — 14 November 2026

## Email provider decision update — 15 November 2026

The prior ZeptoMail/Brevo-only choice is superseded. The branch now prepares SendPulse, Brevo, Mailjet, Mailtrap Email Sending, and Resend behind one encrypted D1-managed dispatcher. Admin can set priority, enable/disable accounts, edit internal hour/day/month limits, and enable quota/credential failover. Initial limits mirror published free-tier guardrails but are only SYKABELAJAR-local counters; the Worker cannot know how much quota other applications have consumed on the same provider account.

The staging schema is additive migration `0010_multi_provider_email_routing.sql`; Production uses identical schema as `0009_multi_provider_email_routing.sql`. Both create account/settings tables only, seed no API keys, and default automatic failover to enabled. Neither remote migration has been applied; the new Worker code has not been deployed. Existing legacy ZeptoMail/Brevo migrations and D1 records remain untouched but are not read by the new dispatcher. Production signup, provisioning, Worker promotion, OIDC registration, DB2 identity DDL, DNS and frontend routing remain NO-GO.

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
4. Production public registration now has an explicit `AUTH_SIGNUP_DISABLED=true` guard across email/password and configured social providers. Production fails closed if the variable is absent and requires an explicit `false` to open signup; staging keeps the explicit `false` setting. Worker unit contracts and the guarded Production D1 config check enforce the split. This is a signup safety gate, not an account reset or migration.
5. A manual-only Production Custom OIDC workflow is prepared at `.github/workflows/auth-supabase-production-oidc.yml`. It is pinned to `mvdczyitbkxkldjughor` / `sykabelajar_db2`, requires an exact confirmation phrase, and checks the live issuer, PKCE S256, public ES256 JWKS and duplicate state. It has not been run; execute it only after the existing Worker is promoted to Production D1 so the Production project does not trust the staging D1 identity population.
6. Better Auth Admin role lookup now accepts only the exact Supabase project selected by `SUPABASE_PROVISIONING_ENV`: staging maps only to `ydamszdfsxqisanazdkb`, Production maps only to `mvdczyitbkxkldjughor`. Both the email-settings and runtime-verification Admin endpoints pass the environment selector. Unknown environments and a mismatched URL fail before any UserInfo/role network call. Local tests cover both environments and all mismatch cases; no Production request was made.
7. Production D1 migration `0008_auth_runtime_settings.sql` is prepared. It creates only the Admin email-verification policy table and seeds exactly one row with `email_verification_required=1`; it does not create users, sessions, credentials or application identities. The guarded workflow now requires the exact one-time marker `.github/auth-ops/APPLY-PRODUCTION-D1-0002` or the matching manual confirmation. The marker is absent and the workflow has not run.
8. The one-time existing-Worker promotion workflow is prepared at `.github/workflows/auth-cloudflare-production-worker-promote.yml`. It verifies the live Worker is still bound to the exact staging D1, the existing hostname is attached to the same Worker, and Production D1 has the reviewed schema/default policy and zero identities before it changes bindings/secrets. It replaces staging-only Worker secret bindings with fresh Production secrets, keeps public signup and Supabase provisioning disabled, and runs post-deploy issuer/JWKS/CORS/closed-signup/empty-D1 checks. Its marker `.github/auth-ops/PROMOTE-PRODUCTION-WORKER-0001` is absent; it has not run.


These changes prepare the existing implementation for the agreed promotion. They do not deploy or configure Production.

## Latest read-only Production baseline

Project `mvdczyitbkxkldjughor` is healthy on PostgreSQL 17.6. The current live catalog contains 69 application FKs across 62 source tables referencing `auth.users`, zero application FKs to `private.app_users`, and three non-internal `auth.users` triggers. `private.app_users` is not yet present. This confirms the Stage 3 Production identity migration has not been applied.

## Production D1 created and schema installed — 14 November 2026

- Cloudflare D1 `sykabelajar-auth-prod` is created with UUID `6d4dc7b5-8e71-4fdc-9cda-3230e49951c7` (APAC hint, read replication off).
- Production-specific migrations `0000–0007` applied successfully in [workflow #43486836760](https://github.com/taufx98/sykabelajar4.0/actions/runs/43486836760). Staging-only callback migration `0008_add_staging_oauth_callback.sql` was excluded. The distinct Production migration `0008_auth_runtime_settings.sql` is now prepared but **not applied**; when authorized, its only seeded policy requires email verification (`1`).
- Schema, expected identity tables and profile-mapping columns were verified. User/session/account/verification/token/email-credential counts are zero. Staging D1 is untouched.
- `wrangler.production.toml` is prepared but not deployed. The existing Worker, hostname, Production DB2 and website routing remain unchanged.

## Remaining release gates

- Full encrypted Production DB2 backup and PostgreSQL 17.6 disposable restore passed in Run #7. Owner confirmed on 14 November that the encrypted backup is stored outside GitHub; retain destination checksum evidence privately. The temporary GitHub artifact is not the permanent vault.
- Fresh read-only Production catalog recheck on 14 November matched the committed 69-FK snapshot exactly (69/69); rerun immediately before any approved DB2 DDL.
- Manually authorize and apply Production D1 migration `0008_auth_runtime_settings.sql` through the exact one-time marker `.github/auth-ops/APPLY-PRODUCTION-D1-0002` (currently absent) or its exact manual confirmation. Verify the default remains `email_verification_required=1`.
- Promote the existing Worker only through `.github/workflows/auth-cloudflare-production-worker-promote.yml` with its exact one-time marker `.github/auth-ops/PROMOTE-PRODUCTION-WORKER-0001` (currently absent) or exact manual confirmation. This is the actual Production secret/binding mutation and requires explicit owner approval for the maintenance window.
- Only after the Worker serves Production D1, run the pinned Production Custom OIDC registrar with `.github/auth-ops/REGISTER-PRODUCTION-OIDC-0001` (currently absent) or its exact manual confirmation. Verify discovery/JWKS/ES256/issuer/audience/subject/role.
- Apply Stage 3 identity/provisioning foundation and 69-FK cutover to Production DB2 only during the approved maintenance window, after a fresh live catalog check and verified Production OIDC token.
- Keep signup locked and provisioning disabled until DB2 identity-root, issuer restrictions, trusted wrapper grants and a Production sender are ready. Configure real ZeptoMail delivery and prove verification/password reset before opening registration for protected first-admin bootstrap.
- Enable provisioning only after the Production DB2 identity foundation is live; bootstrap the first admin through the protected owner flow; then switch the main website frontend.
- Pass Production login/session/API/Storage/Realtime/Edge smoke tests, verify monitoring and Better Auth-compatible rollback, and keep the observation window green before closing migration.
- Obtain explicit owner approval before any Production D1 migration, Worker secret/binding promotion, Custom OIDC registration, DB2 DDL, or frontend cutover.

## Scope and safety

- New users receive new Better Auth UUIDs. No old Supabase Auth password, session, UUID, account or role is imported or switched; old rows remain untouched.
- No Production DB2 DDL/DML, Production D1 migration 0008, Worker deployment/secret mutation, Custom OIDC registration, DNS change, frontend routing change, account mutation or PR merge has been performed. The 0008 migration, OIDC and Worker promotion workflows are prepared but all three one-time markers are absent.
- PR #177 remains Draft and unmerged.
