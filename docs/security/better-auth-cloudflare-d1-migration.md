# SYKABELAJAR — Better Auth + Cloudflare D1 migration plan

**Status:** Phase 0 baseline and threat model  
**Assessment date:** 2026-11-03  
**Repository baseline:** `main` at `2df86cd6dfa11cfc9a56e5c841d7b872405fc807`  
**Supabase project:** `mvdczyitbkxkldjughor` (`sykabelajar_db2`, ap-southeast-1)  
**Production changes:** None in this phase

## 1. Goals and non-goals

### Goals

- Move account identity, password/social login, email verification, and browser sessions to Better Auth running on Cloudflare Workers with Cloudflare D1 as its authentication database.
- Keep Supabase PostgreSQL as the business-data system of record: profiles, roles, competition registrations, exams, Edu Coin, Shop, orders, payments, chat, awards, certificates, and application settings.
- Keep the current single-login experience: authenticate once, navigate across application routes without repeating login.
- Preserve the existing Supabase client singleton, RPC health/circuit-breaker behavior, cache lifecycle, and Realtime usage while introducing third-party JWT authentication.
- Make the new identity ID a UUID so existing `auth.uid()` expressions can continue to work where their semantics are appropriate.
- Treat Google OAuth as a login provider, not as a source of application roles or privileges.

### Non-goals

- Do not redesign login or registration UI unnecessarily.
- Do not replace Supabase Database, RLS, RPC, Edge Functions, Storage, or Realtime.
- Do not mirror Better Auth credentials or sessions into `auth.users`.
- Do not delete application records or reset production data as part of the auth migration.
- Do not grant administrative roles based on client input, Google profile fields, or signup metadata.

## 2. Target architecture

| Responsibility | System of record |
|---|---|
| User identity, email, password hash, linked social accounts | Better Auth + Cloudflare D1 |
| Browser session and session revocation | Better Auth session cookie + D1 |
| Google OAuth exchange | Better Auth Worker |
| Authentication JWT signing and JWKS | Better Auth Worker |
| Application identity anchor | Supabase `private.app_users` |
| Profile, username, school, preferences | Supabase PostgreSQL |
| Business roles (`student`, `teacher`, `organizer`, `admin`) | Existing Supabase role tables and guarded RPCs |
| Application data, RLS, transactions, exam integrity | Supabase PostgreSQL / Edge Functions |
| Media | Existing Cloudinary / Supabase Storage flows |

Canonical auth host planned: `https://auth.sykabelajar.my.id`.

The exact OIDC issuer and discovery URL must be selected and verified in the isolated Worker proof-of-concept. The issuer value, discovery document, JWT `iss`, and Supabase third-party integration must match exactly; do not guess or silently normalize a mismatch.

### Identity mapping

- Better Auth user IDs must be UUIDs.
- The same UUID is provisioned into `private.app_users.id`.
- `public.profiles.id` and application foreign keys that currently reference `auth.users(id)` will be migrated to the private identity anchor in reviewed migrations.
- User UUIDs are identifiers, not passwords or bearer credentials. Knowing another user's UUID must never grant access.
- Do not create shadow auth users in `auth.users`; doing so would reintroduce Supabase Auth as a competing identity source.

### Supabase JWT contract

Every authenticated Supabase request must carry a short-lived, asymmetric-signed token with at minimum:

- `sub`: Better Auth UUID, identical to `private.app_users.id`
- `role`: literal PostgreSQL role `authenticated`, never an application role
- `iss`: exact canonical Better Auth issuer
- `aud`: exact audience configured and validated for this Supabase integration
- `exp`, `iat`, and JWT key ID `kid`

Use ES256 for the first integration candidate. Keep private signing material in the Worker/D1-backed Better Auth JWKS system only. Validate token creation, key rotation, expiry, discovery, and Supabase acceptance in an isolated environment before production configuration.

The Supabase JS `accessToken` callback is the intended integration point. Once it is configured, do not use the `supabase.auth` namespace; all login/session operations must go through Better Auth. The callback must use a single-flight token refresh/cache so concurrent Data API and Realtime requests do not cause refresh races.

## 3. Google login and account linking

Google OAuth is expected to be secure when configured correctly, but a Google login button alone is not a security boundary.

Required controls:

