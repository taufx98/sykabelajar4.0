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
| 2 | OIDC and JWT | **Local proof-of-concept complete; Supabase acceptance pending.** OAuth Provider, Authorization Code + PKCE S256, ES256 signing, discovery/JWKS and UUID/role/audience claims pass local tests. Supabase Custom OIDC is not configured or validated. |
| 3 | Supabase identity foundation | **Not started.** No private.app_users, foreign-key transition, replacement auth trigger, referral/email-verification lifecycle migration, or issuer restrictions have been applied. |
| 4 | Frontend | **Not started.** The React app still uses Supabase Auth directly. Better Auth client, token broker, global session adapter, and replacement of every supabase.auth call remain to be implemented. |
| 5 | Backend | **Not started.** Edge Functions, auth.users-dependent RPC/functions/triggers, and authorization paths still use current Supabase Auth assumptions. |
| 6 | Demo reset and full testing | **Not started.** No demo-account reset or admin bootstrap has occurred. Requires the isolated Supabase test environment, two-user IDOR matrix, full feature regression tests, and rollback rehearsal. |
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
- [ ] Register Supabase Custom OIDC only in an isolated Supabase environment.
- [ ] Prove Supabase accepts valid ES256 tokens and rejects wrong issuer, wrong audience, wrong signature, expired token and altered sub.
- [ ] Verify auth.uid() resolves the Better Auth UUID correctly in policies and RPCs.
- [ ] Verify Data API, Storage, Realtime and Edge Functions with the external JWT.
- [ ] Add a two-user RLS/IDOR test using two different Better Auth UUID subjects.

## Stage 3 — Supabase identity foundation

- [ ] Create private.app_users as the canonical application identity anchor, keyed by the Better Auth UUID.
- [ ] Inventory and migrate all application foreign keys currently referencing auth.users. Preserve application rows and relationships; do not bulk-delete application data.
- [ ] Move profile/user-role/settings provisioning out of the Supabase Auth trigger into an authenticated, idempotent trusted provisioning operation.
- [ ] Keep sign-up pending until both Better Auth account creation and Supabase application provisioning succeed.
- [ ] Redesign referral attribution and email-verification lifecycle without querying auth.users.
- [ ] Apply issuer restrictions to authenticated RLS policies and sensitive SECURITY DEFINER functions.
- [ ] Keep business roles in existing application tables and preserve current role semantics.
- [ ] Verify all constraints and provisioning rollback/retry behavior in staging before migration.

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
- PR #179: protects backend-managed profile columns and server-side display-name cooldown. Its regression contract was corrected to inspect JWT role/admin semantics; the updated CI run is in progress.
- Production audit previously found 69 application foreign keys to auth.users, 109 RLS policies using auth.uid(), 188 SQL functions using auth.uid(), and 10 functions/triggers that read auth.users or its metadata. These must be individually mapped in Stages 3 and 5.
- private.organizer_access_codes has RLS disabled in production. Do not simply enable RLS without first designing and testing its intended access policies and reviewing every privileged function that reads it.

## External setup and staging costs

- Cloudflare GitHub Actions secrets are already installed; keep their values private.
- The Worker config deliberately contains a placeholder D1 database ID. It is not deployable until a dedicated non-production D1 is created.
- No Supabase development/staging branch exists at the last check.
- The quoted Supabase branch cost is USD $0.01344 per hour. Obtain the owner's explicit approval of this recurring hourly cost before creating the branch.
- No production Supabase migration, account deletion, custom-domain activation or login cutover has been performed.
