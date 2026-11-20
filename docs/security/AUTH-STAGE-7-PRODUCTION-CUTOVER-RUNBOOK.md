# Current provider and Stage 7 instruction — 20 November 2026

**SendPulse remains the tested primary transactional-email provider. Do not configure or use any additional provider unless the owner explicitly requests it.** The approved managed provider list is SendPulse, Brevo, Mailjet, Mailtrap Email Sending, Resend and Custom HTTP.

PR #197 is merged to staging at commit 53f6fdb4177043884055bae013a34f14ba9fe293. Staging D1 migration 0014 and staging Worker redeploy remain accepted; migration 0013 remains immutable. Production OIDC is registered exactly once in DB2 by [#44349164162](https://github.com/taufx98/sykabelajar4.0/actions/runs/44349164162), attempt 2. The disposable 69-FK/identity-root/issuer/rollback and Stage 5 Edge rehearsal passed in [#44571272221](https://github.com/taufx98/sykabelajar4.0/actions/runs/44571272221), and the expanded 50-step baseline including the first-admin grant contract passed in [#44682199208](https://github.com/taufx98/sykabelajar4.0/actions/runs/44682199208). The closed Production SendPulse and first-account bootstrap code passed Worker CI [#44683114356](https://github.com/taufx98/sykabelajar4.0/actions/runs/44683114356): lint/typecheck/build, 267 Worker unit tests, SendPulse bootstrap 9/9 and first-account bootstrap 7/7. All of those tests are local/disposable only. No Production Worker deployment, secret, email, account or DB2 DDL/DML was performed. Production remains at D1 0000–0010 and is isolated from the app.

---

# Stage 7 — Better Auth Production Cutover Runbook

