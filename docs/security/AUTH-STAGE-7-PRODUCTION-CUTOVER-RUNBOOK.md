# Current provider and Stage 7 instruction — 22 November 2026

## Superseding owner directive — 23 November 2026 (highest priority)

This directive overrides every older instruction in this runbook that asks to back up, retain, export, restore, re-home, or migrate existing account/application data:

- SYKABELAJAR starts from a clean zero-user/zero-test-data state. Do not migrate, import, merge, backfill, or attach any old Supabase Auth account, password, identity, session, profile, role, referral, wallet, order, registration, exam, participant, or other user-linked data to a fresh Better Auth identity.
- Do not create or require a new account/user/application-data backup, row export, or data restore for this cutover. The historical November 14 archive is not a prerequisite, migration source, or rollback requirement. Never restore it for this project start.
- Schema-only catalog export to a disposable local PostgreSQL instance is allowed for code/security acceptance, provided it contains no application rows, account rows, credential values, or other user data.
- Treat existing demo/test accounts and user-linked test records as disposable. Keep only reviewed application schema and explicitly required system/configuration records; do not assume business/test rows must be retained.
- Do not run a destructive Production reset, bulk TRUNCATE/DELETE, FK switch, or account cleanup until its table allowlist, dependencies, preservation exceptions, zero-state assertions, and execution order are reviewed in a separate plan. Production execution remains blocked until that exact operation is approved.
- New users must be provisioned with fresh Better Auth UUIDs and fresh application profiles/roles. Matching an old email must never inherit the old UUID, role, profile, wallet, referral, or activity.

The older backup and application-row-preservation sections below are historical records only wherever they conflict with this directive.

**SendPulse remains the tested primary transactional-email provider. Do not configure or use any additional provider unless the owner explicitly requests it.** The approved managed provider list is SendPulse, Brevo, Mailjet, Mailtrap Email Sending, Resend and Custom HTTP.

