# SYKABELAJAR Better Auth Migration Roadmap

This is the approved implementation order. Keep all work within these seven stages. A security finding may be handled as a prerequisite when it directly affects identity, privacy, RLS, or authorization; it must not become a reason to redesign unrelated application features.

## Architecture decisions

- Better Auth is the only account and session authority after cutover.
- Cloudflare D1 stores authentication-only records: users, accounts, sessions, verification, OAuth grants, JWKS, and auth rate-limit state.
- Supabase PostgreSQL remains the application database and authorization authority for profiles, business roles, competitions, exams, Shop, Edu Coin, chat, orders, certificates, and application data.
- Better Auth user IDs are UUIDs. JWT sub must be that UUID.
- The JWT role claim is the Postgres role authenticated, never a SYKABELAJAR business role.
- Business roles continue to be loaded from Supabase application tables.
- Preserve application data. Only demo/test accounts are candidates for reset under Stage 6.
- Do not change production schema, delete accounts, activate the production auth domain, or switch the login flow until all preceding stages and rollback gates pass.
- Existing Cloudflare GitHub Actions secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are already configured. Never ask for their values in chat.

## Approved seven-stage roadmap and current status

| Stage | Scope | Current status |
|---|---|---|
| 1 | Cloudflare foundation | **In progress.** Worker source and D1 schema/migrations are implemented and tested against disposable local D1 in CI. No remote D1 database or Worker deployment exists; custom domain and real email provider remain unconfigured. |
| 2 | OIDC and JWT | **Local proof-of-concept and PostgreSQL JWT/RLS contract tests pass; hosted Supabase acceptance remains blocked by the Free-project limit.** OAuth Provider, Authorization Code + PKCE S256, ES256 signing, discovery/JWKS and UUID/role/audience claims pass local tests. The combined local Supabase suite passes 68/68 pgTAP assertions, including `auth.uid()` UUID mapping and two-user ownership tests ([run #41776739736](https://github.com/taufx98/sykabelajar4.0/actions/runs/41776739736)). No Custom OIDC integration has been registered in production. |
| 3 | Supabase identity foundation | **Read-only inventory, design, synthetic contract tests, and a schema-only export helper are ready; production migration not started.** See [AUTH-IDENTITY-DEPENDENCY-INVENTORY.md](AUTH-IDENTITY-DEPENDENCY-INVENTORY.md), [AUTH-FOREIGN-KEY-CATALOG.md](AUTH-FOREIGN-KEY-CATALOG.md), [AUTH-IDENTITY-MIGRATION-DESIGN.md](AUTH-IDENTITY-MIGRATION-DESIGN.md), and [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md). Local Supabase CI passes 68/68 assertions across JWT/RLS, FK rehome, server-only provisioning, role mapping, retry safety, email verification, referral 24-hour eligibility, and Edu Coin idempotency ([run #41776739736](https://github.com/taufx98/sykabelajar4.0/actions/runs/41776739736)). These are synthetic fixtures, not the live application migration. No production `private.app_users`, FK transition, trigger/RPC replacement, or issuer restrictions have been applied. Trusted phone verification for organizer creation remains a blocker under the free-only constraint. |
| 4 | Frontend | **Not started.** The React app still uses Supabase Auth directly. Better Auth client, token broker, global session adapter, and replacement of every supabase.auth call remain to be implemented. |
| 5 | Backend | **Not started.** Edge Functions, auth.users-dependent RPC/functions/triggers, and authorization paths still use current Supabase Auth assumptions. |
| 6 | Demo reset and full testing | **Not started.** No demo-account reset or admin bootstrap has occurred. Requires a reproducible local Supabase schema baseline and, when a Free project slot is available, hosted OIDC/RLS validation; also requires the two-user IDOR matrix, full feature regression tests, and rollback rehearsal. |
| 7 | Production cutover | **Not started.** No production Worker/domain/OIDC configuration, Supabase Auth signup shutdown, traffic switch, or production monitoring changes have occurred. |

## Stage 1 — Cloudflare foundation

### Implemented and locally verified

- [x] Isolated Worker package under services/auth-worker.
- [x] Better Auth configured with native D1 binding and UUID identity generation.
- [x] Secure host-only session cookies, Origin/CSRF checks, exact-origin CORS, and disabled session cookie cache.
- [x] Email verification and password reset wired to an authenticated outbound email-webhook contract.
- [x] Google provider code configured to require verified email; credentials are external environment secrets.
- [x] Implicit Google/password account linking disabled.
- [x] Database-backed rate-limit configuration.
- [x] Versioned Better Auth/OAuth Provider D1 migrations and fixed first-party public OAuth client with exact callback and mandatory PKCE.
- [x] Better Auth dependencies pinned to the coordinated 1.7.16 security release.
- [x] Generated D1 schema reviewed: 13 expected tables, 31 DDL statements and 18 indexes; SQLite replay and foreign-key check passed.
- [x] Local email verification, password reset, login, session lookup, logout, cookie attributes, CORS, rate-limit, and OAuth bootstrap checks.
- [x] Local Worker deployment dry-run in Auth Worker CI.

### Still required before Stage 1 is complete

- [ ] Create the dedicated non-production Cloudflare D1 database and replace the placeholder database ID.
- [ ] Configure the actual Worker environment secrets in Cloudflare through the approved deployment workflow.
- [ ] Configure the production-grade outbound email provider/webhook and verify deliverability.
- [ ] Configure a test Google OAuth client and verify verified-email behavior end to end.
- [ ] Deploy the Worker to a non-production hostname and verify health, email, Google callback, session and cookie behavior.
- [ ] Configure auth.sykabelajar.my.id only after staging Worker checks pass; do not point the production app at it yet.

## Stage 2 — OIDC and JWT

### Implemented and locally verified

- [x] OAuth Provider with Authorization Code + PKCE S256.
- [x] PKCE negative tests: missing challenge, wrong verifier and authorization-code replay are rejected.
- [x] ES256 access-token and ID-token signatures, JWKS and key ID.
- [x] OIDC discovery metadata and JWKS endpoint.
- [x] JWT subject is a Better Auth UUID; resource audience is the app URL; role is authenticated; access-token lifetime is five minutes.
- [x] Wrong issuer, wrong audience, expired token, modified signature and post-logout UserInfo rejection tests.
- [x] offline_access and refresh-token issuance are disabled.

### Still required before Stage 2 is complete

- [ ] Deploy the issuer on a non-production Cloudflare Worker and verify its exact issuer URL.
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
- [x] Combined local Supabase run [#41776739736](https://github.com/taufx98/sykabelajar4.0/actions/runs/41776739736) passed **68/68 pgTAP assertions across three test files** (7 JWT/RLS + 12 FK rehome + 49 provisioning/referral).
- [x] Draft the Stage 3 architecture and migration design, including the minimal identity projection, trusted provisioning, referral lifecycle, phone-verification blocker, FK rehome sequence, and issuer/RLS requirements. See [AUTH-IDENTITY-MIGRATION-DESIGN.md](AUTH-IDENTITY-MIGRATION-DESIGN.md).
- [x] Add a pinned CLI 3.0.0 schema-only export helper and runbook, with a static CI contract forbidding data/role dumps and restore/deploy commands. See [AUTH-SCHEMA-BASELINE-RUNBOOK.md](AUTH-SCHEMA-BASELINE-RUNBOOK.md).
- [ ] Run the schema-only export locally from the owner's trusted machine and review `schema.sql`, custom Auth/Storage DDL, extension versions, and dependency gaps. Keep artifacts outside Git and share only reviewed schema metadata as appropriate.
- [ ] Design the executable production FK migration against a reviewed complete schema baseline; the fixture test and design document do not authorize or replace that migration.
- [ ] Create private.app_users as the canonical application identity anchor, keyed by the Better Auth UUID.
- [ ] Inventory and migrate all application foreign keys currently referencing auth.users. Preserve application rows and relationships; do not bulk-delete application data.
- [ ] Move profile/user-role/settings provisioning out of the Supabase Auth trigger into an authenticated, idempotent trusted provisioning operation.
- [ ] Keep sign-up pending until both Better Auth account creation and Supabase application provisioning succeed.
- [ ] Redesign referral attribution and email-verification lifecycle without querying auth.users; preserve the 24-hour referral qualification and idempotent Edu Coin reward logic.
- [ ] Define a trusted phone-verification projection before migrating create_organizer, which currently requires both email and phone confirmation.
- [ ] Keep referral RPC contract compatible while removing its auth.users dependency; the active ReferralProgramPanel caller does not consume last_login_at, so a temporary NULL field may be sufficient without adding login-sync writes.
- [ ] Apply issuer restrictions to authenticated RLS policies and sensitive SECURITY DEFINER functions.
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

## Stage 5 — Backend

- [ ] Update Edge Functions that call supabase.auth.getUser() or assume a user exists in auth.users.
- [ ] Update SQL functions/triggers/RPCs that query auth.users, raw_user_meta_data or email_confirmed_at.
- [ ] Continue using auth.uid() where its UUID-subject behavior is compatible and verified.
- [ ] Preserve business-role authorization from application tables; never place admin/teacher/organizer business roles in the PostgreSQL JWT role claim.
- [ ] Keep service-role credentials server-side only and use RLS-scoped clients for user data.
- [ ] Verify email verification, sign-up, referrals, participant sessions, payment webhooks, storage, realtime and admin actions under the new issuer.
- [ ] Review SECURITY DEFINER functions for owner/role/issuer/token checks; do not revoke grants indiscriminately.

## Stage 6 — Demo reset and full testing

- [ ] Confirm the exact demo/test identities and dependent test rows eligible for cleanup. Preserve competitions, shop/payment configuration, application content and other production business data unless separately approved.
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
- The connected Supabase account currently exposes the production project `sykabelajar_db2`. A zero-monthly-cost Free project creation was attempted in the only listed organization, but Supabase rejected it because the owner has reached the two-active-Free-project limit. No project was created, no existing project was paused/deleted, and no plan was upgraded.
- Supabase Custom OIDC cannot be configured through the Supabase CLI. Hosted issuer acceptance, including Data API/Storage/Realtime/Edge Function validation, therefore remains blocked until the owner frees an existing Free-project slot or another explicitly free isolated project becomes available. Never substitute the production project for this test.
- Use Supabase CLI 3.0.0 + Docker locally for database work. The isolated JWT/RLS fixture and its GitHub Actions workflow have passed [run #41772998109](https://github.com/taufx98/sykabelajar4.0/actions/runs/41772998109). This confirms only the tested synthetic Postgres claim/RLS semantics, not hosted Custom OIDC or full application schema. The local Supabase stack itself adds no hosted Supabase cost. However, the current `supabase/migrations` directory is a history of incremental feature changes, not a verified clean bootstrap: some early files share date prefixes and the first feature migrations assume existing application tables such as `organizers` and `auth.users`. Do not assume a blank `supabase db reset --local` can replay the complete production schema. Before Stage 3 integration tests, prepare and review a sanitized schema-only baseline or a purpose-built fixture containing the exact dependencies under test. Do not copy production rows or credentials into fixtures.
- The current Auth Worker CI uses Wrangler's local mode and local D1. Keep it that way for automated auth/OIDC contract tests until a remote Worker/D1 test resource is verified to remain within Cloudflare's Free quota. No Worker deployment, production domain activation, email-provider subscription, or paid email service is required for local testing.
- GitHub Actions on this public repository can run the local checks without purchasing hosted Supabase compute. Keep workflows bounded and avoid deploying from pull-request checks.
- No production Supabase migration, account deletion, custom-domain activation, external OIDC registration, or login cutover has been performed.