- Use Better Auth's official Google provider on the server; keep the Google client secret only in Worker secrets.
- Use Google's exact registered callback URI and HTTPS in production.
- Keep OAuth `state` validation and PKCE enabled; do not permit caller-supplied overrides of protocol parameters.
- Require a verified email from Google before treating it as verified locally.
- Disable implicit account linking with `account.accountLinking.disableImplicitLinking: true`. New Google sign-ins may create a new Better Auth account, but attaching Google to an existing email/password account must require the user to already be signed in and complete the explicit `/link-social` flow with re-authentication.
- Do not rely on `emailAndPassword.requireEmailVerification: true` alone as a defense against account pre-hijacking. Better Auth published GHSA-g38m-r43w-p2q7 (CVE-2026-53516), a high-severity implicit OAuth-account-linking flaw affecting stable versions below 1.6.11 and early 1.7.0 betas; patched stable versions start at 1.6.11. Pin a patched stable release, commit the lockfile, and enable dependency vulnerability scanning.
- For the initial launch, consider Google-only login if email/password login is not required. If both methods are enabled, keep implicit linking disabled and test the pre-account-registration attack scenario explicitly.
- Do not accept `role`, `is_admin`, `account_type`, Edu Coin, referral eligibility, or other authorization/business claims from Google profile data.
- Keep application role assignment in guarded Supabase provisioning logic. Public signup may request only the allowed non-admin account types; admin bootstrap remains out-of-band and restricted.
- Test the cases where an email/password account already exists, Google email is unverified, the Google account changes email, and a user attempts to link a Google account owned by another user.

Google's verified email authenticates control of that Google identity at sign-in time; it does not prove the person is authorized to access a particular SYKABELAJAR role or record.

## 4. Security and migration baseline

Read-only repository and production checks performed for this phase:

### Frontend and runtime

- Current frontend uses `@supabase/supabase-js` `^2.57.4`; Better Auth is not yet installed.
- `src/services/auth.service.ts` directly calls `supabase.auth.signInWithPassword`, `signUp`, `signOut`, `getSession`, `onAuthStateChange`, and `resetPasswordForEmail`.
- `src/store/AppContext.tsx` owns global session bootstrap, hydration, role loading, logout, and idle-session behavior.
- `src/App.tsx` contains a separate `ChatSessionIsolation` listener tied directly to Supabase Auth.
- `src/lib/supabase.ts` contains a singleton client plus existing RPC health, circuit-breaker, Realtime health, and error-reporting behavior. Preserve these behaviors.
- Repository search found direct Supabase Auth usage across multiple services and pages. A complete call-site inventory is required before any cutover.
- No existing Google sign-in implementation was found in the initial focused repository search; verify all login and registration entry points before adding the provider.

### Production database dependencies (prior read-only inventory)

- 69 application foreign-key constraints reference `auth.users(id)`.
- 109 RLS policies use `auth.uid()`.
- 188 SQL functions use `auth.uid()`.
- 10 SQL functions read from `auth.users` or auth metadata/confirmation fields and require individual redesign.
- 3 triggers are attached to `auth.users` creation/email-confirmation events.
- 15 Supabase Edge Functions are active.
- 10 current `auth.users` rows and 10 corresponding profile rows were observed in the earlier inventory; these are test accounts according to the project owner. This does not authorize wiping business data.

These counts are an inventory baseline, not permission to run bulk replacement. Recount them immediately before preparing database migrations.

### Current Supabase security advisor

Snapshot retrieved on 2026-11-03:

- **48** public `SECURITY DEFINER` functions are executable by `anon`.
- **247** public `SECURITY DEFINER` functions are executable by `authenticated`.
- **23** tables have RLS enabled but no policies.
- Supabase Auth's leaked-password protection advisory is present.
- The 48 `anon` findings are not automatically vulnerabilities. Representative admin functions inspected in this phase do check `auth.uid()` and an admin guard inside the function body; public published-result/read endpoints and token-gated collective endpoints may also be intentional. All 48 still need a function-by-function authorization contract and negative tests.
- The 247 `authenticated` findings similarly require review of admin guards, ownership checks, input validation, and whether `SECURITY DEFINER` is actually necessary.
- The 23 no-policy tables are not automatically exposed: with RLS enabled and no applicable policy, ordinary API access is denied. Verify each table's intended access path and grants; do not add permissive policies merely to clear an advisory.
- `private.organizer_access_codes` was confirmed to have RLS disabled. Because it is in the non-exposed `private` schema and may be used by privileged routines, inspect schema/table grants and all callers before deciding whether RLS should be enabled. Do not turn it on blindly.

