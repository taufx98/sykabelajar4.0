# Stage 7 — Better Auth Production Cutover Runbook

**Status: preparation in progress; Production GO-LIVE is not authorized.**

This document follows the owner-approved one-time promotion recorded in [AUTH-PRODUCTION-PROMOTION-DECISION-2026-11-14.md](AUTH-PRODUCTION-PROMOTION-DECISION-2026-11-14.md). It defines the controlled release sequence for the agreed Better Auth-only, fresh-account authentication model. It is not a production migration, deployment, DNS change, secret operation, account reset, or cutover authorization. Production steps require all GO gates below plus explicit owner approval for the cutover window.

## 1. Live environment snapshot — 14 November 2026

### Supabase projects

| Environment | Project | Plan / PostgreSQL | private.app_users | auth.users | Application FK state |
|---|---|---|---:|---:|---|
| Production DB2 | mvdczyitbkxkldjughor | Free / 17.6 | absent | legacy rows retained | 69 FKs to auth.users; 0 to private.app_users; 3 non-internal auth.users triggers |
| Auth staging | ydamszdfsxqisanazdkb | Free / 17.11 | present | 0 rows | isolated identity fixture and provisioning contract |

These figures come from read-only checks. No Production DDL/DML, account, Auth setting, RLS policy, trigger, secret, or Edge Function was changed.

The connected Supabase organization is on the Free plan. Supabase Free does not provide automatic daily backups or PITR. The schema-only CI export is not a data backup; see Section 5.

### Cloudflare authentication resources — verified 14 November 2026

- Existing Better Auth Worker script: `sykabelajar-auth-poc`. It currently serves the accepted staging setup and remains the single Worker resource to be promoted once.
- Staging D1: `sykabelajar-auth-poc` (`7a4f9008-a1c6-42b6-8a04-abde12699248`). It and its test records remain untouched.
- Existing custom hostname: `auth.sykabelajar.my.id`, currently attached to that Worker. Keep it unchanged during the approved one-time promotion.
- Production D1: `sykabelajar-auth-prod` (`6d4dc7b5-8e71-4fdc-9cda-3230e49951c7`). Migrations `0000–0007` have been applied and schema verification passed. It has zero users, sessions, accounts, verification records, access/refresh tokens and email credentials.
- `services/auth-worker/wrangler.production.toml` is prepared to bind the existing Worker resource to Production D1 and the Production DB2 target. It has not been deployed.
- No second auth Worker or staging hostname is planned. The one-time promotion changes the existing Worker's binding/configuration; it does not copy staging users, sessions, keys or credentials.

### Owner-operated staging acceptance

The owner has run the hosted Uji Penerimaan Better Auth — Staging panel and reported 5/5 passed: session/Data API/profile/role isolation; PKCE resource-token re-issuance on the same session and UUID; private Storage ownership; private Realtime topic isolation; and shared ES256 verifier checks for issuer, audience, subject, role and RLS. The temporary Storage probe file was deleted. Do not repeat this panel unless a concrete regression occurs.

## 2. One-time promotion model — keep the current hostname and Worker

The owner has approved a one-time promotion after staging acceptance. Do not create another staging hostname, move the existing staging hostname, or create another Production Worker.

1. Keep `auth.sykabelajar.my.id` unchanged. It remains the Production issuer after promotion: `https://auth.sykabelajar.my.id/api/auth`.
2. Keep the existing Cloudflare Worker resource and tested Worker code. Production promotion changes its D1 binding, environment variables and secrets in one controlled deployment; it does not rebuild or duplicate the authentication system.
3. The empty Production D1 already exists as `sykabelajar-auth-prod` (UUID `6d4dc7b5-8e71-4fdc-9cda-3230e49951c7`) with migrations `0000–0007` applied and verified. Do not recreate it or copy staging data, users, credentials, sessions, grants or keys.
4. Leave the existing staging D1 database and its test records untouched. Freeze staging acceptance after the owner-approved checks; staging login will no longer be served from this Worker after it is promoted.
5. Use Production-only Better Auth/JWT/email-encryption secrets and the Production Supabase provisioning destination. Do not reuse staging secrets or point Production to the staging Supabase project.
6. Register the unchanged Production issuer in Production DB2 Custom OIDC. No staging hostname change or new staging Custom OIDC registration is part of this cutover.
7. Update only the Production frontend auth endpoint/configuration after the Production Worker, D1, DB2 identity migration and OIDC checks pass.

