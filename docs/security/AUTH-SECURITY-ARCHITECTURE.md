# ADR: Authentication and Authorization Hardening

- Status: Proposed
- Date: 2026-11-03
- Scope: SYKABELAJAR 4.0 authentication redesign and security audit
- Production changes: None in this ADR

## Context

The application currently uses Supabase Auth for login/session management and Supabase PostgreSQL for application data, authorization, RLS, RPCs, Edge Functions, Storage, and Realtime. The user is willing to recreate test accounts; preserving demo-account credentials is not a migration requirement. Preserving existing application functionality and business data is a requirement.

The target design under evaluation is Better Auth hosted in a Cloudflare Worker, with Cloudflare D1 as its identity/session database, and Supabase PostgreSQL retained as the application database. Better Auth is the sole account/session authority after cutover. Supabase Auth must not be used as a second identity store or mirrored shadow account database.

## Security clarification: UUID is not authorization

Application IDs are UUIDs, not usernames. UUID unpredictability is not an authorization boundary and UUIDs may be exposed in URLs, payloads, or public profile references. A client-supplied `user_id` must never be trusted as proof of ownership.

For direct row access, ownership must be derived from the verified JWT subject (`auth.uid()`) and compared with the row's owner field. RPCs and SECURITY DEFINER functions must independently enforce the caller's identity/role and validate every resource relationship. For example, changing a request's `user_id` must not allow access to another user's rows.

Google OAuth can improve identity proof and reduce password risk, but it does not replace application authorization, RLS, RPC checks, session protection, or account recovery security.

## Decision principles

1. Better Auth owns credentials, account identities, sessions, OAuth connections, verification, and account recovery.
2. Cloudflare D1 stores only Better Auth identity/session data; no application business data.
3. Supabase remains authoritative for profiles, app roles, competitions, exams, Edu Coin, shop, orders, payments, chat, referrals, certificates, and all business rules.
4. The authenticated user's UUID is stable across systems and becomes JWT `sub`; application identity references a private identity anchor, not Supabase `auth.users`.
5. Business roles (`admin`, `teacher`, `student`, `organizer`) remain database-authoritative. JWT `role` is only PostgreSQL `authenticated`.
6. Frontend never receives signing keys or service-role secrets. JWTs are short-lived, ES256 signed, and held in memory only.
7. Supabase `auth.uid()`-based ownership policies can be preserved where their semantics are correct, after validating the custom OIDC issuer and UUID subject.
8. Supabase Auth's `getUser()`/session APIs must not remain as hidden dependencies after cutover; use Better Auth session APIs and verified JWT claims.
9. No production schema migration, account deletion, Cloudflare deployment, or auth cutover in this phase.

## Threat model and required controls

| Threat | Required control / verification |
|---|---|
| IDOR/BOLA via altered UUID | RLS ownership predicates; RPC checks derive caller from `auth.uid()`; negative tests with two users |
| Forged JWT / changed `sub` | ES256 signature verification, trusted issuer, audience, expiry, `kid`; reject unsigned/wrong-key/wrong-issuer tokens |
| Session theft | HttpOnly, Secure, SameSite cookie; HTTPS; session revocation; device/session management; short JWT expiry |
| CSRF | Better Auth Origin/CSRF protection retained; strict CORS; cookie policy; cross-origin mutation tests |
| XSS | output escaping, safe rich-text handling, CSP where compatible, no secrets/tokens in localStorage |
| Brute force / credential stuffing | rate limits on login, verification, reset, and sensitive endpoints; generic auth errors; monitoring |
| Role escalation | no client-editable role claims; role lookup/authorization in DB/backend; admin bootstrap restricted |
| Service-role leakage | server-only secrets; scan bundles, source, logs, and workflow artifacts |
| RPC privilege bypass | review SECURITY DEFINER, search_path, EXECUTE grants, caller/role checks, resource ownership |
| Token revocation delay | do not rely on long JWTs; test session revoke and sensitive action behavior |
| Account provisioning inconsistency | idempotent provisioning, pending state, retry/reconciliation, no active account before app profile/role provision |
| Auth migration regressions | inventory all supabase.auth/auth.users dependencies; contract tests for login, logout, registration, recovery, roles, app features |

