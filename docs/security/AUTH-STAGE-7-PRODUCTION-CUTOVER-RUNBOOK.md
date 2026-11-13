# Stage 7 — Better Auth Production Cutover Runbook

**Status: preparation in progress; Production GO-LIVE is not authorized.**

This document defines the controlled release sequence for the agreed Better Auth-only, fresh-account authentication model. It is not a production migration, deployment, DNS change, secret operation, account reset, or cutover authorization. Production steps require all GO gates below plus explicit owner approval for the cutover window.

## 1. Live environment snapshot — 13 November 2026

### Supabase projects

| Environment | Project | Plan / PostgreSQL | private.app_users | auth.users | Application FK state |
|---|---|---|---:|---:|---|
| Production DB2 | mvdczyitbkxkldjughor | Free / 17.6 | absent | legacy rows retained | 69 FKs to auth.users; 0 to private.app_users; 3 non-internal auth.users triggers |
| Auth staging | ydamszdfsxqisanazdkb | Free / 17.11 | present | 0 rows | isolated identity fixture and provisioning contract |

These figures come from read-only checks. No Production DDL/DML, account, Auth setting, RLS policy, trigger, secret, or Edge Function was changed.

The connected Supabase organization is on the Free plan. Supabase Free does not provide automatic daily backups or PITR. The schema-only CI export is not a data backup; see Section 5.

### Cloudflare staging resources

The checked-in Worker configuration currently points to:

- Worker script: sykabelajar-auth-poc
- D1 database: sykabelajar-auth-poc (7a4f9008-a1c6-42b6-8a04-abde12699248)
- Custom domain currently attached to the staging Worker: auth.sykabelajar.my.id
- Staging Supabase provisioning target: ydamszdfsxqisanazdkb
- Staging Better Auth public issuer: https://auth.sykabelajar.my.id/api/auth

This is staging infrastructure, not a Production Worker or D1. It must not be promoted or reused as Production. In particular, its provisioning flag is enabled against the isolated staging Supabase project.

### Owner-operated staging acceptance

The owner has run the hosted Uji Penerimaan Better Auth — Staging panel and reported 5/5 passed: session/Data API/profile/role isolation; PKCE resource-token re-issuance on the same session and UUID; private Storage ownership; private Realtime topic isolation; and shared ES256 verifier checks for issuer, audience, subject, role and RLS. The temporary Storage probe file was deleted. Do not repeat this panel unless a concrete regression occurs.

## 2. Separate staging and Production before cutover

The current staging Worker occupies auth.sykabelajar.my.id. A second Worker cannot safely take the same hostname while staging still owns it. The release sequence therefore starts by moving staging away from the Production hostname.

1. Create or attach the staging-only hostname auth-staging.sykabelajar.my.id to the existing staging Worker. Do not change the staging D1 database or its data.
2. Update only staging Worker configuration and staging Pages environment: Better Auth URL, OIDC issuer, callback URL, exact CORS/Origin allowlist and resource audience must all agree with the new staging hostname.
3. Register the new staging Custom OIDC issuer in the isolated staging Supabase project. Verify discovery, JWKS, PKCE, real login, Data API, Storage, Realtime and the existing five-check panel using the new hostname.
4. Keep the previous staging issuer/provider available until tokens issued under it have expired and the Supabase JWKS/provider propagation window has passed. The current OIDC runbook allows up to 30 minutes for key/provider propagation. Remove the old staging provider only after the replacement passes.
5. Create a separate, empty Production D1 database named sykabelajar-auth-prod and a separate Production Worker. Use a separate Wrangler configuration, separate secrets, and a separate deployment workflow. Do not copy staging users, credentials, sessions, verification records, OAuth grants, JWKS private keys, or encryption keys.
6. Bind only the new Production D1 to the Production Worker. After the staging Worker has moved and passed acceptance, attach auth.sykabelajar.my.id to the Production Worker.
7. Production provisioning must remain disabled until the Production identity migration and server-only DB2 provisioning credential are installed and verified.

Never point the staging Worker or staging D1 to Production DB2. Never point the Production Worker to the staging project. Keep both environments on their own issuer/audience and secrets.

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

Production DB2 is on Supabase Free. Its automatic daily backup and PITR protections are unavailable. A schema-only export is not a substitute for a data backup.

Before any Production identity DDL:

1. From an owner-controlled trusted environment, take a full logical backup of Production DB2 including application data, schema, policies, functions, triggers and constraints. Use a protected credential file or environment supported by PostgreSQL tooling; never place the connection URI or password in shell command text, terminal history, GitHub logs, workflow artifacts, source code or chat.
2. Encrypt the backup at rest and store it outside the repository and outside an ephemeral GitHub Actions runner. Record checksum (SHA-256), file size, creation time, source project ref and PostgreSQL major version in a separate non-secret release record.
3. Restore that exact backup into a disposable PostgreSQL 17-compatible environment with no application traffic. Verify that the database opens and that schema/catalog invariants and representative row counts match. Do not publish personal data or user rows.
4. Record the restore result, duration and exact backup checksum. A backup that has not been restored is not accepted as a rollback safeguard.
5. Retain the encrypted backup through the full cutover and rollback observation window. Do not commit it, upload it as a public CI artifact or attach it to this PR.

