# SYKABELAJAR Authentication Migration — Working Roadmap

This is the retained task order for the Better Auth + Cloudflare D1 migration. Update this file whenever a stage changes; do not skip stages to reach production deployment.

## Architecture and safety decisions

- Better Auth is the single account/session authority after cutover.
- Cloudflare D1 stores authentication identity, accounts, sessions, verification, OAuth grants, and auth-specific rate-limit data only.
- Supabase PostgreSQL remains the application database and authorization authority.
- Better Auth user IDs must be UUIDs so the JWT subject can map to the existing UUID-based app identity model.
- JWT role is the PostgreSQL role authenticated, never a SYKABELAJAR business role.
- Application roles continue to be derived from the application database.
- Existing Supabase application data must be preserved. Only the demo/test accounts may be recreated, and only under a separately approved cutover plan.
- No production database changes, account deletion, custom-domain activation, or login cutover until all security and regression gates pass.

## Ordered stages

| Stage | Work | Status |
|---|---|---|
| 0 | Architecture baseline, threat model, auth dependency inventory, production safety boundary | Draft PR #176 |
| 1 | Better Auth + Worker + D1; email/password and Google; cookies/session revoke; ES256/OIDC/JWKS; Supabase token validation; two-user IDOR tests | In progress — local email/session/OAuth/ID-token/access-token/rate-limit CI checks pass; Google credentials, real email delivery, Supabase staging acceptance, and two-user IDOR gates remain |
| 2 | Identity anchor schema and idempotent app-account provisioning design | Not started |
| 3 | Frontend auth adapter; remove direct supabase.auth use while preserving AppContext, UI, cache and realtime behavior | Not started |
| 4 | Migrate auth.users foreign keys, triggers, SQL functions, RPCs, and Edge Functions; issuer restrictions | Not started |
| 5 | Full security and regression gates, rollback rehearsal, route/feature smoke tests | Not started |
| 6 | Create isolated/staging Cloudflare D1, deploy staging Worker, approved production migration, test-account reset and gradual cutover | Not started |

## Stage 1 detailed checklist

- [x] Create isolated Worker source scaffold.
- [x] Configure Better Auth with native D1 binding and UUID ID generation.
- [x] Configure secure host-only session cookies, Origin/CSRF checks, exact-origin CORS, and disabled session cookie cache.
- [x] Configure email verification and password reset through an external mail-webhook contract.
- [x] Configure Google sign-in behind explicit client credentials and require verified email.
- [x] Disable implicit Google/password account linking.
- [x] Configure ES256 JWT signing, OIDC scopes/discovery, a five-minute access-token lifetime, and the PostgreSQL authenticated role claim.
- [x] Configure database-backed rate-limit rules.
- [x] Seed one fixed public OAuth client/resource in versioned migration 0002 (no client secret; exact callback; authorization_code only; PKCE required); the protected internal endpoint is read-only verification. Public dynamic client registration remains disabled.
- [x] Upgrade all Better Auth packages used by the PoC to the coordinated 1.7.16 security release; pin the matching core and better-call versions.
- [x] Add origin/CORS and bootstrap-secret contract tests; 5 tests passed in the initial CI run.
- [x] Add explicit schema-contract tests for the complete Better Auth + OAuth Provider model set.
- [x] Add a guarded Worker request-context D1 schema export using Better Auth getMigrations(); the schema endpoint is disabled unless local-only environment flag and random token are present.
- [x] Add CI to apply the bootstrap-state migration locally, generate/export the Better Auth schema from disposable D1, smoke-test Worker/OIDC/JWKS, and perform a dry-run bundle.
- [x] Base CI passed in run #100: dependency audit (0 reported vulnerabilities), typecheck, 9 contract tests, local D1 migration, request-context schema generation, OIDC discovery/JWKS ES256 smoke test, and Worker dry-run bundle.
- [x] Commit the exact package lock and reviewed Better Auth + OAuth Provider + rate-limit D1 schema using the guarded CI persistence step; subsequent CI installs with npm ci.
- [x] Review generated schema: 13 expected tables, 31 DDL statements, 18 indexes; SQLite replay and foreign-key check passed.
- [x] Test Worker session endpoints against disposable local D1: email verification, password reset, login, session lookup, logout and post-logout UserInfo rejection pass in CI.
- [ ] Configure a test Google OAuth client and verify Google login/email-verified behavior.
- [x] Test the email webhook contract with a local mock for verification and password reset.
- [x] Verify the real `/request-password-reset` custom rate limit returns HTTP 429 after the configured three requests per hour.
- [ ] Configure a production-grade email webhook/vendor and verify deliverability.
- [x] Seed and verify the first-party public client using the exact callback URI and explicit mandatory PKCE configuration.
- [x] Complete Authorization Code + PKCE S256 authorization and token exchange in local CI.
- [x] Verify local OIDC issuer/discovery/JWKS, kid, ES256 access-token signature, UUID sub, resource audience, role claim, and five-minute expiry.
- [x] Verify OIDC ID-token ES256 signature, client-ID audience, UUID subject, and authorization-request nonce.
- [x] Verify JWT rejection for wrong issuer, wrong audience, expired token, and modified signature.
- [x] Verify Authorization Code + PKCE in the local runtime suite.
- [ ] Verify the integrated frontend preserves one global Better Auth session without re-login on route changes (frontend adapter is Stage 3).
- [ ] Prove Supabase Custom OIDC accepts the token in a non-production environment.
- [x] Run negative token tests for missing PKCE, wrong signature, wrong issuer, wrong audience, expired token, and UserInfo after session logout.
- [ ] Add a dedicated altered-`sub` and audience-mismatch RLS test against Supabase staging; UserInfo-after-logout is not equivalent to instant revocation of an already-issued Supabase Data API JWT.
- [ ] Run two-user IDOR tests for profiles, exams/attempts, Edu Coin, shop/orders, chat, referrals, certificates, and organizer/admin boundaries.
- [ ] Record findings and close critical/high issues before starting Stage 2.

## Known external setup gates

- Cloudflare GitHub Actions secrets already exist: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Never ask the owner to paste their values into chat.
- Google OAuth client credentials are not yet present in this PoC environment.
- Email webhook/provider credentials are not yet configured.
- The D1 ID in the Worker config is a deliberate placeholder and is not a production database ID.
- Cloudflare custom domain and Supabase Custom OIDC are not configured by this PoC.
- No Supabase staging branch currently exists. Creating one was quoted at $0.01344/hour; do not create it until the owner approves that recurring cost.
- Better Auth's November 3, 2026 security release is pinned consistently at v1.7.16 (core and OAuth Provider) with better-call 1.4.5. CI run #119 passed with `npm ci`, zero dependency vulnerabilities, nine schema/security contract tests, local email/password/session lifecycle, password-reset rate limiting, OAuth Authorization Code + PKCE S256, ES256 access-token and ID-token verification, wrong-issuer/audience/expiry/signature rejection, logout/UserInfo behavior, migrations, and Worker dry-run bundle. Remaining gates are external Google credentials, production email delivery, non-production Supabase acceptance, Cloudflare staging D1/Worker setup, and the two-user IDOR matrix.
