# SYKABELAJAR Better Auth Migration Roadmap

This is the approved implementation order. Keep all work within these seven stages. A security finding may be handled as a prerequisite when it directly affects identity, privacy, RLS, or authorization; it must not become a reason to redesign unrelated application features.

Detailed current blockers, the latest read-only Cloudflare/Supabase verification, and production rollback rules are recorded in [AUTH-STAGES-STATUS-AND-ROLLBACK.md](AUTH-STAGES-STATUS-AND-ROLLBACK.md).

## Architecture decisions

- Better Auth is the only account and session authority after cutover.
- Cloudflare D1 stores authentication-only records: users, accounts, sessions, verification, OAuth grants, JWKS, and auth rate-limit state.
- Supabase PostgreSQL remains the application database and authorization authority for profiles, business roles, competitions, exams, Shop, Edu Coin, chat, orders, certificates, and application data.
- Better Auth creates fresh UUID identities for new registrations. Existing Supabase Auth demo/testing credentials, password hashes, and sessions are not migrated.
- The UUID is shared by Better Auth `user.id`, Supabase `private.app_users.id`, and JWT `sub`.
- The JWT role claim is the Postgres role `authenticated`, never a SYKABELAJAR business role.
- Business roles continue to be loaded from the existing Supabase `public.user_roles` table and `public.app_role` enum. Preserve roles such as student, teacher, organizer_member, admin, and future protected role additions.
- Preserve application data. Only demo/test accounts are candidates for reset under Stage 6.
- Do not change production schema, delete accounts, activate the production auth domain, or switch the login flow until all preceding stages and rollback gates pass.
- Existing Cloudflare GitHub Actions secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are already configured. Never ask for their values in chat.

## Approved seven-stage roadmap and current status

| Stage | Scope | Current status |
|---|---|---|
| 1 | Cloudflare foundation | **Dedicated remote D1 (17/17 tables), Worker deployment, and `auth.sykabelajar.my.id` Custom Domain are verified.** Manual deployment [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) and hosted issuer/JWKS smoke tests succeeded. The branch preview is now built successfully at [security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). Remaining: redeploy the Worker with the exact temporary preview Origin and pass live CORS smoke test; then configure/test real ZeptoMail delivery and real session/email callbacks. Google OAuth remains optional/unconfigured. No staging user/session was seeded. See [staging deployment runbook](AUTH-CLOUDFLARE-STAGING-WORKER-DEPLOY-RUNBOOK.md). |
| 2 | OIDC and JWT | **Protocol implementation and staging issuer smoke tests pass; Supabase hosted acceptance remains blocked.** Staging deploy [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) verified exact discovery issuer, endpoint hostnames, PKCE S256 advertisement, and a public ES256 P-256 JWKS key. Local negative tests cover issuer, audience, expiry, signature and code replay; JWT contract is UUID `sub`, PostgreSQL `role=authenticated`, five-minute access token and no refresh token. Only production project is visible through the connected Supabase account; do not register staging OIDC in production. An isolated Free project is still required for acceptance. See [Stage 2 hosted OIDC acceptance runbook](AUTH-STAGE-2-OIDC-ACCEPTANCE-RUNBOOK.md). |
| 3 | Supabase identity foundation | **Opt-in Worker provisioning hooks and PostgREST wrapper contract now have local test coverage; hosted identity migration remains not started.** `private.app_users` is still absent in production; 69 application FKs still target `auth.users`, 3 triggers remain on `auth.users`, 109 policies use `auth.uid()`, and `auth.users` count remains 11 (count only). Worker `user.create.after`, fail-closed `session.create.before`, and `afterEmailVerification` hooks are implemented behind `SUPABASE_PROVISIONING_ENABLED` (default off) with server-only service-role configuration. Public PostgREST wrapper SQL is draft-only; synthetic local fixture and wrapper tests pass 83/83 pgTAP assertions. Full schema-only baseline, isolated hosted Supabase, production identity/FK migration, trusted organizer phone-verification projection and hosted OIDC/IDOR acceptance remain blockers. No production schema/data/Auth change has been applied. See [identity migration design](AUTH-IDENTITY-MIGRATION-DESIGN.md), [RPC wrapper draft](AUTH-STAGE-3-POSTGREST-RPC-WRAPPERS.sql) and schema-baseline runbook. |
| 4 | Frontend | **Read-only dependency inventory and CI baseline completed; implementation not started.** There are 41 direct `supabase.auth` callsites across 22 frontend files, now locked by a static contract test so the inventory must be deliberately updated as Stage 4 migration proceeds. Core session lifecycle, profile/role hydration, guest mode, idle logout, organizer OTP phone verification, password change, Cloudinary token handoff and admin diagnostics are mapped. No frontend auth source has been switched. See [AUTH-FRONTEND-MIGRATION-INVENTORY.md](AUTH-FRONTEND-MIGRATION-INVENTORY.md). |
| 5 | Backend | **Verified JWT adapter, opt-in provisioning Worker hooks and Cloudinary ownership guards are locally tested; endpoint cutover has not started.** Pinned `@supabase/server@1.9.2` verifies Custom OIDC user context; Worker provisioning calls the planned server-only PostgREST RPC wrappers only when its flag/secret are configured. The complete live audit identified nine user-facing Edge Function implementations tied to Supabase Auth/ownership checks (six Cloudinary, three payment) plus the Midtrans delegate. The live `cloudinary-delete-asset` v9 has a caller-ownership gap; a replacement source now checks the verified legacy caller UUID and restricts delete paths, but is not deployed. Four endpoints still call `supabase.auth.getUser()`; four others call `/auth/v1/user`. Ten auth-dependent SQL functions/triggers and all RLS policies remain unchanged. No production Edge Function/config/secret deployment occurred. Hosted Custom OIDC and two-user IDOR validation remain blocked. See [Edge Function migration matrix](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md) and [Stage 3 wrapper draft](AUTH-STAGE-3-POSTGREST-RPC-WRAPPERS.sql). |
| 6 | Demo reset and full testing | **Not started.** No demo-account reset or admin bootstrap has occurred. Requires a reproducible local Supabase schema baseline and, when a Free project slot is available, hosted OIDC/RLS validation; also requires the two-user IDOR matrix, full feature regression tests, and rollback rehearsal. |
| 7 | Production cutover | **Not started.** No production Worker/domain/OIDC configuration, Supabase Auth signup shutdown, traffic switch, or production monitoring changes have occurred. |