## 5. Required migration stages

### Phase 0 — Baseline and threat model

- Record repository commit, current test commands, frontend auth call sites, database dependencies, active Edge Functions, and Supabase security advisories.
- Classify each security-definer RPC as public-read, token-gated public flow, user-owned, organizer-owned, admin-only, internal-only, or service-only.
- Identify every function/trigger that reads `auth.users`, `auth.uid()`, `auth.jwt()`, or auth metadata.
- No production writes.

**Exit gate:** reviewed inventory and no unresolved ambiguity about who owns identity, session, token issuance, and business authorization.

### Phase 1 — Isolated Better Auth Worker proof-of-concept

- Create a standalone Worker project under the repository, separate from the Vite app's runtime.
- Configure Better Auth with D1, UUID IDs, secure host-only cookies, exact trusted origins, strict rate limits, email/password, and Google provider configuration.
- Implement session retrieval, logout/revocation, email verification, password reset, and session listing/revocation tests.
- Prove Google OAuth callback and account-linking behavior.
- Prove an OIDC discovery/JWKS document and ES256 JWT that Supabase can validate. Select one token issuance flow and document it; do not combine incompatible Better Auth JWT-plugin and OAuth-provider endpoints.
- Restrict CORS to the production frontend origin plus explicit local test origins; credentialed requests must never use wildcard origins.
- Add local D1 migrations and CI. Do not bind to production D1 or deploy a production auth hostname yet.

**Exit gate:** tests for session persistence, invalid/expired/revoked sessions, wrong origin, CSRF, OAuth state/PKCE, wrong issuer/audience/signature, UUID `sub`, `role=authenticated`, JWKS rotation, and token expiry pass.

### Phase 2 — Supabase identity anchor

- Design `private.app_users` with a UUID primary key and minimal auth identity metadata only.
- Add idempotent server-side provisioning from Better Auth to Supabase.
- Provisioning must be fail-closed: the account cannot use authenticated app data until the Supabase identity/profile/role records are ready.
- Build a dependency map for all 69 foreign keys and the three auth triggers.
- Prepare reversible, staged migrations for FKs, profile identity, referral attribution/email verification, and functions that read `auth.users`.
- Preserve business records and relationships; do not blindly delete old rows.

**Exit gate:** staging tests show every user-linked table, cascade/restrict rule, referral trigger, and profile workflow works without a Supabase Auth row.

### Phase 3 — Supabase third-party JWT integration

- Configure Custom OIDC on a non-production Supabase project/branch first.
- Validate discovery URL, issuer equality, JWKS, ES256, `kid`, `sub`, `aud`, `exp`, and `role`.
- Preserve UUID `sub` to retain compatible `auth.uid()` behavior; add issuer restrictions as restrictive policies where appropriate.
- Keep business roles in existing Supabase role tables; never copy them into the PostgreSQL `role` JWT claim.
- Test Data API, Storage, Realtime, and Edge Functions with the third-party JWT.

**Exit gate:** the same user can query their own records and cannot read/write another user's records even when client-supplied UUID filters are changed.

### Phase 4 — Frontend auth adapter

- Add a centralized Better Auth client/service.
- Replace all direct `supabase.auth` calls in services, pages, guards, AppContext, and session isolation code.
- Use one app-wide session provider and preserve current route-navigation behavior.
- Configure the existing Supabase singleton with the `accessToken` callback; retain RPC health/circuit-breaker and Realtime behavior.
- Handle account switches by clearing user-scoped caches and realtime subscriptions before hydrating the next identity.
- Do not persist Supabase access JWTs or refresh tokens in `localStorage`.

**Exit gate:** login once, refresh browser, navigate all protected route groups, account-switch, logout, idle logout, and multi-tab behavior work without stale user data.

### Phase 5 — SQL and Edge Function authorization migration

