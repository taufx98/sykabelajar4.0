# Stage 7 — Better Auth Production Cutover Runbook

**Status: preparation in progress; Production GO-LIVE is not authorized.**

This document follows the owner-approved one-time promotion recorded in [AUTH-PRODUCTION-PROMOTION-DECISION-2026-11-14.md](AUTH-PRODUCTION-PROMOTION-DECISION-2026-11-14.md). It defines the controlled release sequence for the agreed Better Auth-only, fresh-account authentication model. It is not a production migration, deployment, DNS change, secret operation, account reset, or cutover authorization. Production steps require all GO gates below plus explicit owner approval for the cutover window.

## 1. Live environment snapshot — reviewed 18 November 2026

### Supabase projects

| Environment | Project | Plan / PostgreSQL | Identity status |
|---|---|---|---|
| Production DB2 | mvdczyitbkxkldjughor | Free / 17.6 | Existing Auth/application rows retained; Stage 3 identity root and FK cutover not applied |
| Auth staging | ydamszdfsxqisanazdkb | Free / 17.11 | Isolated identity fixture; accepted staging users and roles remain intact |

The successful schema-only baseline is not a data backup. The encrypted full backup/restore passed on 14 November; owner confirmed the encrypted archive was copied outside GitHub. Keep the destination checksum verification in the private owner release record.

### Cloudflare authentication resources