## Stage 1 — Cloudflare foundation

### Implemented and locally verified

- [x] Isolated Worker package under services/auth-worker.
- [x] Better Auth configured with native D1 binding and UUID identity generation.
- [x] Secure host-only session cookies, Origin/CSRF checks, exact-origin CORS, and disabled session cookie cache.
- [x] Email verification and password reset support ZeptoMail Agent-specific Send Mail Tokens, AES-256-GCM encryption at rest, active Agent switching without redeployment, and an isolated local webhook fallback. Contract tests cover encryption/tamper rejection, payload construction, Agent authorization, safe errors and fallback behavior.
- [x] Google provider code configured to require verified email; credentials are external environment secrets.
- [x] Implicit Google/password account linking disabled.
- [x] Database-backed rate-limit configuration.
- [x] Versioned Better Auth/OAuth Provider D1 migrations and fixed first-party public OAuth client with exact callback and mandatory PKCE.
- [x] Better Auth dependencies pinned to the coordinated 1.7.16 security release.
- [x] Generated D1 schema reviewed: 13 expected tables, 31 DDL statements and 18 indexes; SQLite replay and foreign-key check passed.
- [x] Local email verification, password reset, login, session lookup, logout, cookie attributes, CORS, rate-limit, and OAuth bootstrap checks.
- [x] Local Worker deployment dry-run in Auth Worker CI.
- [x] Add safe HTTP 503 handling for Cloudflare's documented D1 daily read/write Free-quota errors, including stable error codes and `Retry-After`; no automatic switch to a different auth issuer.

### Still required before Stage 1 is complete

- [x] Create the dedicated non-production Cloudflare D1 database `sykabelajar-auth-poc` (UUID `7a4f9008-a1c6-42b6-8a04-abde12699248`, APAC) and bind it in `wrangler.toml`.
- [x] Apply the four reviewed schema migrations to remote staging D1 using the manual-only guarded workflow. Run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470) succeeded and verified all 17 expected Better Auth/OAuth/ZeptoMail tables.
- [x] Create the dedicated staging Worker script; latest read-only preflight sees `sykabelajar-auth-poc`.
- [x] Deploy the isolated staging Worker and attach `auth.sykabelajar.my.id` using the guarded manual workflow. Run [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) verified `/healthz`, D1 connectivity, exact discovery issuer, endpoint hostnames, PKCE S256 and public ES256 JWKS. No user/session was seeded.
- [ ] Enter a ZeptoMail Agent Send Mail Token through the secured Admin UI and verify real email delivery only to the signed-in admin. Do not trigger a credit purchase or enable auto top-up.
- [ ] Configure a test Google OAuth client and verify verified-email behavior end to end if Google sign-in is required for launch.
- [ ] Redeploy staging Worker after the exact preview Origin allowlist change and pass the hosted CORS allow/deny smoke test. The current live Worker predates this change; do not use the branch preview panel to save settings until this passes.
- [ ] Verify staging session/cookie/email/provider callbacks. Do not point the production app or frontend at this issuer.

## Stage 2 — OIDC and JWT

### Implemented and locally verified

- [x] OAuth Provider with Authorization Code + PKCE S256.
- [x] PKCE negative tests: missing challenge, wrong verifier and authorization-code replay are rejected.
- [x] ES256 access-token and ID-token signatures, JWKS and key ID.
- [x] OIDC discovery metadata and JWKS endpoint.
- [x] Authorization responses carry the exact issuer (`iss`) to prevent authorization-server mix-up (RFC 9207); integration test checks it.
- [x] JWT subject is a Better Auth UUID; resource audience is the app URL; role is authenticated; access-token lifetime is five minutes.
- [x] Wrong issuer, wrong audience, expired token, modified signature and post-logout UserInfo rejection tests.
- [x] offline_access and refresh-token issuance are disabled.

### Still required before Stage 2 is complete