- Replace `auth.users` reads and triggers with the new identity/provisioning model.
- Review all `SECURITY DEFINER` RPCs, including the 48 `anon` and 247 `authenticated` advisory findings.
- Ensure admin RPCs enforce admin authorization in the database function body, not only in React route guards.
- Ensure owner updates include both `USING` and `WITH CHECK` where appropriate; reject user ID reassignment.
- Review views for `security_invoker`, explicit grants, function `search_path`, and unnecessary `SECURITY DEFINER`.
- Update Edge Functions that use `supabase.auth.getUser()` or assume an `auth.users` row exists. Verify JWT claims before using `sub`; use a user-scoped Supabase client for RLS-governed access and service role only for explicitly privileged server work.
- Audit the `private.organizer_access_codes` access path and the 23 no-policy tables.
- Preserve separate token-based collective participant flows where they are intentionally not standard user sessions.

**Exit gate:** security tests cover all authorization classes, and no RPC/Edge Function assumes that Supabase Auth owns the user identity.

### Phase 6 — Controlled cutover

- Deploy Worker and D1 using GitHub Actions secrets; never put secrets in commits or frontend variables.
- Configure Google OAuth credentials and exact Google callback URI.
- Configure Supabase Custom OIDC only after staging proof passes.
- Create the first admin through a separate verified bootstrap process.
- Run a limited production smoke test with test accounts and no destructive data reset.
- Disable Supabase Auth public signups/providers only after all frontend and backend call sites have moved; Supabase Auth cannot be assumed to disappear from the project.
- Keep a documented rollback path until the new auth provider and all dependent SQL/Edge paths are stable.

**Exit gate:** production smoke tests pass across login, Google sign-in, profile, competition, exam, shop, payments, chat, organizer, and admin workflows.

## 6. Security test matrix

| Test | Expected result |
|---|---|
| Change a request's `user_id` to another UUID | RLS denies or returns no other user's rows |
| Forge JWT payload / change `sub` without valid signature | Supabase rejects token |
| Valid signature, wrong `iss` or `aud` | Rejected |
| Token expired or not yet valid | Rejected |
| Missing/wrong `role` claim | No authenticated database access |
| Use Google profile `role=admin` / custom metadata | Never grants admin |
| Login with unverified Google email | Blocked or verification required |
| OAuth callback with wrong `state` or PKCE verifier | Rejected |
| Credentialed request from untrusted Origin | Rejected |
| Logout/revoke session then mint new Supabase JWT | Rejected |
| Two browser tabs switch between different users | Cache and Realtime state never mix |
| User invokes admin RPC directly without admin role | Rejected by database function |
| User updates row and changes its owner UUID | Rejected by RLS `WITH CHECK` |
| Edge Function called with missing, expired, wrong-issuer token | Rejected |
| Realtime channel subscribed using expired/revoked identity | Access is refreshed or connection is rejected |
| D1/Supabase provisioning partially fails | Account remains pending and cannot access protected app data |

## 7. Operational guardrails

- GitHub Actions secrets already configured by the project owner: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Do not request or print their values.
- Google OAuth `client_id` and `client_secret` will be Worker secrets, never Vite `VITE_*` variables.
- D1 database ID and non-secret environment values belong in Wrangler configuration/variables; secrets belong in Cloudflare Worker secrets or GitHub Actions secrets.
- No production database migration, D1 creation, auth hostname deployment, credential rotation, signup disablement, or account deletion occurs in the proof-of-concept phase.
- All behavioral changes follow the repository's existing test commands and add tests before implementation.
- A PR must pass lint, typecheck, build, existing contract tests, Worker tests, and security integration tests before merge.

## 8. Official technical references

- Supabase Custom OIDC: https://supabase.com/docs/guides/auth/third-party/custom-oidc
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase JS third-party `accessToken`: https://supabase.com/docs/reference/javascript/initializing
- Better Auth OAuth 2.1 Provider: https://better-auth.com/docs/plugins/oauth-provider
- Better Auth JWT/JWKS: https://better-auth.com/docs/plugins/jwt
- Better Auth Google OAuth: https://better-auth.com/docs/concepts/oauth
- Better Auth Cloudflare: https://better-auth.com/docs/authentication/cloudflare
- Cloudflare D1 migrations: https://developers.cloudflare.com/d1/reference/migrations/