This is a single cutover, not a dual-environment architecture. The current staging Worker/D1 remain the accepted test record; the Worker resource is promoted once, and the staging D1 remains preserved but disconnected from live authentication.

## 3. Production authentication configuration

- Read the exact issuer and jwks_uri from the Production Worker's live discovery document. Do not assume that the staging issuer string is automatically the Production issuer, even if the hostname will be reused.
- Register the Production Custom OIDC issuer only in Production DB2 through Supabase Dashboard → Authentication → Sign In / Providers → Third-Party Auth → Custom OIDC (or the supported Management API). Do not register it in staging only and do not apply the staging issuer to Production.
- Verify HTTPS discovery, ES256 asymmetric signatures, key ID (kid), UUID sub, PostgreSQL role claim authenticated, exact issuer, expected audience and expiry. Test wrong issuer, wrong audience, invalid signature, expired token, unknown kid and missing subject.
- For JWKS/key rotation, publish overlapping public keys, allow Supabase up to 30 minutes to observe the change, and retain the old public key until old access tokens have expired plus the propagation window. Never export the private signing key from D1.
- Keep Production email verification required. The staging-only bypass must never be copied to Production. Transactional email delivery was deferred by the owner; therefore Production public signup, verification callbacks and password recovery are NO-GO until a real sender is configured and real delivery, callback and reset tests pass. Do not forge emailVerified.
- Create the first Production admin only through the normal verified Better Auth account flow followed by the protected owner/server-only admin bootstrap. Public registration must not accept admin as an account type. Never run the staging bootstrap against Production.
- Supabase Auth cannot currently be disabled as a service. Keep its existing data and service configuration intact. This does not mean old Supabase Auth tokens should remain authorized after the Better Auth issuer guard is enabled.