- [x] Deploy the issuer on the non-production Cloudflare Worker and verify its exact issuer URL, discovery metadata, PKCE S256 and public ES256 JWKS in hosted smoke test [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080).
- [ ] Register Supabase Custom OIDC only in an isolated Free-plan Supabase project. Never register the test issuer in production.
- [ ] Prove Supabase accepts valid ES256 tokens and rejects wrong issuer, wrong audience, wrong signature, expired token and altered sub. This hosted acceptance test remains blocked until a Free project slot is available; the current account-level create request was rejected at the two-active-Free-project limit.
- [ ] Verify auth.uid() resolves the Better Auth UUID correctly in policies and RPCs.
- [ ] Verify Data API, Storage, Realtime and Edge Functions with the external JWT.
- [ ] Add a two-user RLS/IDOR test using two different Better Auth UUID subjects.

## Stage 3 — Supabase identity foundation

- [x] Complete read-only inventory: 69 application FKs across 62 tables (42 CASCADE, 18 SET NULL, 8 NO ACTION, 1 RESTRICT), 10 SECURITY DEFINER functions depending on auth.users/metadata/verification, 3 auth.users triggers, 4 Edge Functions calling auth.getUser(), and 109 RLS policies using auth.uid(). See [AUTH-IDENTITY-DEPENDENCY-INVENTORY.md](AUTH-IDENTITY-DEPENDENCY-INVENTORY.md).
- [x] Capture the exact 69 FK names, source columns and delete actions in [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md); verify all are single-column UUID / MATCH SIMPLE / validated / non-deferrable / ON UPDATE NO ACTION, and all 18 SET NULL columns are nullable.
- [x] Validate a synthetic FK-rehome mechanism in local Supabase CI: backfill matching UUIDs, preserve MATCH/ON UPDATE/ON DELETE/deferrability/validation metadata, and verify CASCADE, SET NULL, NO ACTION and RESTRICT behavior.
- [x] Validate a synthetic server-only provisioning and referral lifecycle contract: basic-role mapping, admin rejection, idempotent retry without profile overwrite or role reactivation, no shadow `auth.users` row, trusted email verification, 24-hour referral eligibility and single-credit Edu Coin ledger behavior.
- [x] Combined local Supabase run [#41777930023](https://github.com/taufx98/sykabelajar4.0/actions/runs/41777930023) passed **73/73 pgTAP assertions across three test files** (8 JWT/RLS + 12 FK rehome + 53 provisioning/referral), including business-role preservation and PostgreSQL `authenticated` claim semantics.
- [x] Draft the Stage 3 architecture and migration design, including the minimal identity projection, trusted provisioning, referral lifecycle, phone-verification blocker, FK rehome sequence, and issuer/RLS requirements. See [AUTH-IDENTITY-MIGRATION-DESIGN.md](AUTH-IDENTITY-MIGRATION-DESIGN.md).
- [x] Add a pinned CLI 3.0.0 schema-only export helper and runbook, with a static CI contract forbidding data/role dumps and restore/deploy commands. See [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md).
- [x] Re-query the live production PostgreSQL catalog read-only and commit a metadata-only snapshot of all 69 `auth.users` foreign keys, with exact `ON DELETE`/update/validation metadata and no user rows.
- [x] Re-compare the committed snapshot with the live catalog on 5 November 2026: 69/69 constraints matched exactly, with zero additions, removals, or semantic drift.
- [x] Add a review-only generator that validates the 69-FK snapshot and emits separate preflight/expand, validate, and cutover SQL files outside the repository. It checks live catalog drift, identity-root coverage and orphan references; it never connects to a database or executes SQL. See [live-auth-users-fk-catalog.json](../../scripts/auth-migration/live-auth-users-fk-catalog.json) and [generate-app-users-fk-plan.mjs](../../scripts/auth-migration/generate-app-users-fk-plan.mjs).
- [x] Obtain CI validation for the current branch's FK generator, role-preservation assertions and JWT-role contract; the latest local Supabase run passed all 71 assertions. Review generated SQL before treating it as an implementation artifact.
- [x] Confirm the new-account-only decision: do not migrate demo-account credentials/sessions or build a legacy password bridge; new users receive fresh Better Auth UUIDs. See [AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md](AUTH-NEW-ACCOUNT-AND-ROLE-CONTRACT.md).
- [ ] Run the schema-only export locally from the owner's trusted machine and review `schema.sql`, custom Auth/Storage DDL, extension versions, and dependency gaps. Keep artifacts outside Git and share only reviewed schema metadata as appropriate.
- [ ] Design the executable production FK migration against a reviewed complete schema baseline; the fixture test and design document do not authorize or replace that migration.
- [x] Implement the opt-in Better Auth Worker provisioning hooks: `user.create.after` attempts idempotent identity projection, `session.create.before` retries and fails closed, and `afterEmailVerification` reconciles trusted email verification/referrals. The provisioning flag defaults off, and no service-role secret is configured. Twelve Worker provisioning tests cover opt-in behavior, pre-insert field normalization/rejection, unverified signup, teacher/organizer type mapping, admin rejection, invalid inputs, verified-provider projection, retry, secret/URL handling and safe error mapping. The separate PostgREST wrapper contract is still draft; it has not been applied to hosted Supabase. The synthetic SQL fixture now tests those wrappers, but hosted OIDC and real app-schema migration remain blockers.
- [ ] Create private.app_users as the canonical application identity anchor, keyed by the Better Auth UUID.
- [ ] Inventory and migrate all application foreign keys currently referencing auth.users. Preserve application rows and relationships; do not bulk-delete application data.
- [ ] Move profile/user-role/settings provisioning out of the Supabase Auth trigger into an authenticated, idempotent trusted provisioning operation.
- [ ] Keep sign-up pending until both Better Auth account creation and Supabase application provisioning succeed.
- [ ] Redesign referral attribution and email-verification lifecycle without querying auth.users; preserve the 24-hour referral qualification and idempotent Edu Coin reward logic.
- [ ] Define a trusted phone-verification projection before migrating create_organizer, which currently requires both email and phone confirmation.
- [ ] Keep referral RPC contract compatible while removing its auth.users dependency; the active ReferralProgramPanel caller does not consume last_login_at, so a temporary NULL field may be sufficient without adding login-sync writes.
- [ ] Apply issuer restrictions to authenticated RLS policies and sensitive SECURITY DEFINER functions.
- [x] Re-read the live production role catalog: `public.app_role` currently contains `student`, `teacher`, `organizer_member`, and `admin`; `public.user_roles` remains the business-role authority.
- [ ] Preserve the existing role enum/table, role grants, RLS and admin guards in the identity-root migration. Public signup may create only student, teacher, or organizer_member; admin remains protected and must be bootstrapped in Stage 6.
- [ ] Keep business roles in existing application tables and preserve current role semantics.
- [ ] Verify all constraints and provisioning rollback/retry behavior against the reproducible local Supabase test baseline and, when available, a separate Free-plan project before any production migration.

## Stage 4 — Frontend

- [ ] Add Better Auth client and a first-party OAuth Authorization Code + PKCE client.
- [ ] Implement a single cached/single-flight Supabase access-token callback with refresh before the five-minute expiry.
- [ ] Integrate the callback into the existing singleton Supabase client without removing RPC circuit breaker, cache, Realtime health or other client safeguards.
- [ ] Replace every direct supabase.auth use with Better Auth session operations or the new token service.
- [ ] Preserve AppContext bootstrap/hydration, route guards, global session persistence and one-login navigation across the application.
- [ ] Preserve login/register UI and existing page designs; no broad UI redesign.
- [ ] Verify route changes do not prompt for login again, including page reload and expired-token renewal.
- [ ] Ensure Realtime receives updated tokens and behaves correctly after session renewal/logout.
- [ ] Handle temporary Better Auth/D1 quota 503 and Cloudflare Worker Error 1027 without clearing the user's active application state; show a recovery message and retry after the advertised reset/availability check.

## Stage 5 — Backend

- [ ] Update Edge Functions that call supabase.auth.getUser() or assume a user exists in auth.users.
- [ ] Update SQL functions/triggers/RPCs that query auth.users, raw_user_meta_data or email_confirmed_at.
- [ ] Continue using auth.uid() where its UUID-subject behavior is compatible and verified.
- [ ] Preserve business-role authorization from application tables; never place admin/teacher/organizer business roles in the PostgreSQL JWT role claim.
- [ ] Keep service-role credentials server-side only and use RLS-scoped clients for user data.
- [ ] Verify email verification, sign-up, referrals, participant sessions, payment webhooks, storage, realtime and admin actions under the new issuer.
- [ ] Review SECURITY DEFINER functions for owner/role/issuer/token checks; do not revoke grants indiscriminately.

## Stage 6 — Demo reset and full testing

- [ ] Confirm the exact demo/test identities and dependent test rows eligible for cleanup. Old login credentials are not migrated; clean only the approved demo identities and their dependent test rows. Preserve competitions, shop/payment configuration, application content and other production business data unless separately approved.
- [ ] Clean up only the approved demo accounts and dependent rows.
- [ ] Create the first admin through a protected, auditable bootstrap path. Never permit public registration to grant admin.
- [ ] Do not use production as a staging substitute. If hosted Free OIDC validation is still unavailable, keep cutover blocked.
- [ ] Run login, registration, email verification, Google login, session restore, token renewal and logout tests.
- [ ] Run two-user IDOR tests for profiles, exams/attempts, Edu Coin, Shop/orders, chat, referrals, certificates, organizer and admin boundaries.
- [ ] Run regression/smoke tests for all critical existing features and role types.
- [ ] Verify RLS, RPCs, Storage, Realtime and Edge Functions with the Better Auth issuer.
- [ ] Rehearse rollback to the existing login path before production cutover.

## Stage 7 — Production

- [ ] Deploy the reviewed Worker and dedicated D1 through GitHub Actions.
- [ ] Activate auth.sykabelajar.my.id and validate TLS, CORS, cookies, email delivery, Google callback, discovery and JWKS.
- [ ] Configure production Supabase Custom OIDC only after staging acceptance.
- [ ] Enable Better Auth as the primary account/session authority in a controlled cutover.
- [ ] Disable public Supabase Auth sign-up and unused Supabase Auth providers after the cutover is verified.
- [ ] Monitor Worker errors, D1 latency/storage, token verification failures, Supabase usage and login/session metrics.
- [ ] Keep the rollback path ready and document the exact trigger conditions.

## Security prerequisites found during preparation

These are directly related prerequisites, not a replacement roadmap:

- PR #174: hardens private-profile connections and social-summary SECURITY DEFINER RPC boundaries. It has passed repository CI but remains draft and requires isolated PostgreSQL validation.
- PR #179: protects backend-managed profile columns and server-side display-name cooldown. Its regression contract was corrected to inspect JWT role/admin semantics; GitHub Actions run [41770895565](https://github.com/taufx98/sykabelajar4.0/actions/runs/41770895565) completed successfully. The PR remains draft and still requires isolated PostgreSQL integration tests.
- Production audit previously found 69 application foreign keys to auth.users, 109 RLS policies using auth.uid(), 188 SQL functions using auth.uid(), and 10 functions/triggers that read auth.users or its metadata. These must be individually mapped in Stages 3 and 5.
- private.organizer_access_codes has RLS disabled in production. Do not simply enable RLS without first designing and testing its intended access policies and reviewing every privileged function that reads it.

## Free-only staging policy

- **No paid staging resources.** Do not create Supabase paid branches, enable paid compute/add-ons, upgrade Cloudflare, or accept a nonzero recurring infrastructure quote for this migration. If a step has a nonzero cost or exceeds a free quota, stop and use a local alternative or report the blocker.
- The previous Supabase Branch quote of USD $0.01344/hour is rejected; no branch was created.
- The connected Supabase organization is on the Free plan. The production project `sykabelajar_db2` is healthy. A separate project quote returned US$0/month, but the create request was rejected because the account reached the two-active-Free-project limit. No project was created, no existing project was paused/deleted, and no plan was upgraded.
- Supabase Custom OIDC cannot be configured through the Supabase CLI. Hosted issuer acceptance, including Data API/Storage/Realtime/Edge Function validation, therefore remains blocked until the owner frees an existing Free-project slot or another explicitly free isolated project becomes available. Never substitute the production project for this test.
- Use Supabase CLI 3.0.0 + Docker locally for database work. The isolated JWT/RLS fixture and its GitHub Actions workflow have passed [run #41772998109](https://github.com/taufx98/sykabelajar4.0/actions/runs/41772998109). This confirms only the tested synthetic Postgres claim/RLS semantics, not hosted Custom OIDC or full application schema. The local Supabase stack itself adds no hosted Supabase cost. However, the current `supabase/migrations` directory is a history of incremental feature changes, not a verified clean bootstrap: some early files share date prefixes and the first feature migrations assume existing application tables such as `organizers` and `auth.users`. Do not assume a blank `supabase db reset --local` can replay the complete production schema. Before Stage 3 integration tests, prepare and review a sanitized schema-only baseline or a purpose-built fixture containing the exact dependencies under test. Do not copy production rows or credentials into fixtures.
- Cloudflare's read-only preflight [#42043789820](https://github.com/taufx98/sykabelajar4.0/actions/runs/42043789820) confirms the zone and Workers Scripts Read permissions work, but D1 API access is missing (`10000 Authentication error`). Update the Cloudflare API token with Account D1: Edit before trying to create or bind the non-production database; do not expose or paste the token in chat. No Auth Worker/domain/D1 staging resource is present.
- The current Auth Worker CI uses Wrangler's local mode and local D1, with an explicit webhook mock so automated tests never consume ZeptoMail credits. Keep it that way until a remote Worker/D1 resource is verified to remain within Cloudflare's Free quota. ZeptoMail is pay-as-you-go: the current pricing page advertises one introductory 10,000-email credit valid for one month for eligible new accounts, then paid credits of 10,000 emails each valid six months. No credits are purchased or auto-top-up enabled by this implementation.
- GitHub Actions on this public repository can run the local checks without purchasing hosted Supabase compute. Keep workflows bounded and avoid deploying from pull-request checks.
- No production Supabase migration, account deletion, custom-domain activation, external OIDC registration, or login cutover has been performed.


## ZeptoMail admin configuration validation — 5 November 2026

- The Admin core **Pengaturan** tab now contains **Email Transaksional · ZeptoMail** at `/admin/core?tab=settings`.
- Multiple Agent profiles can be saved, token-rotated, tested, activated, or removed (inactive profiles only). Changing the selected Agent takes effect for subsequent Better Auth verification and password-reset emails without a Worker redeploy.
- Send Mail Tokens are encrypted at rest in D1 with AES-256-GCM under a stable Worker secret. API GET responses expose sender metadata and a boolean tokenConfigured flag only.
- The admin API validates the current Supabase Auth session and the server-side `is_active_admin()` RPC. This is an intentional Stage 1 compatibility bridge; during Stage 4, its authentication verifier must be moved to the Better Auth OIDC/session model while preserving the role check.
- The test action only sends to the currently signed-in admin's own verified address and is limited to one test per minute per admin.
- [Auth Worker + Admin Frontend CI #42035044756](https://github.com/taufx98/sykabelajar4.0/actions/runs/42035044756) passed Worker audit/typecheck/tests, migration 0003, local auth/OAuth integration, Worker dry-run, frontend lint/typecheck/build. It did not send real email or deploy anything.


## Live audit and rollback checkpoint — 5 November 2026

The exact 69 application foreign-key catalog was compared against production again with **69/69 exact matches** (no additions, removals or semantic drift). The read-only inventory also confirms no `private.app_users`, 10 `auth.users` rows, 3 triggers and 109 `auth.uid()` policies. Ten application functions directly depend on the Supabase Auth user/metadata/email/phone-verification model.

Security Advisor currently reports 46 public-callable and 202 authenticated-callable `SECURITY DEFINER` functions, 23 RLS-enabled tables without policies, and leaked-password protection disabled. These are per-function/policy review gates, not a blanket grant-revocation instruction.

See [AUTH-STAGES-STATUS-AND-ROLLBACK.md](AUTH-STAGES-STATUS-AND-ROLLBACK.md) for the Cloudflare permission failure, Supabase Free project limit, exact staging prerequisites, and rollback rules. In particular, Supabase Auth cannot currently be disabled as a service; Stage 7 can disable public signup only. Better Auth-only accounts cannot automatically fall back to Supabase Auth because legacy password hashes are intentionally not imported.


## Latest environment update — 5 November 2026

- Cloudflare D1 staging is provisioned: database sykabelajar-auth-poc, UUID 7a4f9008-a1c6-42b6-8a04-abde12699248, APAC location hint, read replication disabled. This is a dedicated empty authentication database. No Worker deployment, custom domain, route, DNS, secret, or production change has occurred.
- Worker/frontend CI #42057926474 passed after the branch D1 binding update. Remote staging D1 migrations were subsequently applied and verified in manual run [#42159049470](https://github.com/taufx98/sykabelajar4.0/actions/runs/42159049470).
- Supabase Free staging remains blocked. The connected organization listing shows the Free organization sykabelajar; the project listing returns sykabelajar_db2. A fresh project quote was US$0/month, but Supabase rejected creation because the owner has reached the two-active-Free-project limit. Do not pause/delete/upgrade sykabelajar_db2. Locate the other counted active project in the Dashboard before taking action.
- The schema-only export is still pending on the owner's trusted local machine. It is independent of the Supabase staging-project slot and can proceed using AUTH-SCHEMA-BASELINE-RUNBOOK.md.


## Current checkpoint — 6 November 2026

- Cloudflare D1 account access is verified and the empty Better Auth staging database has been created and bound in the branch; no Worker deployment or custom auth domain is active. See the 6 November Cloudflare recheck in [AUTH-STAGES-STATUS-AND-ROLLBACK.md](AUTH-STAGES-STATUS-AND-ROLLBACK.md).
- Supabase Free staging is still blocked by the account-wide two-active-project limit. The connected tool can see one Free organization and `sykabelajar_db2`, but the project that consumes the other quota slot is not visible. A new project quote is US$0/month; the creation attempt was rejected. No existing project was paused/deleted/upgraded. The owner must inspect all Owner/Admin organizations from the Dashboard to find the other active project; never pause production.
- The schema-only exporter has an additional preflight ensuring the direct DB host or session-pooler username matches `SUPABASE_PROJECT_REF`, so the dump and managed-schema diff cannot silently target different projects. The full exporter safety contract, FK-plan generator and 73/73 synthetic local Supabase assertions passed in [Supabase Local Auth Claims CI #42132183039](https://github.com/taufx98/sykabelajar4.0/actions/runs/42132183039). The actual production schema-only export is pending on the owner's machine.


## Verified checkpoint — 6 November 2026 (supersedes earlier pending-deploy notes above)

- Staging Worker deployment [#42190609080](https://github.com/taufx98/sykabelajar4.0/actions/runs/42190609080) is completed/success. All deployment job steps passed; the live smoke test confirmed `/healthz`, D1 binding, issuer `https://auth.sykabelajar.my.id/api/auth`, OIDC discovery, PKCE S256 and a public ES256 P-256 JWKS key. Cloudflare deployed Worker version `bd1feee3-4142-412e-9d05-e8eaa97de971`. The D1 had no user/session/account records at deployment verification.
- Stage 1 is **partially complete**: real ZeptoMail Agent token/delivery is not configured; Google OAuth credentials are not configured; interactive end-to-end login/email callback has not been proven. The deploy workflow generated the missing Worker secrets and reported no pre-existing required secrets to preserve; do not infer that email provider credentials exist.
- Stage 2 is **partially complete**: staging issuer protocol and public keys are hosted and verified, but Supabase Custom OIDC acceptance, token validation through Data API/Storage/Realtime/Edge Functions, and two-user IDOR remain untested. The connected Supabase project listing currently exposes only production project `mvdczyitbkxkldjughor`; do not use it as staging and do not register the staging issuer there.
- Stage 3 production catalog was rechecked using read-only SQL on 6 November: `private.app_users` absent; 69 application foreign keys reference `auth.users(id)`; 3 non-internal triggers are attached to `auth.users`; 109 policies reference `auth.uid()`; `auth.users` row count is 11. Eight public/private functions directly reference the `auth.users` relation in their definitions. No user identities or rows were exported, and no production mutation was performed. The schema-only baseline export remains pending on the owner's trusted machine.
- Stages 4–7 remain not started. Do not bypass the missing schema baseline or hosted OIDC acceptance. Keep PR #177 Draft and unmerged; no production auth/schema/account changes are authorized by this checkpoint.


- Stage 3 exact FK catalog comparison — 6 November 2026: fresh read-only production catalog matched the committed 69-entry snapshot exactly, with zero metadata drift.


## Latest validation checkpoint — 6 November 2026 (after staging-preview hardening)

- Worker/Frontend CI [#42195372638](https://github.com/taufx98/sykabelajar4.0/actions/runs/42195372638) passed. The Worker job completed dependency audit, TypeScript, all 40 unit/security contract tests, local D1 migrations, local email/session/OAuth integration and Worker dry-run bundle. The separate frontend job passed lint, typecheck and production build.
- Read-only Cloudflare preflight [#42195372541](https://github.com/taufx98/sykabelajar4.0/actions/runs/42195372541) passed by checking the active zone, dedicated D1 and the public hosted issuer directly. It verified `https://auth.sykabelajar.my.id/api/auth`, PKCE S256 and public ES256 P-256 JWKS. Cloudflare API list calls for Worker Scripts, Custom Domains and Routes still return HTTP 503 to this token; these are recorded as inventory limitations, not proof that the already-hosted Worker is absent.
- A deliberately narrow CORS origin was added to staging only: `https://security-auth-poc-stage-1.sykabelajar4.pages.dev`. The deploy workflow now tests that exact preview origin is allowed and an unrelated origin is denied. Worker tests passed, but **the live Worker has not yet been redeployed with this new allowlist**, so the preview-origin check is pending the next guarded manual deployment. Routine redeployment no longer enumerates or rotates existing Worker secrets.
- Cloudflare Pages branch preview deployment failed for commit `0344a20077c5feb6bfc42a60633cc0a6cd74c689`; its check output exposes only “Deploy failed” and a dashboard log link, not the underlying build error through the available repository interface. The last recorded Pages preview success was earlier on commit `064225dd07fbce066f848fec63676cf60fe91a84`. Therefore do not claim the new preview panel is currently deployed or usable until Pages reports a successful build.
- Stage 1 remains partially complete: ZeptoMail Agent token and real delivery have not been configured/tested; panel access from the latest preview awaits a successful Pages build and the guarded Worker redeployment. Google OAuth remains optional/unconfigured.
- Stages 2–3 remain blocked on an isolated hosted Supabase Free project and owner-local schema-only export. Stages 4–7 remain unstarted. Production Supabase/Auth/data, demo accounts and main login remain untouched. PR #177 remains Draft and unmerged.



## Latest Cloudflare Pages preview recovery — 6 November 2026

Cloudflare Pages has now successfully built the latest migration branch commit `bc8915cd3eb9f68c68ea8da20257b8feaeec2e3e`. The current branch preview is available at [https://security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev); the transactional email settings panel is under `/admin/core?tab=settings`.

This clears the Pages build blocker recorded in the preceding checkpoint. The preview uses the exact hostname already allowlisted in the staging Worker configuration, but that allowlist has not yet been deployed to the live Worker. The preview panel must not be considered connected until the guarded Worker deployment succeeds and the hosted CORS smoke test confirms the exact preview origin. Real ZeptoMail setup/delivery still requires the owner's Agent token and an authenticated active admin session.


## Full table/RLS and organizer access-code check — 6 November 2026

Read-only verbose table metadata reports 125 application tables: 120 in `public`, five in `private`. RLS is enabled on 124; the sole RLS-disabled table is `private.organizer_access_codes`. A separate privilege query found no `USAGE` or `CREATE` privilege on the `private` schema for `anon` or `authenticated`, and no direct SELECT/INSERT grant on the access-code table. Four `SECURITY DEFINER` functions access it: `admin_create_organizer`, `create_organizer`, `join_organizer`, and `rotate_organizer_access_code`. All four deny execution to `anon`, are executable by `authenticated`, and have operation-specific admin/organizer/caller checks. Three pin `search_path` to `public,private`; the rotation function pins it to empty. No RLS or grant change was made. Stage 5 must review these function guards with the Better Auth UUID identity, preserving access-code hash-only storage and the current organizer role/business checks. The `create_organizer` phone/email-verification dependency remains a blocker; do not weaken it as a shortcut.


## Stage 5 security review prerequisite — 6 November 2026

The 46 anon-callable SECURITY DEFINER RPCs have a first-pass caller/guard classification in [AUTH-ANON-SECURITY-DEFINER-RPC-REVIEW.md](AUTH-ANON-SECURITY-DEFINER-RPC-REVIEW.md). Preserve intentionally public read endpoints and guest exam/portal endpoints authenticated by separate hashed bearer tokens. Tighten admin-only or signed-in-only anonymous ACLs only after verifying every caller and running the isolated negative tests. PR #174 addresses the confirmed private-profile RPC issue but remains Draft and requires isolated PostgreSQL validation. Public `participant_code` exposure in published competition results is a data-minimisation review item; no behavior has been changed. The 23 RLS-enabled/no-policy tables also require per-table intended-access review; no blanket RLS or grant changes are authorized.



## Latest CI verification — 6 November 2026 (Stage 4 inventory + typed Stage 5 scaffold)

The Auth Worker CI [#42214172430](https://github.com/taufx98/sykabelajar4.0/actions/runs/42214172430) completed successfully on commit `ff37cc91c948fed323627a7fffd5252d27cc1ee1`: Worker dependency audit, TypeScript, 40 Worker tests, local D1/auth/OAuth integration, dry-run bundle, and frontend lint/typecheck/build all passed.

The Supabase Local Auth Claims CI [#42214172513](https://github.com/taufx98/sykabelajar4.0/actions/runs/42214172513) also completed successfully: all 12 JWT/Edge/webhook contract tests, Deno type-check of the shared `@supabase/server@1.9.2` adapter, schema-exporter/FK-plan contract checks, and 73/73 isolated local pgTAP assertions passed.

The frontend auth inventory is committed at [AUTH-FRONTEND-MIGRATION-INVENTORY.md](AUTH-FRONTEND-MIGRATION-INVENTORY.md): 41 direct `supabase.auth` callsites across 22 frontend files were surfaced. This is documentation/planning only; the React app remains on Supabase Auth. The shared Edge adapter is type-checked but still not wired into any existing endpoint.

The latest Pages preview is green at [security-auth-poc-stage-1.sykabelajar4.pages.dev](https://security-auth-poc-stage-1.sykabelajar4.pages.dev). The actual staging Worker still predates the exact preview-Origin CORS allowlist; a new manual-only deployment is required before the browser-based ZeptoMail panel can connect. Real ZeptoMail Agent token/delivery and interactive session/email callbacks remain unverified.


## Latest verified checkpoint — 6 November 2026 (Cloudinary ownership hardening + opt-in provisioning)

## Latest verified checkpoint — 6 November 2026 (Cloudinary ownership hardening + opt-in provisioning)

Auth Worker + frontend CI [#42247015051](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247015051) completed **success** on `4c00fa315d0e8329d054b4d2d12feeea225ab4b2`. It passed the Worker TypeScript/build checks, 56 Worker unit tests, 12 Better Auth JWT claim tests, 15 Cloudinary ownership/source-contract tests, two frontend auth-inventory checks, the clean local D1 migration chain (0000–0004), fixed OAuth client seed validation, sign-up/email-verification/session/PKCE/ES256 integration, Worker dry-run, and frontend lint/typecheck/build.

Supabase Local Auth Claims CI [#42247014985](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247014985) completed **success** on the same commit. Deno type-check passed for the shared Better Auth verified-context adapter, `get-cloudinary-signature`, and the branch replacement for `cloudinary-delete-asset`. The isolated Supabase fixture passed **83/83 pgTAP assertions**.

The registration integration now deliberately submits `accountType=admin` first and expects HTTP 400 with no verification email, then retries with a valid teacher account and verifies that `accountType`, `username`, and `referralCode` survive the Better Auth session. This proves the pre-insert validator rejects unsupported business roles before a D1 row is created.

The complete 15-function production Edge Function inventory is recorded in [AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md](AUTH-EDGE-FUNCTION-MIGRATION-MATRIX.md). A branch-only replacement for the live `cloudinary-delete-asset` ownership gap now resolves the verified legacy caller UUID and restricts deletes to the exact UUID-owned avatar/cover asset IDs. The new and legacy Cloudinary ownership tests pass. **No Edge Function has been deployed**; production Cloudinary delete v9 remains unchanged until an isolated A/B hosted test and a controlled deployment review pass.

The newest code is still branch-only. This CI did not apply migration 0004 to remote D1, redeploy the live Worker, configure ZeptoMail, register Supabase Custom OIDC, or modify production Supabase. PR #177 remains Draft and unmerged.


## Latest CI checkpoint — 6 November 2026 (Cloudinary delete hardening + registration validation)

## Latest CI checkpoint — 6 November 2026 (Cloudinary delete hardening + registration validation)

The latest source-code commit tested was `6e1fcc0b3f4a1db80a6425ead63522e6a611d211`:
- [Auth Worker + frontend CI #42247915763](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247915763) — success. Worker checks passed: 56 unit/security tests; 12 OIDC/JWT claim tests; 15 Cloudinary ownership/delete source tests; two frontend inventory tests; local D1 migrations 0000–0004; seeded OAuth client checks; sign-up/email-verification/session/PKCE/ES256 integration; Worker dry-run; frontend lint, typecheck and production build.
- [Supabase Local Auth Claims CI #42247915859](https://github.com/taufx98/sykabelajar4.0/actions/runs/42247915859) — success. Deno type-check passed for the Better Auth verified-context adapter, `get-cloudinary-signature`, and the branch `cloudinary-delete-asset` replacement. Local synthetic Supabase fixture passed 83/83 pgTAP assertions.

This is still branch/local CI evidence. It does not mean that remote Cloudflare D1 migration 0004 has been applied, the Worker redeployed with the preview CORS origin, ZeptoMail configured, any production Edge Function deployed, Supabase Custom OIDC accepted, or a production identity/FK/RLS migration executed. PR #177 remains Draft and unmerged.
