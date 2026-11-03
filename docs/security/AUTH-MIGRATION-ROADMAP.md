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
| 1 | Better Auth + Worker + D1; email/password and Google; cookies/session revoke; ES256/OIDC/JWKS; Supabase token validation; two-user IDOR tests | In progress — isolated Worker scaffold only |
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
- [x] Add origin/CORS contract tests and non-deploying Worker CI.
- [ ] Generate and review the complete Better Auth + OAuth Provider + rate-limit D1 schema.
- [ ] Apply the reviewed schema to a disposable D1 database.
- [ ] Complete the OAuth Provider public client bootstrap with exact callback URI and mandatory PKCE S256.
- [ ] Test password signup, email verification, login, password reset, Google login, and logout against disposable D1.
- [ ] Verify OIDC discovery, JWKS, kid, ES256 signature, UUID sub, issuer, audience, role claim, and five-minute expiry.
- [ ] Verify Authorization Code + PKCE and ensure the existing Better Auth session avoids asking the user to log in again on route changes.
- [ ] Prove Supabase Custom OIDC accepts the token in a non-production environment.
- [ ] Run negative token tests: missing, altered sub, wrong signature/key, wrong issuer, wrong audience, expired token, and revoked session behavior.
- [ ] Run two-user IDOR tests for profiles, exams/attempts, Edu Coin, shop/orders, chat, referrals, certificates, and organizer/admin boundaries.
- [ ] Record findings and close critical/high issues before starting Stage 2.

## Known external setup gates

- Cloudflare GitHub Actions secrets already exist: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Never ask the owner to paste their values into chat.
- Google OAuth client credentials are not yet present in this PoC environment.
- Email webhook/provider credentials are not yet configured.
- The D1 ID in the Worker config is a deliberate placeholder and is not a production database ID.
- Cloudflare custom domain and Supabase Custom OIDC are not configured by this PoC.
- Better Auth maintainers announced a security release for November 3, 2026. Before merging or deploying this PoC, confirm the published advisory/fixed release state and pass npm audit; do not upgrade into a prerelease solely to bypass an unpublished advisory.