Official Supabase references: [Custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc) and [Third-party Auth overview](https://supabase.com/docs/guides/auth/third-party/overview).

## 4. Fresh-account identity consequences

The agreed design starts with fresh Better Auth accounts. It does not import old Supabase Auth credentials, password hashes, identities or sessions. Existing auth.users rows and application rows remain untouched.

The Stage 3 design uses private.app_users as the new identity root and UUID-only legacy_reference tombstones to preserve existing application foreign-key references. A tombstone is not a login identity; it contains no password, email identity, session or copied business role.

After Better Auth issuer guards are enabled, Supabase Auth JWTs are rejected on guarded application surfaces. A person who registers again with the same email receives a new Better Auth UUID. That new UUID does not automatically inherit the old UUID's profile, business roles, referral history, registrations, wallet or other application rows. Existing data remains under its old UUID and is not deleted, but it is not automatically attached to the new account.

Before Production GO, the owner must explicitly acknowledge that this fresh-start behavior is intended for the Production population, not only staging tests. Do not invent email-based account merges or silently reassign business data.

## 5. Mandatory backup and restore gate

Production DB2 is on Supabase Free. Its automatic daily backup and PITR protections are unavailable. The successful schema-only CI export is **not** a full data backup.

A guarded workflow is prepared at `.github/workflows/auth-production-db2-backup.yml`. It performs a read-only full `pg_dump` of Production DB2, verifies table-data entries, restores the application database into a separate database inside an isolated Supabase local/PostgreSQL 17.6 stack, checks catalog invariants without selecting or printing application rows, encrypts the original full archive with age, and uploads only the encrypted file/checksum/manifest. The restore connects as the local Supabase bootstrap role `supabase_admin`, and first verifies that the role actually has the PostgreSQL `SUPERUSER` attribute. This is required for restoring Supabase-managed functions such as `realtime.list_changes`, whose definition sets the superuser-only `log_min_messages` parameter; the regular local `postgres` login is not used as the restore administrator. Supabase configures `pg_cron` to run only from its canonical `postgres` database; therefore the isolated application restore intentionally excludes the `pg_cron` extension and its scheduler-owned `cron` objects so Production scheduled jobs are not replayed in the disposable runner. Those objects remain present in the original encrypted full-database archive. No local `pg_cron` installation is required for this isolated application restore. It does not run Production DDL/DML.

The age recipient and database URL secrets are already configured, and the full backup/restore rehearsal has passed in Run #7. Do not regenerate the keypair or rerun the workflow just to repeat completed work.

**Owner action before Production identity DDL:**

The owner has confirmed that the backup has been copied to durable storage outside GitHub. No further copy is requested. Keep the private age identity offline and separate. Record the destination checksum verification and retain the backup through the cutover and rollback observation window; do not disclose the storage location or private key in this repository.


### Verified backup evidence — 14 November 2026

The guarded workflow [Run #7](https://github.com/taufx98/sykabelajar4.0/actions/runs/43549547338) completed successfully. The full Production dump was created read-only; its archive catalog contained table-data entries; the isolated restore used the verified local Supabase `supabase_admin` superuser; the PostgreSQL 17.6 application restore and catalog assertions passed; the original full dump was age-encrypted; and the cleanup step removed plaintext temporary files.

The uploaded artifact is `sykabelajar-production-db2-encrypted-backup` (ID `14095658580`; available until 12 February 2027 03:02 UTC). It contains the encrypted custom-format dump, checksum and manifest only. The encrypted dump is 2,364,714 bytes with SHA-256 `78e395cf81ffdd03ce8c2c317d4b95b9bb592ce4690740d46c3d9fd6f4e0330f`. Its uploaded ZIP SHA-256 is `78e52102270ca31eaa7334b45827da32b6848945573975a33787b38a9a9b664a`. The artifact was downloaded and both hashes independently verified. No private age identity was included. The original encrypted dump retains `pg_cron` and its scheduler data; only the disposable restore list excluded those objects to prevent scheduled jobs from running in the test database.

**The owner confirmed on 14 November 2026 that the backup has been copied to durable storage outside GitHub.** The backup/restore rehearsal is passed. This session cannot inspect the owner's external storage, so retain the destination checksum-verification result in the private release record. Keep the private age identity offline and separate. The GitHub artifact remains only a temporary transfer copy.

The encrypted artifact is a transfer mechanism, not the final backup vault. It contains the Production database dump, including legacy Auth rows, only for disaster recovery. It is not a user migration: no legacy account or role is imported into Better Auth. Cloudinary media remains outside this PostgreSQL database backup.

Do not create paid Supabase branches, enable paid PITR, upgrade the organization or purchase a backup add-on without explicit cost approval. References: [Supabase backups](https://supabase.com/docs/guides/platform/backups) and [Supabase pricing](https://supabase.com/pricing).

## 6. Ordered Production cutover

### A. Preflight and freeze

- Confirm Production project ref, database version, migration head and current live catalog immediately before the maintenance window.
- Run the read-only Auth Production Schema Baseline workflow. Require reviewed parity: 69 application FKs across 62 source tables, 109 auth.uid() policies, expected Auth/profile triggers and Auth-dependent function definitions. Stop on drift.
- Complete the encrypted full-data backup and successful disposable restore from Section 5.
- Verify the existing Worker resource, new empty Production D1 and Production secret names exist without printing secret values. Confirm no Production secret equals a staging-only key or provider token.
- Announce a maintenance window. Freeze new account creation and nonessential auth configuration changes during the schema/issuer transition. Do not delete/reset/mutate legacy accounts.
- Freeze the accepted staging environment. Do not move its hostname or repeat the owner acceptance panel.

### B. Prepare Production D1 and promote the existing Worker

- Verify the existing Production D1 is `sykabelajar-auth-prod` (UUID `6d4dc7b5-8e71-4fdc-9cda-3230e49951c7`), migrations `0000–0007` are applied, and the expected tables, indexes and foreign keys are present. The zero-account/session check has already passed. Do not recreate it or run staging migrations against it.
- Keep the existing Worker resource and tested `services/auth-worker/src` code. Prepare a Production-only Wrangler configuration that retains the existing custom hostname but binds `DB` to the new Production D1.
- Set Production-only secrets: `BETTER_AUTH_SECRET`, `AUTH_PROVIDER_ENCRYPTION_KEY`, `AUTH_EMAIL_ENCRYPTION_KEY`, and the Production DB2 provisioning API key. Never print values or reuse staging keys.
- Configure `BETTER_AUTH_URL=https://auth.sykabelajar.my.id`, `APP_ORIGIN=https://sykabelajar.my.id`, `SUPABASE_RESOURCE_AUDIENCE=https://sykabelajar.my.id`, and the Production DB2 project URL. Omit the staging app origin.
- Set `AUTH_SIGNUP_DISABLED=true` in the Production Worker. The runtime also fails closed when `SUPABASE_PROVISIONING_ENV=production` and this variable is missing; only the explicit value `false` opens signup. Keep signup disabled and Supabase provisioning disabled until the identity, OIDC and real-email gates are accepted. Production email verification must remain required.
- Deploy the existing Worker resource once with the Production binding/configuration during the approved maintenance window. Do not change the hostname or create a duplicate Worker.
- Verify `/healthz`, OIDC discovery, JWKS, issuer, signing algorithm, cookie attributes, strict CORS, Origin/CSRF rejection, rate limits and D1 availability before enabling application routing.

### C. Apply Stage 3 identity foundation to Production DB2

- Re-run the full schema-only baseline and live metadata checks immediately before DDL. Do not rely only on a November 13 snapshot.
- Generate the exact 69-FK plan from the live catalog with scripts/auth-migration/generate-app-users-fk-plan.mjs. Review all generated phases, FK names, columns and ON DELETE/ON UPDATE/MATCH/validation/deferrability semantics.
- Apply the identity root and trusted provisioning surface; seed only required UUID-only legacy_reference tombstones from existing application FK columns; expand replacement FKs; validate every replacement FK; then execute one reviewed atomic FK cutover.
- Retire the three legacy auth.users triggers only within the atomic Stage 3 identity-root transaction. The draft was amended so identity-root creation, trusted provisioning and legacy trigger retirement commit together. Its updated disposable contract and full schema-baseline workflow must pass before any review for Production.
- Apply the issuer restriction only after Production Custom OIDC has been registered and a real Production token has passed verification.
- Run the production-shaped disposable regression for profiles/roles/settings/referral/email/phone/organizer, all 69 FKs, relevant RLS/issuer contracts and rollback preconditions. Do not copy Production application rows to staging.
- Stop on missing/orphan UUIDs, catalog drift, mismatched FK count, lock timeout, statement timeout or any regression. Do not improvise a partial migration.

### D. Enable provisioning and bootstrap the first admin

- Install only the Production DB2 server-side provisioning credential in the Production Worker secret store. Confirm the URL/ref guard points only to mvdczyitbkxkldjughor.
- Enable provisioning only after the real Production wrapper signatures, EXECUTE grants, issuer restrictions and end-to-end D1 → private.app_users/profile/role projection are accepted. Fail closed for incomplete or mismatched projections.
- Create the first admin via normal verified Better Auth registration, then use the protected owner-only bootstrap to grant the admin business role. Public users must not self-assign it.
- Confirm Better Auth user.id, private.app_users.id, profile/role identity and JWT sub are the same UUID, while JWT role is authenticated. Do not create a shadow auth.users row.

### E. Switch the Production website

- Keep `auth.sykabelajar.my.id` unchanged; it is already mapped to the Worker resource being promoted. No DNS move, hostname reassignment or second Worker is required.
- After Sections B–D pass, deploy the Production frontend configuration with `VITE_AUTH_WORKER_URL=https://auth.sykabelajar.my.id` and the Better Auth client/token bridge. Keep the Production Supabase URL and publishable key for application data access.
- Verify no production login, logout, session restore, resource-token or auth-guard path still depends on `supabase.auth` for user authentication.
- Run Production smoke tests: verified registration, real email verification, password reset, login, logout, reload/session restore, protected routes, resource-token refresh, Data API, private Storage/Realtime, Edge verifier, invalid-token denial, role denial and identity provisioning.
- Keep the maintenance window active until all smoke checks and monitoring are green. Supabase Auth remains a platform service; the application must no longer rely on it for its login flow.

## 7. Point of no return and rollback model

**Point of no return (PONR): the first Production Better Auth identity that has no corresponding auth.users account.** In the agreed fresh-account design, this occurs when the first Better Auth-only user is projected to private.app_users, typically the first new Production admin.

Before PONR, the full Stage 3 reverse-FK rollback draft may be considered only if every precondition is proven: all 69 FKs again reference auth.users; none references private.app_users; no Better Auth-only identity exists; and exact issuer guard/trigger counts match. The rollback contract intentionally rejects a rollback if a Better Auth-only identity exists.

After PONR:

- Never reverse the 69 FKs to auth.users, drop private.app_users, restore legacy Auth triggers, delete Better Auth D1 users/sessions or silently switch the application back to a Supabase-Auth-only bundle.
- A Better Auth-only user has no Supabase Auth password hash or session. There is no automatic fallback to Supabase Auth.
- Roll back only to a previously tested Better Auth-compatible frontend/Worker release while preserving Production D1, credentials, sessions, identity root, FK relationships, Custom OIDC and issuer guards.
- If Worker/D1/JWKS is unavailable, protected operations fail closed. The application may use an already-issued short-lived JWT until expiry; it must not send protected requests as anon, switch issuer or create shadow Supabase Auth users.
- Recover from an identity/schema failure after PONR by a forward fix or a controlled restore from the verified backup with a separately approved data reconciliation plan. A full database restore loses writes after the backup timestamp unless they are separately reconciled.

The existing docs/security/AUTH-STAGE-3-ROLLBACK-DRAFT.sql is a disposable-only rehearsal artifact, not an automatic Production rollback button.

## 8. Monitoring and stop thresholds

### Cloudflare Free usage

| Resource | Free allowance | Observe / Warning / Protect / Critical |
|---|---:|---|
| Worker requests | 100,000/day | 60k / 75k / 85k / 95k |
| D1 rows read | 5,000,000/day | 3.0m / 3.75m / 4.25m / 4.75m |
| D1 rows written | 100,000/day | 60k / 75k / 85k / 95k |
| D1 storage | 5 GB total | 60% / 75% / 85% / 95% |

Usage bands are internal warning thresholds, not Cloudflare guarantees. Review account-level usage and D1 metrics; do not assume separate databases provide separate quota pools. D1 read/write quota resets at 00:00 UTC (07:00 WIB). A D1 quota error or Worker 1027 is a critical outage; do not redirect to Supabase Auth.

### Auth and application signals

| Signal | Stop / alert condition | Response |
|---|---|---|
| Worker health, discovery or JWKS | 2 consecutive failed probes or any issuer/key mismatch | Stop rollout; fail closed; inspect Worker version and config fingerprints |
| Worker 5xx | More than 2% for 5 consecutive minutes with at least 20 requests | Pause rollout; revert only to a Better Auth-compatible release |
| Valid login or session restore | Any reproducible failure using a valid Production test account | Stop rollout; preserve D1 rows and sessions; inspect auth/session path |
| Supabase rejects a known-valid token | Any repeatable 401/403 or issuer/audience/sub/role mismatch | Stop rollout; inspect JWKS, claims and Custom OIDC. Never weaken verification |
| Provisioning | Any D1 user lacks its expected private.app_users/profile/role row or a new shadow auth.users row appears | Stop signup/provisioning; fail closed and reconcile by verified UUID |
| Quota / Error 1027 | Any occurrence | Critical alert; show temporary unavailability; respect Retry-After; no issuer fallback |
| Email | Production verification/reset delivery fails or unverified user obtains an authenticated session | Keep signup closed; fix sender/callback/verification flow |
| Latency | Auth p95 exceeds 2x the 30-minute pre-cutover baseline for 10 minutes | Pause rollout and inspect D1/Worker/Supabase latency |

At 60% usage inspect trends; at 75% investigate loops and inefficient scans; at 85% apply abuse rate controls and stop nonessential repeated work; at 95% treat new auth operations as at risk and prepare degraded-mode communication. A quota failure is an immediate stop condition.

### Incident response

1. Freeze further rollout and keep public signup closed.
2. Preserve Worker version, D1, keys, users, sessions, issuer and logs. Do not rotate/delete them during diagnosis.
3. Identify whether the failure is Worker availability, D1 quota/storage, Supabase issuer/JWKS, provisioning, email delivery or frontend bundle.
4. For an application-only regression, roll back to the last Better Auth-compatible frontend/Worker release.
5. For identity/schema failure after PONR, fail closed and use a forward fix; do not run the legacy reverse-FK SQL.
6. If database restoration is required, use the verified encrypted backup and a separately approved maintenance/data-reconciliation plan.
7. Resume signup only after login, verified email, JWT, role, RLS and provisioning smoke checks pass again.

References: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 quota enforcement](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/) and [D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

## 9. Final GO / NO-GO checklist

- [x] Owner-run staging acceptance: 5/5.
- [x] Stage 3 full schema-only Production export/restore and disposable 69-FK forward/rollback rehearsal passed.
- [x] Local D1 expiry/reauthentication and browser smoke tests passed.
- [x] Stage 3 trigger retirement is atomic with identity-root creation; the corrected full disposable schema-baseline workflow passed.
- [x] Owner approved the simplified one-time promotion: preserve `auth.sykabelajar.my.id`, reuse the existing Worker resource, create a clean Production D1, and leave staging D1 untouched.
- [x] Full encrypted Production DB2 dump created; original archive catalog verified; isolated Supabase/PostgreSQL 17.6 application restore and catalog assertions passed; encrypted dump and ZIP hashes independently verified (Run #7).
- [x] Owner confirmed the encrypted DB2 backup was copied to durable storage outside GitHub.
- [ ] Record/confirm the destination checksum verification in the private release record; keep the private age identity offline.
- [x] Read-only Production catalog preflight on 14 November 2026 matched all 69/69 FK definitions exactly across 62 application tables; 109 `auth.uid()` policies, 3 expected auth.users triggers, 8 direct auth.users function references, and no private.app_users or replacement FKs. Repeat immediately before approved DDL.
- [ ] Apply Stage 3 identity-root, trusted provisioning and 69-FK migration to Production DB2 under the approved maintenance window.
- [x] Production D1 created and verified; migrations 0000–0007 applied; no user/session/account/credential records present.
- [ ] Install Production-only Worker secrets/configuration and promote the existing Worker resource without changing the hostname.
- [ ] Register Production Custom OIDC; verify discovery, JWKS, ES256, issuer, audience, subject and role.
- [ ] Configure real Production transactional email and pass verification + password-reset delivery tests before enabling public signup.
- [ ] Enable provisioning and complete first-admin bootstrap with UUID consistency across D1, `private.app_users`, profile, role and JWT `sub`.
- [ ] Deploy the Production frontend auth configuration and pass the complete login/session/API/Storage/Realtime/Edge smoke suite.
- [ ] Verify monitoring/alerts and the Better Auth-compatible rollback path; close the migration only after the observation window is green.

**Current decision: NO-GO for live cutover.** The full encrypted backup/restore passed, and the owner confirmed the backup is stored durably outside GitHub. The fresh read-only catalog preflight also matches 69/69; repeat it in the actual maintenance window. Production Custom OIDC, Production-only Worker secrets/promotion, real transactional email, first-admin bootstrap, frontend switch, smoke tests, monitoring and explicit owner cutover approval remain outstanding. Do not perform Production DB2 DDL or deploy the Worker/frontend until every GO gate passes and the owner approves the cutover window. This does not require a second Worker or hostname move.

## 10. Safety record

This runbook does not mutate Production DB2, Supabase Auth, Production D1/Worker, DNS, Pages configuration, secrets, accounts, business data, Cloudinary, payment settings or unrelated application features. Staging users and legacy/demo accounts remain untouched. PR #177 remains open, Draft and unmerged.