Do not create paid Supabase branches, enable paid PITR, upgrade the organization or purchase a backup add-on without explicit cost approval. References: [Supabase backups](https://supabase.com/docs/guides/platform/backups) and [Supabase pricing](https://supabase.com/pricing).

## 6. Ordered Production cutover

### A. Preflight and freeze

- Confirm Production project ref, database version, migration head and current live catalog immediately before the maintenance window.
- Run the read-only Auth Production Schema Baseline workflow. Require reviewed parity: 69 application FKs across 62 source tables, 109 auth.uid() policies, expected Auth/profile triggers and Auth-dependent function definitions. Stop on drift.
- Complete the encrypted full-data backup and successful disposable restore from Section 5.
- Verify Production-specific Worker/D1 and secret names exist without printing secret values. Confirm no Production secret equals a staging-only key or provider token.
- Announce a maintenance window. Freeze new account creation and nonessential auth configuration changes during the schema/issuer transition. Do not delete/reset/mutate legacy accounts.
- Confirm the staging Worker is healthy on auth-staging.sykabelajar.my.id and staging app/Custom OIDC acceptance has passed there before releasing auth.sykabelajar.my.id.

### B. Prepare Production Worker and D1 without application routing

- Apply reviewed Better Auth D1 schema migrations only to the new empty Production D1 through a Production-specific exact-target workflow. Do not run staging D1 workflows for this.
- Verify schema, indexes, foreign keys, discovery, JWKS, /healthz, cookie attributes, strict CORS, Origin/CSRF rejection, rate limits and secret-name/type presence. Never print secret values.
- Keep Production public signup closed and identity provisioning disabled during infrastructure-only tests.
- Verify the Production Worker on a temporary/private test surface before attaching the public auth hostname.

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

### E. Switch Production routing

- Deploy the Production frontend bundle/config only after Worker, D1, identity projection, issuer and all pre-cutover tests pass.
- Attach auth.sykabelajar.my.id to the Production Worker only after the staging Worker has moved and staging has passed on its new hostname.
- Switch only the Production app's Better Auth endpoint/resource-token configuration. Keep Supabase DB2 URL and publishable key for application data access.
- Run Production smoke tests: register, real email verification, password reset, login, logout, reload/session restore, protected routes, resource-token refresh, Data API, private Storage/Realtime, Edge verifier, invalid token denial, role denial and identity provisioning.
- Keep the maintenance window active until smoke checks and monitoring are green. Supabase Auth is not disabled as a service.

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
- [x] Stage 3 full schema-only Production export/restore and disposable 69-FK forward/rollback rehearsal previously passed.
- [x] Local D1 expired-session rejection and reauthentication test passed; registration browser tests passed (15 passed, one optional Google OAuth skipped).
- [x] Runtime CI and PR-head CI before the final Stage 3 atomicity correction passed: Auth Worker, Supabase Local Auth Claims, browser smoke and Cloudflare staging preflight.
- [x] Stage 3 identity-root draft was amended so legacy Auth trigger retirement is inside the same transaction; a new contract test enforces a single final COMMIT.
- [ ] Updated Stage 3 contract and full disposable schema-baseline workflow pass after the atomicity correction.
- [ ] Owner review/acceptance of this runbook, especially fresh-account behavior and no inheritance of existing business rows.
- [ ] Staging Worker moved to auth-staging.sykabelajar.my.id; staging app and isolated Custom OIDC provider accepted on the new issuer.
- [ ] Dedicated Production Worker and separate empty Production D1 created; Production secret set and endpoint tested.
- [ ] Production email sender configured and real verification/reset delivery accepted. Until then, Production public signup remains closed.
- [ ] Full encrypted Production data backup restored successfully in a disposable PostgreSQL 17-compatible environment.
- [ ] Fresh read-only Production catalog baseline still matches reviewed 69-FK / 109-policy / 3-trigger state.
- [ ] Production Custom OIDC provider, provisioning RPC grants, first-admin procedure, monitoring and alert route validated.
- [ ] Explicit owner approval for the Production maintenance/cutover window and acceptance of the PONR/rollback model.

**Current decision: NO-GO for Production cutover.** Stage 7 preparation can be marked complete only after the post-fix disposable workflow passes and the owner has reviewed the release runbook. Production DDL, Worker/D1 deployment, DNS, Pages, secrets, Auth settings, account mutations, PR merge and public signup remain prohibited until all GO gates are satisfied and explicitly approved.

## 10. Safety record

This runbook does not mutate Production DB2, Supabase Auth, Production D1/Worker, DNS, Pages configuration, secrets, accounts, business data, Cloudinary, payment settings or unrelated application features. Staging users and legacy/demo accounts remain untouched. PR #177 remains open, Draft and unmerged.