## Current known audit observations (read-only)

- Application frontend contains direct `supabase.auth` usage across auth service, AppContext, route/session isolation, and multiple services/pages. This must be centralized and migrated systematically.
- Supabase application schema has 69 FK constraints referencing `auth.users` (excluding internal auth schema), 109 RLS policies referencing `auth.uid()`, and 188 SQL functions referencing `auth.uid()`. These require dependency mapping before changing the identity root.
- Ten SQL functions read `auth.users` or auth metadata/confirmation fields; each requires an individual design review.
- Three auth.users triggers currently provision profiles/roles/settings and handle referral attribution/email confirmation. They must be replaced with an idempotent trusted provisioning flow.
- Live production private table `private.organizer_access_codes` has RLS disabled. Do not blindly enable it: inspect grants, access paths, and policies first; treat as a separate high-priority security finding.
- Production has 10 test users. Account recreation is permitted, but do not wipe unrelated business data.

## Implementation stages

### Stage 0 — Security baseline and dependency inventory (this ADR)
- Record target architecture, threat model, known dependencies, production safety boundary.
- No production mutation.

### Stage 1 — Auth integration proof (isolated branch/test environment)
- Prove Better Auth + Worker + D1 session lifecycle and UUID generation.
- Prove OAuth/OIDC Authorization Code + PKCE, ES256 JWT, discovery/JWKS, Supabase custom OIDC acceptance.
- Test refresh, logout/revocation, cookie/CORS/CSRF, invalid token rejection.
- No production cutover.

### Stage 2 — Identity schema and provisioning proposal
- Design `private.app_users` identity anchor and FK transition plan.
- Design idempotent profile/role/settings provisioning and referral/email verification hooks.
- Admin bootstrap is separate and never self-service.

### Stage 3 — Frontend auth adapter
- Preserve existing UI and AppContext behavior.
- Replace direct Supabase Auth calls with Better Auth adapter.
- Integrate a concurrency-safe in-memory JWT provider into the existing singleton Supabase client; preserve RPC circuit breaker and Realtime health behavior.
- Replace all `supabase.auth` call sites and test app routes/features.

### Stage 4 — Database and Edge Function migration
- Migrate FKs from `auth.users` to private identity root in reviewed, reversible/controlled steps.
- Update auth.users-dependent functions/triggers individually.
- Add issuer checks and verify RLS/RPC/storage/realtime contracts.
- Audit SECURITY DEFINER, grants, and unprotected private data.

### Stage 5 — Security and regression gates
- Two-user IDOR tests for every sensitive domain.
- JWT tampering, issuer/audience/expiry, session revoke, CSRF, XSS, role escalation, rate-limit, Edge Function, and provisioning failure tests.
- Existing lint/typecheck/build/contracts/E2E and feature smoke tests.
- No merge/cutover until all critical tests pass and a reviewed rollback plan exists.

### Stage 6 — Controlled deployment and account reset
- Deploy Worker/D1 through GitHub Actions using existing Cloudflare GitHub Secrets.
- Apply Supabase migration only after explicit approval and backup/rollback readiness.
- Recreate test accounts only; preserve business data unless separately approved.
- Gradual cutover, monitoring, and rollback criteria.

## Acceptance criteria

- One login persists across all app routes without repeated login prompts.
- Supabase API, Storage, Realtime, and supported Edge Functions accept only valid tokens from the intended issuer.
- Altered `user_id`/resource IDs cannot cross user boundaries.
- Users cannot self-assign admin/organizer privileges.
- Revoked sessions cannot continue refreshing; sensitive actions have appropriate revocation/expiry checks.
- No Supabase service-role or Better Auth signing secret appears in client bundle.
- No production changes are made without a reviewed migration and explicit cutover approval.