**Status: preparation in progress; Production GO-LIVE remains NO-GO.** Production OIDC registration, disposable Stage 3/rollback rehearsal, and the code/tests for the closed SendPulse and first-owner bootstrap routes are complete. Neither route is deployed. No Production DB2 DDL/DML, email sender setup, owner account, provisioning enablement, Production Worker deployment or frontend switch has been performed in this continuation.

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
- **Dedicated Production Worker:** `sykabelajar-auth-prod` is deployed on `auth-prod.sykabelajar.my.id`, version `2ead8e3f-f244-4851-91d3-52d4c0b1bf24`, bound to Production D1. Guarded create run [#44347403101](https://github.com/taufx98/sykabelajar4.0/actions/runs/44347403101) deployed the isolated Worker and generated three fresh Production-only secrets (`BETTER_AUTH_SECRET`, `AUTH_PROVIDER_ENCRYPTION_KEY`, `AUTH_EMAIL_ENCRYPTION_KEY`). Follow-up DNS retry and public runtime check [#44348084987](https://github.com/taufx98/sykabelajar4.0/actions/runs/44348084987) passed: DNS, `/healthz`, OIDC discovery issuer, PKCE S256, public ES256 JWKS, exact CORS, required-email-verification policy, provider list empty, staging Worker/D1/domain unchanged, and Production D1 still empty. Production Custom OIDC is now registered exactly once in DB2 by [#44349164162](https://github.com/taufx98/sykabelajar4.0/actions/runs/44349164162), attempt 2. This remains a live but closed Production auth endpoint; it is not connected to the Production frontend and has no Better Auth account or sender provider yet.
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

The isolated Production Worker creation workflow is `.github/workflows/auth-cloudflare-production-worker-create.yml`. Its one-time owner marker `.github/auth-ops/CREATE-PRODUCTION-AUTH-WORKER-0001` has been consumed; do not recreate or rerun it, as it would redeploy and rotate the Production secrets. The read-only verification workflow `.github/workflows/auth-cloudflare-production-worker-smoke.yml` and its marker `.github/auth-ops/VERIFY-PRODUCTION-WORKER-SMOKE-0001` confirmed the deployed state in [#44348084987](https://github.com/taufx98/sykabelajar4.0/actions/runs/44348084987). The follow-up inventory preflight [#44347784875](https://github.com/taufx98/sykabelajar4.0/actions/runs/44347784875) separately confirmed Cloudflare custom-domain pairing and Worker/D1 binding for both staging and Production.

## 3. Production authentication configuration

- The Production issuer is `https://auth-prod.sykabelajar.my.id/api/auth`; the staging issuer remains `https://auth.sykabelajar.my.id/api/auth`. Read the exact issuer and jwks_uri from the live dedicated Production Worker's discovery document before registering anything.
- Register the Production Custom OIDC issuer only in Production DB2 through Supabase Dashboard → Authentication → Sign In / Providers → Third-Party Auth → Custom OIDC (or the guarded Management API workflow). Never register the staging issuer in Production or the Production issuer in staging.
- **Production OIDC registration passed (19 November 2026):** guarded run [#44349164162](https://github.com/taufx98/sykabelajar4.0/actions/runs/44349164162), attempt 2, registered and read-back verified exactly one Custom OIDC integration in DB2 `mvdczyitbkxkldjughor` for issuer `https://auth-prod.sykabelajar.my.id/api/auth`. Integration ID: `def142a5-e811-446a-9e7d-db21c093ed2a`. The hosted issuer discovery, PKCE S256, and public ES256/P-256 JWKS guards passed; the workflow confirmed `staging_project_touched=false` and `application_data_touched=false`. This proves the DB2 integration exists; it does **not** yet prove a real Production user token can be exchanged/accepted. Complete that test only after the identity/provisioning and first-admin gates provide a genuine verified Production session.
- Verify HTTPS discovery, ES256 asymmetric signatures, key ID (kid), UUID sub, PostgreSQL role claim authenticated, exact issuer, expected audience and expiry. Test wrong issuer, wrong audience, invalid signature, expired token, unknown kid and missing subject.
- For JWKS/key rotation, publish overlapping public keys, allow Supabase up to 30 minutes to observe the change, and retain the old public key until old access tokens have expired plus the propagation window. Never export the private signing key from D1.
- Keep Production email verification required. SendPulse remains the tested primary transactional-email provider. PR [#197](https://github.com/taufx98/sykabelajar4.0/pull/197) removed the retired provider from active Worker runtime, Admin API/panel, and experimental provider workflows. Do not configure or use an additional provider unless the owner explicitly requests it. The guarded staging-only migration 0014 exists solely to restore the approved provider constraint after immutable migration 0013; never apply it to Production. No Production provider account or sender credential is configured. A closed, owner-only SendPulse bootstrap handler and its unit tests are now present in the preparation branch; Auth Worker CI [#44681256590](https://github.com/taufx98/sykabelajar4.0/actions/runs/44681256590) passed typecheck, tests and dry-run. The route is not deployed, `AUTH_EMAIL_BOOTSTRAP_TOKEN` has not been set, no Production SendPulse API key has been entered, and no email has been sent. After a separately approved code deployment, the owner-only route will verify the SendPulse API key using a read-only statistics request and store it encrypted; it does not send an email or open signup/provisioning. Never paste provider credentials into chat or source control. Do not forge emailVerified.
- The first-admin/email bootstrap loop is now split into two separately guarded steps. The SendPulse sender-only bootstrap handler is implemented and tested in Worker CI, but it has not been deployed or run. The verified Production Admin grant SQL draft `docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql` is covered by the passing local contract [#44681672972](https://github.com/taufx98/sykabelajar4.0/actions/runs/44681672972); it only grants `admin` to an already existing `private.app_users` row with `identity_origin='better_auth'` and non-null `email_verified_at`, after the 69-FK/61-issuer-guard cutover. It does not create the Better Auth account. A separate one-time owner-only first-account creation path is still required because Production public signup remains closed; do not temporarily open unrestricted public signup to create the owner account.
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

### B. Production D1, isolated Worker and OIDC — existing resources

- Production D1 sykabelajar-auth-prod (UUID 6d4dc7b5-8e71-4fdc-9cda-3230e49951c7) is already at migrations 0000–0010; guarded run #44341594485 verified the 23-table schema, mandatory email-verification row, failover defaults, canonical callback, and zero Better Auth identities/sessions/tokens/provider accounts. Do not recreate the D1 or apply staging migrations against it.
- The dedicated Production Worker sykabelajar-auth-prod was already created and deployed to auth-prod.sykabelajar.my.id. Creation run #44347403101 and hosted verification #44348084987 passed; the Worker is bound to Production D1. Do not rerun the create workflow or marker because it generates/rotates the initial Production secrets.
- Staging remains isolated on Worker sykabelajar-auth-poc, D1 sykabelajar-auth-poc and auth.sykabelajar.my.id. Never promote the staging Worker or change its route/binding/hostname.
- The current Worker source update adds the two owner-only bootstrap endpoints, but that source update is not deployed. It is guarded by .github/workflows/auth-cloudflare-production-worker-deploy.yml. The workflow requires exact Production D1 migrations 0000–0010, exact Production and staging Worker/D1/hostname bindings, and before/after D1 identity/provider fingerprints.
- The suffix 0011 in DEPLOY-PRODUCTION-AUTH-WORKER-0011 is an operations marker, not a D1 migration. After separate owner approval, run the Worker update workflow manually on security/auth-poc-stage-1 with confirmation DEPLOY-PRODUCTION-AUTH-WORKER-sykabelajar-auth-prod. It updates only the existing Production Worker; it does not create another Worker, alter D1 migrations, rotate/delete secret values, change DNS or switch the frontend. It verifies the existing secret-name inventory and staging invariants.
- Deployment keeps AUTH_SIGNUP_DISABLED=true and SUPABASE_PROVISIONING_ENABLED=false. It does not activate either route by itself. No bootstrap tokens, owner allowlist, Production SendPulse provider row or DB2 provisioning key are currently installed.
- The Production Custom OIDC integration is already registered and read-back verified exactly once by guarded run #44349164162 (attempt 2), integration id def142a5-e811-446a-9e7d-db21c093ed2a, for https://auth-prod.sykabelajar.my.id/api/auth. PKCE S256 and public ES256/P-256 JWKS checks passed. Do not rerun the registrar unless a controlled OIDC repair is specifically required. A real owner token has not yet been accepted by DB2.
- Keep the existing Production BETTER_AUTH_SECRET, AUTH_PROVIDER_ENCRYPTION_KEY and AUTH_EMAIL_ENCRYPTION_KEY. Never copy, rotate or delete staging secrets. The Production sender and DB2 provisioning secrets are separate later gates; install neither before its runbook step.

### C. Apply Stage 3 core identity foundation to Production DB2

- Immediately before any DB2 DDL, run the read-only Production schema baseline again and compare the complete live catalog with the reviewed snapshot. The 20 November read-only inventory is a checkpoint, not a substitute for this immediate preflight.
- Require the external backup destination checksum to be verified in the private owner release record; the encrypted dump/restore passed and the owner confirmed the off-GitHub copy, but that destination checksum is not yet recorded here.
- Generate the exact 69-FK plan from the live catalog with scripts/auth-migration/generate-app-users-fk-plan.mjs. Review all generated phases, source tables/columns, exact existing constraint names and ON DELETE/ON UPDATE/MATCH/validation/deferrability semantics. Stop on any catalog drift.
- After explicit owner approval for the exact DB2 operation, apply the identity-root draft, then seed only UUID-only legacy_reference tombstones required by existing application FK values. Run the three generated FK phases: add replacement constraints NOT VALID, validate every replacement, then perform the atomic swap while preserving each original delete action.
- The identity-root draft creates private.app_users and the trusted, service-role-only provisioning wrappers; it does not copy Auth credentials or business roles. It retires the three legacy auth.users signup/referral triggers in its own reviewed transaction. Preserve every existing auth.users row, profile, role and application row.
- Keep the two issuer-restriction drafts separate from this core step. Do not apply them until the first verified owner account has a genuine Production token and that token has passed the registered Supabase Custom OIDC/Data API acceptance check. The guarded order proven in the disposable workflow is AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql followed by AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql, then the issuer regression.
- Do not switch the Production frontend or open public signup during this intermediate state. Stop on missing/orphan UUIDs, catalog drift, mismatched FK count, lock timeout, statement timeout or any regression. Do not improvise a partial migration.

### D. Enable the narrowly scoped owner provisioning path

- The SendPulse provider row must be configured first using the sender-only endpoint described in AUTH-PRODUCTION-EMAIL-AND-FIRST-ADMIN-BOOTSTRAP.md. Run it only after the guarded Production Worker code update, while SUPABASE_PROVISIONING_ENABLED=false and AUTH_SIGNUP_DISABLED=true. This operation checks the SendPulse API key and stores it encrypted in Production D1; it sends no email and does not enable signup or provisioning.
- After the Stage 3 core identity/FK cutover passes, install only the Production DB2 server-side provisioning credential in the existing Production Worker secret store. This is not SUPABASE_ACCESS_TOKEN and is not a publishable key; never expose it to the browser, Git, logs or chat.
- Verify the exact RPC signatures, postgres ownership, SECURITY DEFINER/search_path, service-role-only EXECUTE grants, Production project URL and D1-to-DB2 projection. The current Worker update workflow intentionally keeps SUPABASE_PROVISIONING_ENABLED=false; it must not be reused to enable provisioning. A separate owner-gated Production Worker configuration workflow still needs to be implemented and tested. It must verify the Stage 3 core catalog/RPC state, the SendPulse D1 row and the Production provisioning secret-name binding, set only SUPABASE_PROVISIONING_ENABLED=true, and continue enforcing AUTH_SIGNUP_DISABLED=true. Do not manually toggle the flag or install staging provisioning credentials before that guarded step exists.

### D1. First Production Admin bootstrap — additional hard gate

- The existing AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql and AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP-UNVERIFIED.sql files are staging-only. Never execute or adapt them in place on Production. The unverified staging exception must never be used in Production.
- The two new internal routes are implemented and tested but not deployed:
  - /_internal/bootstrap-production-email: installs only the SendPulse provider with a temporary owner token and read-only SendPulse stats check. It never sends an email or enables signup/provisioning.
  - /_internal/bootstrap-first-production-account: creates only the exact owner email pinned by AUTH_FIRST_ACCOUNT_EMAIL via one server-side Better Auth signup call. It requires the temporary owner token, active SendPulse provider, mandatory email verification, the Production DB2 server provisioning secret and exact pinned Production environment. The public Better Auth handler, social signups and normal registration remain disabled.
- Both modules and their unit tests passed Auth Worker CI #44683114356: 267/267 Worker tests, SendPulse bootstrap 9/9, first-account bootstrap 7/7, lint/typecheck/build. This is code/local test and dry-run evidence only. Neither endpoint is deployed; no temporary token, SendPulse key or DB2 provisioning key was installed; no Production email or account was created.
- First configure SendPulse using the sender-only route while provisioning remains disabled. Remove AUTH_EMAIL_BOOTSTRAP_TOKEN immediately after its successful one-time call. Inspect only with SELECT if the response is ambiguous; do not retry blindly.
- After Stage 3 core and provisioning checks pass, install a fresh AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN and the exact AUTH_FIRST_ACCOUNT_EMAIL allowlist. Call the first-account route once. It consumes its D1 marker before account creation; any ambiguous failure is manual-inspection-only and must never be blindly replayed.
- Creating this first Better Auth-only Production account is the documented point of no return. Before invoking the endpoint, confirm the off-GitHub backup checksum and accept that rollback to a Supabase-Auth-only state will no longer be available after the new identity exists. Do not reset or import legacy/demo accounts.
- Complete the six-digit SendPulse email OTP. Use the same Production session to verify emailVerified=true, obtain the genuine Better Auth identity UUID, and confirm the same UUID is projected to private.app_users with identity_origin='better_auth' and non-null email_verified_at. Do not forge verification timestamps.
- From that verified owner session, acquire a real Production resource token using the existing OIDC/PKCE flow. Verify exact issuer, audience, ES256 algorithm, UUID sub/JWKS key and successful authenticated read against the owner's own safe DB2 profile. Do not fabricate a JWT or paste cookies/tokens into chat.
- Only after the real token is accepted, apply AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql followed by AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql, exactly as the disposable baseline does. Confirm all 61 restrictive policies, the issuer-gated Admin/organizer/Realtime SECURITY DEFINER helpers and the rollback-only issuer regression. These guards must be active before any business Admin grant or Production frontend switch.
- The SQL grant draft docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql has a passing contract in Supabase Local Auth Claims CI #44681672972 and was included in the passing 50-step disposable baseline #44682199208. After the real token and issuer guards pass, run it once with only the UUID from that same verified Production session. It only grants one Admin role to an already-verified identity_origin='better_auth' UUID and preserves the existing legacy Admin row.
- Before any Production use, repeat live project/issuer/catalog checks; test missing/invalid/replayed tokens, wrong pinned email/environment, non-empty D1, unverified policy, invalid SendPulse key, ambiguous failure/no replay, OTP receipt/verification, UUID/session projection, duplicate Admin refusal, and that legacy Admin/user/profile/session rows remain unchanged. Stop on any mismatch.

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

- [x] Owner-run staging acceptance: 5/5; Stages 1, 2, 4, 5 and 6 are accepted for the agreed authentication-only scope.
- [x] Owner approved the Production cutover architecture and fresh-account model. Exact Production DB2 DDL still requires its immediate preflight and explicit operation approval.
- [x] Full encrypted Production DB2 backup and disposable PostgreSQL 17.6 restore passed; owner confirmed the encrypted archive is outside GitHub.
- [ ] Verify and record the external backup destination checksum in the private owner release record; keep the private age identity offline. This remains a hard pre-DDL gate.
- [x] Production D1 migrations 0000–0010 and 23-table baseline verified in #44341594485; email verification is required, failover default exists, and user/account/session/verification/OAuth/provider rows were empty.
- [x] Dedicated Production Worker sykabelajar-auth-prod is deployed on auth-prod.sykabelajar.my.id with its own Production D1 and secrets; hosted health/discovery/JWKS/PKCE/CORS/closed-signup and staging non-regression passed in #44348084987.
- [x] Production DB2 Custom OIDC issuer https://auth-prod.sykabelajar.my.id/api/auth is registered and verified exactly once by guarded run #44349164162 (attempt 2); integration id def142a5-e811-446a-9e7d-db21c093ed2a. PKCE S256 and public ES256/P-256 JWKS checks passed. A real Production account token has not yet been accepted.
- [x] Latest disposable PostgreSQL 17.6 schema/identity/FK/rollback/Stage 5 rehearsal passed in #44571272221 (49 steps); the first-admin bootstrap contract and expanded 50-step baseline passed in #44681672972 and #44682199208. These runs did not execute Production DB2 DDL/DML.
- [x] Production-only SendPulse and first-owner Worker modules passed lint/typecheck/build and 267/267 Worker tests in #44683114356 (SendPulse 9/9; first-account 7/7). These endpoints are code-only and are not deployed.
- [x] Fresh read-only DB2 inventory on 20 November 2026 still shows 69 application FKs to auth.users, no private.app_users, 3 legacy auth.users triggers, 12 Auth users/identities, 46 sessions, 76 refresh tokens, 12 profiles and 17 business-role rows. No application data was read or changed.
- [ ] Deploy the updated closed-signup Production Worker code through .github/workflows/auth-cloudflare-production-worker-deploy.yml after owner approval. Its 0011 marker suffix is an operations marker; the workflow requires D1 migrations 0000–0010 and preserves/verifies existing Worker secret names.
- [ ] Configure the Production SendPulse provider through the owner-only sender bootstrap; confirm connection only. No email is sent by that operation.
- [ ] Apply Stage 3 core identity-root/provisioning/FK and legacy-trigger DDL to Production DB2 only after the backup checksum, immediate catalog preflight and explicit DDL approval.
- [ ] Prepare and pass a dedicated owner-gated Production provisioning-enable workflow; verify Stage 3 core identity/FK/RPC state, active SendPulse provider and Production provisioning-key binding, then set only SUPABASE_PROVISIONING_ENABLED=true while AUTH_SIGNUP_DISABLED=true.
- [ ] Create the single pinned owner account, receive and complete the six-digit OTP, verify the same UUID in D1/private.app_users/profile, and confirm a genuine Production OIDC token against the DB2 Data API.
- [ ] Apply both issuer guard drafts in the tested order, verify all 61 restrictive policies and SECURITY DEFINER paths, then grant the first Admin with the owner UUID.
- [ ] Remove temporary bootstrap tokens/owner allowlist, retain only the required Production provisioning credential, and keep public signup closed until the frontend release gate passes.
- [ ] Deploy the Production frontend auth configuration and pass the full login/session/API/Storage/Realtime/Edge smoke suite.
- [ ] Verify monitoring/alerts and the Better Auth-compatible rollback path; close Stage 7 only after the observation gate is green.

**Current decision: NO-GO for the Production app/auth cutover.** Production OIDC registration is complete, but there is no real Production user token yet. The external backup destination checksum is not yet recorded, the Production Worker bootstrap routes are not deployed, SendPulse has no Production provider row, and Stage 3 DB2 DDL/provisioning/owner OTP/issuer guards/first Admin/frontend cutover remain pending. Existing Production Auth and application rows are intact; staging remains on its accepted Worker/D1/hostname. The site is unreleased, so no scheduled public maintenance window is needed.

## 9A. Historical staging migration 0013 and provider correction — updated 19 November 2026

- Migration 0013_zeptomail_email_provider.sql remains in staging D1 history because it was already applied on 18 November. Do not edit or replay it.
- PR [#197](https://github.com/taufx98/sykabelajar4.0/pull/197) is merged at commit 53f6fdb4177043884055bae013a34f14ba9fe293. It removed the retired provider from active Worker code, Admin API/panel, provider tests and experimental workflows.
- Post-merge Auth Worker CI and frontend checks passed in [#44424917347](https://github.com/taufx98/sykabelajar4.0/actions/runs/44424917347). Read-only staging and Production preflights passed in [#44424917376](https://github.com/taufx98/sykabelajar4.0/actions/runs/44424917376) and [#44424917342](https://github.com/taufx98/sykabelajar4.0/actions/runs/44424917342).
- Staging D1 migration 0014_finalize_email_provider_allowlist.sql was applied successfully in [#44428277116](https://github.com/taufx98/sykabelajar4.0/actions/runs/44428277116). It required existing migration 0013, found zero unsupported-provider rows, and preserved the single SendPulse provider row, encrypted credential and routing/quota/delivery metadata fingerprints, plus Better Auth identity/session counts.
- The staging Worker was redeployed successfully in [#44428434358](https://github.com/taufx98/sykabelajar4.0/actions/runs/44428434358), version 1d0e0506-9ed9-437b-aded-5432936d47a6. Hosted health, exact issuer, public ES256 JWKS, PKCE S256 and mandatory email-verification checks passed. Existing secrets were preserved.
- No extra provider credential was entered and no email was sent during this correction. SendPulse remains the tested primary provider. Production D1 remains at 0000–0010, and Production Worker/secrets/hostname/DB2/frontend routing remain unchanged.

## 10. Safety record

Production D1 schema and identity state remain unchanged: no Stage 3 DB2 DDL/DML, no Better Auth Production account/session/provider row, no provisioning activation, and no frontend auth routing change. The guarded Production Custom OIDC registration in #44349164162 added only the single verified issuer integration; it did not alter application tables or user records. The read-only DB2 inventory on 20 November confirmed the 69 legacy FKs, three Auth triggers and existing Auth/profile/role counts remain as expected.

The dedicated Production Worker was created and hosted-verified earlier; its current source update that adds the owner-only SendPulse/first-account routes has not yet been deployed. No Production sender credential, temporary bootstrap token or provisioning key was added during this continuation. No Production email or owner account was created. Staging D1 migration 0014 and the staging Worker redeploy remain isolated; existing staging SendPulse credentials, identities, sessions, hostname and bindings were preserved.