- **Staging remains the protected accepted environment:** Worker `sykabelajar-auth-poc`, D1 `sykabelajar-auth-poc` (UUID `7a4f9008-a1c6-42b6-8a04-abde12699248`) and hostname `auth.sykabelajar.my.id` stay paired. Do not promote or rebind this Worker.
- **Production D1:** `sykabelajar-auth-prod` (UUID `6d4dc7b5-8e71-4fdc-9cda-3230e49951c7`). Guarded schema workflow [#44341594485](https://github.com/taufx98/sykabelajar4.0/actions/runs/44341594485) completed successfully on 18 November. It confirmed migrations 0000–0010, 23 expected tables, email verification required, one default failover settings row, and zero Better Auth users/accounts/sessions/verifications/OAuth tokens/email-provider accounts. It did not deploy a Worker, set secrets, change DNS, enable provisioning, or switch the frontend.
- The one-time D1 migration authorization marker was committed on 18 November (`c073938e7f0564d9bb2422dec6d8ffc250a03045`); guarded run [#44341594485](https://github.com/taufx98/sykabelajar4.0/actions/runs/44341594485) completed successfully and confirmed `No migrations to apply` on the final verification pass. Production D1 is at exactly 0000–0010 with the expected empty identity/provider state. The migration did not deploy a Worker, change DNS, set secrets, alter Supabase DB2, or switch the app.
- **Dedicated Production Worker target:** `sykabelajar-auth-prod`, hostname `auth-prod.sykabelajar.my.id`, issuer `https://auth-prod.sykabelajar.my.id/api/auth`. Its Wrangler config and owner-guarded creation workflow are prepared on branch `security/auth-production-isolation`; they have not been merged or run. This target is separate from staging.
- The previous same-Worker promotion plan is retired. The old `auth-cloudflare-production-worker-promote.yml` job is disabled in the preparation branch because it would replace the staging Worker/D1 binding.

### Release availability

The website is still in progress and has not been publicly released. No scheduled public maintenance window is needed for this preparation/cutover. That does not mean a live route switch is risk-free: keep signup closed until the new Production issuer, sender, identity projection and app checks are accepted. Do not promise zero interruption after public release.

### Owner-operated staging acceptance

The owner reported 5/5 passed: session/Data API/profile/role isolation; PKCE resource-token re-issuance on the same session and UUID; private Storage ownership; private Realtime topic isolation; and shared ES256 verifier checks. The owner also confirmed the staging SendPulse test email reached the inbox after PR #192. These are staging-only proofs; do not rerun unless a concrete regression appears.

## 2. Production isolation plan — preserve the accepted staging environment

The previous plan to promote `sykabelajar-auth-poc` in place is **retired**. Both environments previously pointed at the same Worker resource and hostname; deploying the Production config there would disconnect the working staging D1 and change the issuer serving the accepted staging environment. Never run the old promotion job or rebind the staging Worker.

1. Keep staging unchanged: `sykabelajar-auth-poc` + D1 `sykabelajar-auth-poc` + `auth.sykabelajar.my.id`.
2. Read the live Production D1 ledger after the owner-authorized migration action. Require exactly migrations 0000–0010, 23 expected tables, email verification policy `email_verification_required=1`, one failover-enabled routing row, and zero user/account/session/verification/OAuth token/provider-account rows.
3. Create a **new** Worker `sykabelajar-auth-prod` with only Production D1, Production DB2 URL, closed public signup and disabled provisioning. Bind it to the new custom hostname `auth-prod.sykabelajar.my.id`; do not attach or reassign `auth.sykabelajar.my.id`.
4. Generate fresh Production-only Better Auth, provider-encryption and email-encryption secrets for the new Worker. Never copy staging secrets or delete staging Worker secret bindings.
5. Verify Production health, discovery, issuer, public ES256 JWKS, PKCE S256, exact CORS, closed signup, zero identities and D1 binding. Re-read staging Worker/D1/hostname metadata and require no change.
6. Register only `https://auth-prod.sykabelajar.my.id/api/auth` as the Production DB2 Custom OIDC issuer after the new Production Worker passes hosted checks. Keep the staging Supabase OIDC provider pinned to the staging issuer.
7. Apply Stage 3 Production DB2 identity/FK/issuer work only after OIDC and the real Production token checks pass. Enable provisioning only after wrapper/grant/issuer checks; then complete the one-time verified first-admin bootstrap.
8. Configure a Production-only sender and prove real numeric OTP verification and password-reset email delivery. Keep public signup closed until these proofs pass.
9. Update only the Production frontend auth endpoint to `https://auth-prod.sykabelajar.my.id` after all backend gates pass; verify login/session/token/RLS/Storage/Realtime/Edge smoke coverage and rollback readiness.

The isolated Production Worker creation workflow is `.github/workflows/auth-cloudflare-production-worker-create.yml`. It requires the exact owner marker `.github/auth-ops/CREATE-PRODUCTION-AUTH-WORKER-0001` or its manual confirmation phrase. The marker is intentionally absent; do not create it until D1 ledger verification and the first-admin/email bootstrap design are complete. The workflow's preflight checks that staging still uses the original Worker/D1/hostname and that the Production Worker/hostname do not already exist before creation.

## 3. Production authentication configuration

- The Production issuer is `https://auth-prod.sykabelajar.my.id/api/auth`; the staging issuer remains `https://auth.sykabelajar.my.id/api/auth`. Read the exact issuer and jwks_uri from the live dedicated Production Worker's discovery document before registering anything.
- Register the Production Custom OIDC issuer only in Production DB2 through Supabase Dashboard → Authentication → Sign In / Providers → Third-Party Auth → Custom OIDC (or the guarded Management API workflow). Never register the staging issuer in Production or the Production issuer in staging.
- Verify HTTPS discovery, ES256 asymmetric signatures, key ID (kid), UUID sub, PostgreSQL role claim authenticated, exact issuer, expected audience and expiry. Test wrong issuer, wrong audience, invalid signature, expired token, unknown kid and missing subject.
- For JWKS/key rotation, publish overlapping public keys, allow Supabase up to 30 minutes to observe the change, and retain the old public key until old access tokens have expired plus the propagation window. Never export the private signing key from D1.
- Keep Production email verification required. The sender system supports SendPulse, Brevo, Mailjet, Mailtrap Email Sending, Resend and compatible custom HTTPS JSON APIs. Production sender credentials are not configured; real verification and password-reset delivery must pass before enabling public signup. Never paste provider credentials into chat or source control. Do not forge `emailVerified`.
- Resolve the first-admin/email bootstrap loop before GO. The first Production email provider must be provisioned through a reviewed owner-only path without relying on an existing Admin UI session; only then may the owner create and verify the first Better Auth identity and grant the admin business role through the protected owner procedure. Public signup remains closed before and after.
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

- Confirm Production project ref, database version, migration head and current live catalog immediately before any Production DB2 DDL; no scheduled public maintenance window is needed while the site is unreleased.
- Run the read-only Auth Production Schema Baseline workflow. Require reviewed parity: 69 application FKs across 62 source tables, 109 auth.uid() policies, expected Auth/profile triggers and Auth-dependent function definitions. Stop on drift.
- Complete the encrypted full-data backup and successful disposable restore from Section 5.
- Verify staging remains attached to its original Worker/D1/hostname. Separately verify the dedicated Production Worker name/hostname is unused and the exact Production D1 exists. Never read or print secret values.
- Because the site is unreleased, no public maintenance announcement is needed. Keep Production frontend routing disabled and signup closed during preparation. Do not delete/reset/mutate legacy accounts.
- Freeze the accepted staging environment. Do not move its hostname or repeat the owner acceptance panel.

### B. Prepare Production D1 and create the isolated Production Worker

- Verify the existing Production D1 is `sykabelajar-auth-prod` (UUID `6d4dc7b5-8e71-4fdc-9cda-3230e49951c7`), re-read its live migration ledger and schema after commit `c073938e7f0564d9bb2422dec6d8ffc250a03045`. The last verified pre-marker state was migrations `0000–0007`; the push-triggered migration result was not surfaced in this session. Require exactly `0000–0010` and verify the empty identity/provider inventory; do not assume success. Do not recreate it or run staging migrations against it.
- If the live ledger shows migrations `0008–0010` are still pending, use only the exact guarded D1 workflow after reviewing the run status. It pins immutable migration hashes and checks the 23-table schema, required verification default, failover row, empty identity/provider inventory and Production callback. If already applied, do not re-run any SQL manually.
- Reuse the tested `services/auth-worker/src` code but create a new Worker resource named `sykabelajar-auth-prod`; do not deploy `wrangler.production.toml` to `sykabelajar-auth-poc`.
- The isolated Production Worker receives fresh `BETTER_AUTH_SECRET`, `AUTH_PROVIDER_ENCRYPTION_KEY`, and `AUTH_EMAIL_ENCRYPTION_KEY`. Never copy or delete staging Worker secrets. Keep `SUPABASE_PROVISIONING_ENABLED=false`; do **not** install the Production DB2 provisioning credential before the identity migration and grant review. Never print values or reuse staging keys.
- Install the Production DB2 provisioning API key separately in Section D, only after the Production identity foundation, exact RPC signatures, EXECUTE grants, and issuer restrictions have been applied and reviewed. Keep provisioning disabled until those checks pass.
- Configure `BETTER_AUTH_URL=https://auth-prod.sykabelajar.my.id`, `APP_ORIGIN=https://sykabelajar.my.id`, `SUPABASE_RESOURCE_AUDIENCE=https://sykabelajar.my.id`, and the Production DB2 project URL. Omit the staging issuer/app origin.
- Set `AUTH_SIGNUP_DISABLED=true` in the Production Worker. The runtime also fails closed when `SUPABASE_PROVISIONING_ENV=production` and this variable is missing; only the explicit value `false` opens signup. Keep signup disabled and Supabase provisioning disabled until the identity, OIDC and real-email gates are accepted. Production email verification must remain required.
- Create the separate Production Worker only through `.github/workflows/auth-cloudflare-production-worker-create.yml`, with marker `.github/auth-ops/CREATE-PRODUCTION-AUTH-WORKER-0001` or exact manual confirmation `CREATE-PRODUCTION-AUTH-WORKER-sykabelajar-auth-prod`. The marker is absent. Its preflight proves the existing staging Worker and D1 binding remain unchanged, the Production Worker/hostname do not already exist, and Production D1 is at the reviewed migration/schema state and empty. It deploys a new Worker on `auth-prod.sykabelajar.my.id` with fresh Production-only keys; it does not delete or modify staging secrets, bindings, D1 or hostname. The old same-Worker workflow is disabled.
- Verify `/healthz`, OIDC discovery, JWKS, issuer, signing algorithm, cookie attributes, strict CORS, Origin/CSRF rejection, rate limits and D1 availability before enabling application routing.
- After confirming the isolated Production Worker is bound to Production D1, run the guarded Production OIDC registrar using the exact one-time marker/manual confirmation described above. It verifies live discovery, PKCE S256, public ES256 JWKS, exact DB2 project and duplicate state before registering exactly one Production Custom OIDC integration. Do not run this workflow while the issuer still serves staging D1.

### C. Apply Stage 3 identity foundation to Production DB2

- Re-run the full schema-only baseline and live metadata checks immediately before DDL. Do not rely only on a November 13 snapshot.
- Generate the exact 69-FK plan from the live catalog with scripts/auth-migration/generate-app-users-fk-plan.mjs. Review all generated phases, FK names, columns and ON DELETE/ON UPDATE/MATCH/validation/deferrability semantics.
- Apply the identity root and trusted provisioning surface; seed only required UUID-only legacy_reference tombstones from existing application FK columns; expand replacement FKs; validate every replacement FK; then execute one reviewed atomic FK cutover.
- Retire the three legacy auth.users triggers only within the atomic Stage 3 identity-root transaction. The draft was amended so identity-root creation, trusted provisioning and legacy trigger retirement commit together. Its updated disposable contract and full schema-baseline workflow must pass before any review for Production.
- Apply the issuer restriction only after Production Custom OIDC has been registered and a real Production token has passed verification.
- Run the production-shaped disposable regression for profiles/roles/settings/referral/email/phone/organizer, all 69 FKs, relevant RLS/issuer contracts and rollback preconditions. Do not copy Production application rows to staging.
- Stop on missing/orphan UUIDs, catalog drift, mismatched FK count, lock timeout, statement timeout or any regression. Do not improvise a partial migration.

### D. Enable provisioning and bootstrap the first admin

### D1. First Production Admin bootstrap — additional hard gate

- The existing `AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql` and `AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP-UNVERIFIED.sql` files are explicitly staging-only. **Never execute or adapt them in place on Production.** They reference the staging project and the unverified exception must never be used in Production.
- The Production Worker configuration intentionally sets `AUTH_SIGNUP_DISABLED=true`. The current code has no separately reviewed, one-time Production owner bootstrap endpoint or email allowlist. Therefore the first Production Better Auth identity cannot safely be created merely by toggling public signup off/on or by assuming the staging SQL will work.
- Before cutover GO, implement and test a Production-only, owner-authorized, one-time first-account path that creates only the explicitly selected owner identity, requires a genuine email-verified Better Auth session, verifies the same UUID from the Production D1 session, uses the pinned Production provisioning destination, refuses any shadow `auth.users` identity, and can assign the `admin` business role only through the protected owner procedure. The guard must atomically prevent reuse and must not expose general public signup. Keep public signup closed before and after this operation.
- Add local disposable tests for unauthorized invocation, wrong email/UUID, unverified identity, duplicate/replay, existing Admin membership, wrong project/environment, and successful single-UUID projection. Review the SQL/API and rollback behavior before any Production use. Do not enable Production provisioning or grant an Admin until this gate passes.

- Install only the Production DB2 server-side provisioning credential in the Production Worker secret store. Confirm the URL/ref guard points only to mvdczyitbkxkldjughor.
- Enable provisioning only after the real Production wrapper signatures, EXECUTE grants, issuer restrictions and end-to-end D1 → private.app_users/profile/role projection are accepted. Fail closed for incomplete or mismatched projections.
- Create the first admin via normal verified Better Auth registration, then use the protected owner-only bootstrap to grant the admin business role. Public users must not self-assign it.
- Confirm Better Auth user.id, private.app_users.id, profile/role identity and JWT sub are the same UUID, while JWT role is authenticated. Do not create a shadow auth.users row.

### E. Switch the Production website

- Keep staging `auth.sykabelajar.my.id` attached to its staging Worker. Production uses the separate hostname `auth-prod.sykabelajar.my.id` attached to `sykabelajar-auth-prod`.
- After Sections B–D pass, deploy the Production frontend configuration with `VITE_AUTH_WORKER_URL=https://auth-prod.sykabelajar.my.id` and the Better Auth client/token bridge. Keep the Production Supabase URL and publishable key for application data access.
- Verify no production login, logout, session restore, resource-token or auth-guard path still depends on `supabase.auth` for user authentication.
- Run Production smoke tests: verified registration, real email verification, password reset, login, logout, reload/session restore, protected routes, resource-token refresh, Data API, private Storage/Realtime, Edge verifier, invalid-token denial, role denial and identity provisioning.
- Keep Production signup closed and the rollout paused until all smoke checks and monitoring are green. No scheduled maintenance window is needed while the site is unreleased. Supabase Auth remains a platform service; the application must no longer rely on it for its login flow.

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
- [x] Owner approved Production cutover and fresh-account semantics. The safe architecture preserves staging on `auth.sykabelajar.my.id` and creates a separate Production Worker/hostname.
- [x] Full encrypted Production DB2 dump created; original archive catalog verified; isolated Supabase/PostgreSQL 17.6 application restore and catalog assertions passed; encrypted dump and ZIP hashes independently verified (Run #7).
- [x] Owner confirmed the encrypted DB2 backup was copied to durable storage outside GitHub.
- [ ] Record/confirm the destination checksum verification in the private release record; keep the private age identity offline.
- [x] Latest full read-only Production schema baseline [#44130643793](https://github.com/taufx98/sykabelajar4.0/actions/runs/44130643793) completed 17 November 2026: schema-only Production export and isolated PostgreSQL 17.6 restore matched all 69/69 FKs across 62 application tables, 10 Auth-dependent functions, 7 Auth/profile triggers, 109 `auth.uid()` policies across 61 tables and 36 profile columns. All 69-FK forward/rollback, Stage 3 identity/provisioning, issuer/RLS, and Stage 5 disposable Edge checks passed. No Production DDL/DML was executed. Repeat immediately before approved DDL.
- [ ] Apply Stage 3 identity-root, trusted provisioning and 69-FK migration to Production DB2 after the technical GO gates pass; no scheduled maintenance window is needed while the website remains unreleased.
- [x] Production D1 created and verified; migrations 0000–0007 applied; no user/session/account/credential records present.
- [ ] Apply Production D1 migrations `0008_auth_runtime_settings.sql`, `0009_multi_provider_email_routing.sql`, and `0010_custom_http_email_provider.sql` through the guarded one-time D1 workflow. Verify the single default policy row remains `email_verification_required=1`, the 23-table target schema is exact, failover defaults are enabled, and provider/identity/credential/session rows remain empty. Marker `.github/auth-ops/APPLY-PRODUCTION-D1-0002` was committed in `c073938e7f0564d9bb2422dec6d8ffc250a03045`; its push-triggered Actions result is not visible from this session. Re-read the live ledger before further Production action.
- [ ] Create the dedicated Production Worker with `.github/workflows/auth-cloudflare-production-worker-create.yml` after its gates pass; verify Production D1 binding and `auth-prod.sykabelajar.my.id`, and re-read staging Worker/D1/hostname unchanged. Marker absent; not executed. The old shared-Worker promotion job is disabled.
- [ ] After Worker promotion, run the guarded Production Custom OIDC registration workflow; verify discovery, JWKS, ES256, issuer, audience, subject and role. Marker absent; not executed.
- [ ] Staging SendPulse test mail was confirmed delivered to the Admin inbox after PR #192. This validates the staging outbound API path only. Production email provider accounts remain empty and Production sender credentials are not configured. After promotion, configure a Production-only provider credential through the Production Admin UI and pass real verification-callback and password-reset delivery tests before enabling public signup.
- [ ] Enable provisioning and complete first-admin bootstrap with UUID consistency across D1, `private.app_users`, profile, role and JWT `sub`.
- [ ] Deploy the Production frontend auth configuration and pass the complete login/session/API/Storage/Realtime/Edge smoke suite.
- [ ] Verify monitoring/alerts and the Better Auth-compatible rollback path; close the migration only after the observation window is green.

**Current decision: NO-GO for live cutover.** The encrypted full backup/restore passed and the owner confirmed the encrypted copy is stored outside GitHub; retain the destination checksum verification in the private release record. The 17 November full Production schema baseline passed with exact 69/69 FK and metadata parity. The 18 November Cloudflare read-only preflight [#44145409028](https://github.com/taufx98/sykabelajar4.0/actions/runs/44145409028) verified that the existing Worker and `auth.sykabelajar.my.id` remain paired, the Worker is still bound to the accepted staging D1, and Production D1 remains exactly migrations 0000–0007 with 20 expected tables, canonical callback, profile columns and zero identity/credential/session/legacy-email rows. Only Cloudflare GET requests and D1 SELECT queries ran. The live status of Production migrations 0008–0010 must first be established from the ledger. Production Worker creation/secrets, Custom OIDC, DB2 identity/FK DDL, provisioning, real Production email, first-admin bootstrap, frontend switch and smoke/monitoring remain outstanding. Owner cutover approval was given; technical gates are still NO-GO. Do not deploy or mutate Production until every GO gate passes and the already-granted owner approval is still applicable to the exact operation. No scheduled maintenance window is required while the website remains unreleased. A separate Production Worker and hostname are required to preserve staging.

## 10. Safety record

This runbook's latest checks are read-only: no Production DB2, Supabase Auth, Production D1/Worker, DNS, Pages configuration, secrets, accounts, business data, Cloudinary, payment settings or unrelated application features were mutated. Staging users and legacy/demo accounts remain untouched. PR #177 merged on 16 November 2026; SendPulse fix PR #192 merged on 17 November 2026. The new preflight and documentation commits are on the auth migration branch; no Production cutover or final frontend merge has occurred.