**Latest isolated rehearsal — 22 November 2026:** PR [#210](https://github.com/taufx98/sykabelajar4.0/pull/210) merged as `440a75bbd77cc486a277661f336eb2464e08f285`. Auth Worker CI [#44968023698](https://github.com/taufx98/sykabelajar4.0/actions/runs/44968023698), Supabase Local Auth Claims CI [#44968023980](https://github.com/taufx98/sykabelajar4.0/actions/runs/44968023980), and read-only staging preflight [#44968023648](https://github.com/taufx98/sykabelajar4.0/actions/runs/44968023648) passed. Auth Production Schema Baseline [#44968023703](https://github.com/taufx98/sykabelajar4.0/actions/runs/44968023703) passed all 50 steps using a read-only Production schema export and a disposable PostgreSQL 17.6 restore. The Stage 5 ACL draft removed browser-role/PUBLIC privileges only inside the disposable restore, confirmed no CRUD/TRUNCATE/REFERENCES/TRIGGER access remained for anon/authenticated, and preserved service_role/postgres CRUD. This run did not execute any Production DB2 DDL/DML or alter staging resources. It does not mark the 23-table RLS review or 202-function SECURITY DEFINER review complete.

PR #197 and staging D1 migration 0014 remain accepted; the staging Worker version and its SendPulse account/identity state are preserved. Production OIDC is registered exactly once in DB2 by [#44349164162](https://github.com/taufx98/sykabelajar4.0/actions/runs/44349164162), attempt 2. The disposable 69-FK/identity-root/issuer/rollback and Stage 5 Edge rehearsal passed in [#44571272221](https://github.com/taufx98/sykabelajar4.0/actions/runs/44571272221), with the expanded 50-step baseline in [#44682199208](https://github.com/taufx98/sykabelajar4.0/actions/runs/44682199208). PR [#199](https://github.com/taufx98/sykabelajar4.0/pull/199) corrected Production bootstrap JSON type guards; Auth Worker CI [#44841123194](https://github.com/taufx98/sykabelajar4.0/actions/runs/44841123194) and post-merge CI [#44841281657](https://github.com/taufx98/sykabelajar4.0/actions/runs/44841281657) passed, as did read-only staging preflight [#44841281592](https://github.com/taufx98/sykabelajar4.0/actions/runs/44841281592). The owner-dispatched Production Worker update [#44833402559](https://github.com/taufx98/sykabelajar4.0/actions/runs/44833402559), attempt 2, deployed Worker version `b3bb0c0c-8a32-4e87-9027-06a4950cd306`. Hosted postflight confirmed runtime/JWKS/PKCE/CORS/closed signup and matching before/after D1, secret-name and staging snapshots. The attempt's red conclusion is isolated to final runner-temp cleanup; deploy and all postflight checks passed.

---

# Stage 7 — Better Auth Production Cutover Runbook

**Status: preparation in progress; Production GO-LIVE remains NO-GO.** Production OIDC is registered, disposable Stage 3/rollback rehearsal is accepted, and the closed Production Worker source containing the SendPulse and first-owner handlers is deployed and postflight-verified. Neither bootstrap route has been invoked. No Production DB2 DDL/DML, sender credential/provider row, bootstrap token, owner account, provisioning enablement, OTP/email, Admin grant or frontend switch has been created.

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
- **Dedicated Production Worker:** `sykabelajar-auth-prod` was initially created on `auth-prod.sykabelajar.my.id` by [#44347403101](https://github.com/taufx98/sykabelajar4.0/actions/runs/44347403101), with its own Production D1 and three Production-only secrets. Initial hosted checks passed in [#44348084987](https://github.com/taufx98/sykabelajar4.0/actions/runs/44348084987). The closed Worker source update was deployed by [#44833402559](https://github.com/taufx98/sykabelajar4.0/actions/runs/44833402559), attempt 2; current Worker version is `b3bb0c0c-8a32-4e87-9027-06a4950cd306`. Postflight confirmed health, discovery, ES256 JWKS, PKCE S256, exact CORS, required email verification and public signup HTTP 503. Production D1 migration history and identity/provider data, Production secret-name bindings and staging Worker/D1/domain were unchanged. Production Custom OIDC remains registered exactly once by [#44349164162](https://github.com/taufx98/sykabelajar4.0/actions/runs/44349164162). The Worker is live but remains disconnected from the Production frontend.
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
- Keep Production email verification required. SendPulse remains the approved and tested primary transactional-email provider. Its owner-only bootstrap handler is included in deployed Worker version `b3bb0c0c-8a32-4e87-9027-06a4950cd306` but has not been invoked. `AUTH_EMAIL_BOOTSTRAP_TOKEN` is absent, no Production SendPulse API key/provider row is configured, and no email has been sent. After separate sender setup, the endpoint verifies the SendPulse API key through a read-only statistics request and stores it encrypted; it does not send a message or open signup/provisioning. Do not paste credentials into chat/source control or forge `emailVerified`.
- The first-admin/email bootstrap loop remains split into two separately guarded steps. Both Production bootstrap handlers are in the deployed closed Worker source but remain uninvoked: the SendPulse sender token/API key is absent, and the first-account route remains unavailable while `SUPABASE_PROVISIONING_ENABLED=false` and no owner allowlist/token/DB2 provisioning key exists. The verified Production Admin grant SQL draft `docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql` has passing local contract coverage [#44681672972](https://github.com/taufx98/sykabelajar4.0/actions/runs/44681672972) and is included in the expanded disposable baseline. It grants `admin` only to an existing verified Better Auth identity in `private.app_users` after the 69-FK/issuer-guard cutover; it does not create the owner account.
- Supabase Auth cannot currently be disabled as a service. Keep its existing data and service configuration intact. This does not mean old Supabase Auth tokens should remain authorized after the Better Auth issuer guard is enabled.

Official Supabase references: [Custom OIDC](https://supabase.com/docs/guides/auth/third-party/custom-oidc) and [Third-party Auth overview](https://supabase.com/docs/guides/auth/third-party/overview).

## 4. Fresh-account identity consequences

The agreed design starts with fresh Better Auth accounts. It does not import old Supabase Auth credentials, password hashes, identities or sessions. Existing auth.users rows and application rows remain untouched.

**Owner clarification — 21 November 2026:** the existing legacy accounts are testing/demo accounts only; there are no active public users to migrate. They are explicitly excluded from the Better Auth identity population and do not block cutover. No credentials, sessions, identities or business roles are to be imported, and no new account is to inherit an old account's profile or history by matching email. The UUID-only `private.app_users` tombstones in the rehearsed Stage 3 path are optional structural FK anchors for application test rows that are intentionally retained; they are not old-user accounts. This decision does not authorize broad deletion of application tables or Supabase-managed `auth`/`storage` objects.

The Stage 3 design uses private.app_users as the new identity root and UUID-only legacy_reference tombstones to preserve existing application foreign-key references. A tombstone is not a login identity; it contains no password, email identity, session or copied business role.

After Better Auth issuer guards are enabled, Supabase Auth JWTs are rejected on guarded application surfaces. A person who registers again with the same email receives a new Better Auth UUID. That new UUID does not automatically inherit the old UUID's profile, business roles, referral history, registrations, wallet or other application rows. Existing data remains under its old UUID and is not deleted, but it is not automatically attached to the new account.

Before Production GO, the owner must explicitly acknowledge that this fresh-start behavior is intended for the Production population, not only staging tests. Do not invent email-based account merges or silently reassign business data.

## 5. Historical backup activity — superseded; not a cutover gate

The earlier November 14 full database archive/restore rehearsal is historical evidence only. Per the 23 November owner directive, it must not be used as a source for account or application-data migration, and its external checksum is not a release gate. Do not rerun the Production DB2 backup workflow, create a replacement account/data archive, or restore old rows.

The Stage 7 baseline workflow may continue to export schema and catalog metadata only for disposable acceptance. Its manifest must continue to prove that no table rows, Auth accounts, profiles, credentials, or application data are present in the export/restore fixture.

Rollback for the fresh-start release is code/configuration rollback and fail-closed routing recovery, not restoring legacy account/application rows. If a clean reset is later required, first review the exact table allowlist and dependency order; do not create an unapproved broad truncate/delete script.

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
- The closed Worker source update containing both owner-only bootstrap endpoints was deployed as version `b3bb0c0c-8a32-4e87-9027-06a4950cd306` by [#44833402559](https://github.com/taufx98/sykabelajar4.0/actions/runs/44833402559), attempt 2. The guarded workflow requires exact Production D1 migrations 0000–0010, exact Production and staging Worker/D1/hostname bindings, and before/after D1 identity/provider fingerprints. Its red conclusion is only the final runner-temp cleanup failure after postflight passed.
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
- Verify the exact RPC signatures, PostgreSQL ownership, SECURITY DEFINER/search_path, service-role-only EXECUTE grants, Production project URL and D1-to-DB2 projection. The dedicated owner-only activation workflow is merged in PR [#202](https://github.com/taufx98/sykabelajar4.0/pull/202) at `.github/workflows/auth-cloudflare-production-provisioning-enable.yml`; its contract test is `services/auth-worker/tests/production-provisioning-enable-contract.test.mjs`. Post-merge Auth Worker CI [#44851590910](https://github.com/taufx98/sykabelajar4.0/actions/runs/44851590910) and read-only staging preflight [#44851590980](https://github.com/taufx98/sykabelajar4.0/actions/runs/44851590980) passed. The workflow file remains manual-only and is not dispatched. It is not dispatched and is deliberately blocked by the current 0/202 SECURITY DEFINER review manifest, missing verified backup checksum attestation, unapplied Stage 3 foundation, missing Production SendPulse row and missing server-only `SUPABASE_PROVISIONING_API_KEY` binding. It can deploy only a temporary Production config that changes `SUPABASE_PROVISIONING_ENABLED` from false to true, while preserving `AUTH_SIGNUP_DISABLED=true`; it checks the 69 application-FK cutover, retired auth.users triggers, service_role-only wrappers, exact staging/Production Worker/D1/domain bindings, D1 empty state and SendPulse provider row before deploy, then repeats postflight and proves no identity data was created. Never dispatch it until every precondition is genuinely satisfied and the owner has approved the exact activation. The workflow additionally compares the live 202-function SECURITY DEFINER source/ACL/owner/search_path metadata with the stored snapshot, and checks that all other Production Worker variables, secret names, and the encrypted SendPulse provider/routing/quota state are byte-for-byte unchanged after activation.

### D1. First Production Admin bootstrap — additional hard gate

- The existing AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP.sql and AUTH-STAGING-FIRST-ADMIN-BOOTSTRAP-UNVERIFIED.sql files are staging-only. Never execute or adapt them in place on Production. The unverified staging exception must never be used in Production.
- The two internal routes are deployed in the closed Worker source but remain gated and uninvoked:
  - /_internal/bootstrap-production-email: installs only the SendPulse provider after a one-time owner token is configured and a read-only SendPulse statistics check passes. It never sends an email or enables signup/provisioning.
  - /_internal/bootstrap-first-production-account: creates only the exact owner email pinned by AUTH_FIRST_ACCOUNT_EMAIL via one server-side Better Auth signup call. It also requires its one-time token, an active SendPulse provider, mandatory email verification, the Production DB2 server provisioning credential and the separate provisioning-enable gate. That gate remains false, so this route is currently unavailable. Public signup/social signups remain disabled.
- Both modules passed Auth Worker CI #44683114356 (267/267 tests; SendPulse 9/9; first-account 7/7), and the corrected branch passed [#44841123194](https://github.com/taufx98/sykabelajar4.0/actions/runs/44841123194) plus post-merge CI [#44841281657](https://github.com/taufx98/sykabelajar4.0/actions/runs/44841281657). They are deployed as closed handlers, but no temporary token, SendPulse key, DB2 provisioning key, Production email or account was added.
- First configure SendPulse using the sender-only route while provisioning remains disabled. Remove AUTH_EMAIL_BOOTSTRAP_TOKEN immediately after its successful one-time call. Inspect only with SELECT if the response is ambiguous; do not retry blindly.
- After Stage 3 core and provisioning checks pass, install a fresh AUTH_FIRST_ACCOUNT_BOOTSTRAP_TOKEN and the exact AUTH_FIRST_ACCOUNT_EMAIL allowlist. Call the first-account route once. It consumes its D1 marker before account creation; any ambiguous failure is manual-inspection-only and must never be blindly replayed.
- Creating this first Better Auth-only Production account is the documented point of no return. Before invoking the endpoint, confirm the off-GitHub backup checksum and accept that rollback to a Supabase-Auth-only state will no longer be available after the new identity exists. Do not reset or import legacy/demo accounts.
- Complete the six-digit SendPulse email OTP. Use the same Production session to verify emailVerified=true, obtain the genuine Better Auth identity UUID, and confirm the same UUID is projected to private.app_users with identity_origin='better_auth' and non-null email_verified_at. Do not forge verification timestamps.
- From that verified owner session, acquire a real Production resource token using the existing OIDC/PKCE flow. Verify exact issuer, audience, ES256 algorithm, UUID sub/JWKS key and successful authenticated read against the owner's own safe DB2 profile. Do not fabricate a JWT or paste cookies/tokens into chat.
- Only after the real token is accepted, apply AUTH-STAGE-3-ISSUER-RESTRICTION-DRAFT.sql followed by AUTH-STAGE-3-SECURITY-DEFINER-ISSUER-GUARDS-DRAFT.sql, exactly as the disposable baseline does. Confirm all 61 restrictive policies, the issuer-gated Admin/organizer/Realtime SECURITY DEFINER helpers and the rollback-only issuer regression. These guards must be active before any business Admin grant or Production frontend switch.
- The SQL grant draft docs/security/AUTH-PRODUCTION-FIRST-ADMIN-BOOTSTRAP-DRAFT.sql has a passing contract in Supabase Local Auth Claims CI #44681672972 and was included in the passing 50-step disposable baseline #44682199208. After the real token and issuer guards pass, run it once with only the UUID from that same verified Production session. It only grants one Admin role to an already-verified identity_origin='better_auth' UUID and preserves the existing legacy Admin row.
- Before any Production use, repeat live project/issuer/catalog checks; test missing/invalid/replayed tokens, wrong pinned email/environment, non-empty D1, unverified policy, invalid SendPulse key, ambiguous failure/no replay, OTP receipt/verification, UUID/session projection, duplicate Admin refusal, and that legacy Admin/user/profile/session rows remain unchanged. Stop on any mismatch.

### E0. Direct application table RLS/GRANT boundary acceptance before frontend cutover

- The 23 application-owned RLS-enabled tables (20 `public`, 3 `private`) are classified in `docs/security/AUTH-STAGE-7-RLS-POLICY-REVIEW-2026-11-22.json`. The 26 platform-owned `auth`/`storage` tables are excluded and must remain untouched.
- **Disposable direct-table boundary accepted:** Auth Production Schema Baseline [#45100444988](https://github.com/taufx98/sykabelajar4.0/actions/runs/45100444988), commit `feeefcfa3077adfcb6a1151cf03bb8bff75a5321`, passed the 23-table read-only regression on PostgreSQL 17.6 after the Stage 5 no-policy ACL draft and Stage 7 portal hardening. It verifies every table remains owned by `postgres`, RLS-enabled and policy-free; `anon` and `authenticated` have no effective direct SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN privileges; no explicit `PUBLIC` ACL remains; `service_role` CRUD is preserved on the 20 designated public backend tables and absent on the three private tables.
- Do not add a generic policy to these tables. Their no-policy RLS remains default-deny for browser roles, and their intended access paths remain narrow SECURITY DEFINER RPCs or server-side `service_role` callers. The three former broad-grant tables (`competition_status_history`, `notification_deliveries`, `supabase_system_logs`) lose browser-role table grants only in the disposable rehearsal; no Production grants were changed.
- This accepted gate is deliberately limited to **direct table ACL/RLS behavior on the disposable schema**. It does not establish that every SECURITY DEFINER caller is issuer-safe or that every owner/Admin/organizer/token business path has passed IDOR tests. The separate SECURITY DEFINER audit remains **0/202 individually reviewed** and blocks Production DB2 DDL, provisioning activation and frontend cutover until complete.
- The latest expanded portal acceptance is recorded in [AUTH-STAGE-7-PORTAL-TOKEN-ACCEPTANCE-2026-11-23.json](AUTH-STAGE-7-PORTAL-TOKEN-ACCEPTANCE-2026-11-23.json). Auth Production Schema Baseline [#45139283555](https://github.com/taufx98/sykabelajar4.0/actions/runs/45139283555) passed 62/62 on commit `165c0a9f0d618c98d428b012d91bb6b836bc33f3`; Local Auth CI [#45139283588](https://github.com/taufx98/sykabelajar4.0/actions/runs/45139283588) passed 23/23. The two-participant disposable regression now covers reciprocal attempt-bound checks across exam state, skip and timeout operations, plus parent/child revocation isolation. All fixtures are synthetic and roll back on the schema-only PostgreSQL 17.6 restore. This is portal-token runtime acceptance only; the separate 202-function SECURITY DEFINER review remains 0/202 and blocks Production.
- Keep Production schema/grants/policies untouched until the separately reviewed zero-start operation and all issuer/SECURITY DEFINER gates are approved. No Production cleanup or direct policy/grant change is authorized by this disposable acceptance.

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
- [x] Owner directive 23 November: no legacy account/application-data migration, no new account/data backup, and no restore/import of historical user data. Schema-only disposable acceptance remains allowed.
- [ ] Complete the reviewed zero-start Production data-cleanup allowlist and dependency order; assert no legacy account or user-linked records are imported or attached to new identities. Destructive execution requires separate exact approval.
- [x] Production D1 migrations 0000–0010 and 23-table baseline verified in #44341594485; email verification is required, failover default exists, and user/account/session/verification/OAuth/provider rows were empty.
- [x] Dedicated Production Worker sykabelajar-auth-prod is deployed on auth-prod.sykabelajar.my.id with its own Production D1 and secrets; hosted health/discovery/JWKS/PKCE/CORS/closed-signup and staging non-regression passed in #44348084987.
- [x] Production DB2 Custom OIDC issuer https://auth-prod.sykabelajar.my.id/api/auth is registered and verified exactly once by guarded run #44349164162 (attempt 2); integration id def142a5-e811-446a-9e7d-db21c093ed2a. PKCE S256 and public ES256/P-256 JWKS checks passed. A real Production account token has not yet been accepted.
- [x] Latest disposable PostgreSQL 17.6 schema/identity/FK/rollback/Stage 5 rehearsal passed in #44571272221 (49 steps); the first-admin bootstrap contract and expanded 50-step baseline passed in #44681672972 and #44682199208. These runs did not execute Production DB2 DDL/DML.
- [x] Production-only SendPulse and first-owner Worker modules passed lint/typecheck/build and 267/267 Worker tests in #44683114356 (SendPulse 9/9; first-account 7/7), then shipped in closed Worker version `b3bb0c0c-8a32-4e87-9027-06a4950cd306`. Both endpoints remain gated and uninvoked.
- [x] Stage 7 direct table ACL/RLS boundary for all 23 application tables passed on the disposable restore in Auth Production Schema Baseline #45100444988; no Production grants or policies were changed.
- [ ] Complete the separate per-function SECURITY DEFINER issuer/caller audit (0/202 reviewed); this remains a Production DDL, provisioning and frontend-cutover blocker.
- [x] Fresh read-only DB2 inventory on 20 November 2026 still shows 69 application FKs to auth.users, no private.app_users, 3 legacy auth.users triggers, 12 Auth users/identities, 46 sessions, 76 refresh tokens, 12 profiles and 17 business-role rows. No application data was read or changed.
- [x] Deploy the closed-signup Production Worker code through the owner-dispatched workflow [#44833402559](https://github.com/taufx98/sykabelajar4.0/actions/runs/44833402559), attempt 2; version `b3bb0c0c-8a32-4e87-9027-06a4950cd306`. Runtime, closed-signup and D1/secret/staging-preservation postflight checks passed. The Actions red conclusion is only its cleanup command failure after deployment/postflight.
- [ ] Configure the Production SendPulse provider through the owner-only sender bootstrap; confirm connection only. No email is sent by that operation.
- [ ] Apply Stage 3 core identity-root/provisioning/FK and legacy-trigger DDL to Production DB2 only after the zero-start table allowlist, immediate catalog preflight and explicit DDL approval.
- [ ] Prepare and pass a dedicated owner-gated Production provisioning-enable workflow; verify Stage 3 core identity/FK/RPC state, active SendPulse provider and Production provisioning-key binding, then set only SUPABASE_PROVISIONING_ENABLED=true while AUTH_SIGNUP_DISABLED=true.
- [ ] Create the single pinned owner account, receive and complete the six-digit OTP, verify the same UUID in D1/private.app_users/profile, and confirm a genuine Production OIDC token against the DB2 Data API.
- [ ] Apply both issuer guard drafts in the tested order, verify all 61 restrictive policies and SECURITY DEFINER paths, then grant the first Admin with the owner UUID.
- [ ] Remove temporary bootstrap tokens/owner allowlist, retain only the required Production provisioning credential, and keep public signup closed until the frontend release gate passes.
- [ ] Deploy the Production frontend auth configuration and pass the full login/session/API/Storage/Realtime/Edge smoke suite.
- [ ] Verify monitoring/alerts and the Better Auth-compatible rollback path; close Stage 7 only after the observation gate is green.

**Current decision: NO-GO for the Production app/auth cutover.** Production OIDC registration and the closed Worker code update are complete, but there is no real Production owner session/token. The zero-start reset allowlist and execution order are not yet accepted; no SendPulse provider row, bootstrap token, Production provisioning credential, owner account/OTP or Admin role exists. Stage 3 DB2 DDL, provisioning activation, issuer guards and frontend cutover remain pending. Existing Production Auth/application rows and accepted staging state are intact. The site is unreleased, so no scheduled public maintenance window is needed.

## 9A. Historical staging migration 0013 and provider correction — updated 19 November 2026

- Migration 0013_zeptomail_email_provider.sql remains in staging D1 history because it was already applied on 18 November. Do not edit or replay it.
- PR [#197](https://github.com/taufx98/sykabelajar4.0/pull/197) is merged at commit 53f6fdb4177043884055bae013a34f14ba9fe293. It removed the retired provider from active Worker code, Admin API/panel, provider tests and experimental workflows.
- Post-merge Auth Worker CI and frontend checks passed in [#44424917347](https://github.com/taufx98/sykabelajar4.0/actions/runs/44424917347). Read-only staging and Production preflights passed in [#44424917376](https://github.com/taufx98/sykabelajar4.0/actions/runs/44424917376) and [#44424917342](https://github.com/taufx98/sykabelajar4.0/actions/runs/44424917342).
- Staging D1 migration 0014_finalize_email_provider_allowlist.sql was applied successfully in [#44428277116](https://github.com/taufx98/sykabelajar4.0/actions/runs/44428277116). It required existing migration 0013, found zero unsupported-provider rows, and preserved the single SendPulse provider row, encrypted credential and routing/quota/delivery metadata fingerprints, plus Better Auth identity/session counts.
- The staging Worker was redeployed successfully in [#44428434358](https://github.com/taufx98/sykabelajar4.0/actions/runs/44428434358), version 1d0e0506-9ed9-437b-aded-5432936d47a6. Hosted health, exact issuer, public ES256 JWKS, PKCE S256 and mandatory email-verification checks passed. Existing secrets were preserved.
- No extra provider credential was entered and no email was sent during this correction. SendPulse remains the tested primary provider. Production D1 remains at 0000–0010, and Production Worker/secrets/hostname/DB2/frontend routing remain unchanged.

## 10. Safety record

Production D1 schema and identity state remain unchanged: no Stage 3 DB2 DDL/DML, no Better Auth Production account/session/provider row, no provisioning activation, and no frontend auth routing change. The guarded Production Custom OIDC registration in #44349164162 added only the single verified issuer integration; it did not alter application tables or user records. The read-only DB2 inventory on 20 November confirmed the 69 legacy FKs, three Auth triggers and existing Auth/profile/role counts remain as expected.

The dedicated Production Worker now runs the closed source update containing the owner-only SendPulse and first-account handlers (version `b3bb0c0c-8a32-4e87-9027-06a4950cd306`). Postflight verified Production runtime and closed signup, unchanged Production D1 identity/session/provider data and secret-name bindings, and unchanged staging Worker/D1/hostname. No Production sender credential, temporary bootstrap token or provisioning key was added; no email or owner account was created. Staging D1 migration 0014 and the accepted staging Worker remain unchanged.
