# Stage 4 & Stage 6 validation checkpoint — 13 November 2026

Evidence snapshot: branch `security/auth-poc-stage-1`, code head `99b61cb85d973d97c67e6726047bab8090fa8e02`, PR #177. This checkpoint records only current staging/read-only evidence and branch-local test results. It does not authorize a merge, deployment or Production cutover.

## Decision

**Stage 4: partially accepted; Production gate remains open.**

**Stage 6: partially accepted; Production gate remains open.**

No Production resource was changed. PR #177 remains open, Draft and unmerged. The Better Auth frontend continues to be explicitly isolated to the staging hostname and isolated Supabase staging project.

## Stage 4 — frontend, expiry and service availability

### Confirmed by code/tests

- Better Auth frontend transport and same-site cookie/session bridge are implemented. Owner has already confirmed normal staging email/password login/logout, session restore and cross-tab logout; do not repeat basic login testing.
- Session bridge has automated tests for a scheduled expiry revalidation, a definitive 401/expired session, renewal of an unchanged session, temporary Worker failure during expiry, focus recovery and timer cleanup.
- Resource-token cache tests cover reuse for the same identity, the 45-second refresh margin, single-flight concurrent exchange, invalidation after a confirmed identity change/logout, and rejecting near-expired token responses.
- Post-sign-in confirmation retries only safe session GETs; it does not replay a credential POST. A D1 quota response with the degraded marker and valid `retry_at_utc` is not immediately retried.
- Worker D1 quota classification/response tests cover the documented daily read/write limit messages, a safe 503, `Retry-After`, `X-Auth-Availability: degraded`, and next-midnight-UTC retry metadata.
- AuthGuard has a recoverable availability screen. A temporary Worker/network/quota failure is not treated as proof of logout; an authoritative 401/expired session remains a definitive sign-out.

### Browser acceptance and CORS fix — 13 November 2026

- Two Playwright browser cases in `e2e/staging/login-smoke.spec.ts` simulate D1 quota 503 with a visible retry time and Cloudflare Error 1027 with the recoverable availability UI. Both assert the app does not redirect to login or issue sign-out solely because of the transient error.
- The first hosted run #43436326042 surfaced a genuine defect: the browser received the 503 body and the `X-Auth-Availability` header, but the CORS response did not expose that header to JavaScript. The UI therefore showed the generic recovery message without its retry time.
- Fixed `services/auth-worker/src/security.mjs` to expose `X-Auth-Availability` and `Retry-After` to exact allowlisted origins and preserve the expose header in `applyResponseHeaders`. Added a regression test; Auth Worker CI confirms it passes.
- The rerun against the staging Pages preview passed **12 browser tests, with 1 optional Google OAuth test skipped** in [Better Auth staging browser smoke #43438269059](https://github.com/taufx98/sykabelajar4.0/actions/runs/43438269059). Both synthetic D1 503 and Error 1027 recovery tests passed. These are controlled simulations: no D1 quota was exhausted and no live Worker route was interrupted.
- Real hosted session-expiry → reauthentication and resource-token renewal using an active real Better Auth browser session have not been independently observed in this audit. Unit/session-bridge and token-cache tests pass, but they do not substitute for those two hosted acceptance items.
- External email verification and password-reset delivery remain deferred by owner instruction. Staging email-verification bypass is not acceptable in Production; do not forge `emailVerified`.

### Current Stage 4 status

| Check | Status |
|---|---|
| Basic staging login/logout | Owner-confirmed; do not repeat |
| Session restore / cross-tab logout | Owner-confirmed |
| Expiry timer and definitive expiry logic | Automated tests pass |
| Transient Worker errors do not cause false logout | Automated tests pass |
| Resource-token refresh margin/single-flight cache | Automated tests pass |
| Hosted real-session expiry and reauthentication | **Open** |
| Hosted real-session resource-token renewal | **Open** |
| Browser D1 503 recovery simulation | Passed on staging Pages preview #43438269059 |
| Browser Cloudflare Error 1027 simulation | Passed on staging Pages preview #43438269059 |
| Real email delivery | Deferred; not a Production bypass |

## Stage 6 — fresh identity and preserved business roles

### Current isolated Supabase staging snapshot

A read-only query against project `ydamszdfsxqisanazdkb` returned:

- Better Auth identity roots: **4**
- Linked profiles: **4**
- Linked settings rows: **4**
- Active Better Auth business-role rows: **4**
- Legacy `auth.users` rows: **0**
- Profile account types: **student 2, teacher 1, organizer 1**
- Active roles: **admin 1, student 1, teacher 1, organizer_member 1**

This confirms that staging currently has the expected profile and active-role projection for all four business-role categories. The existing admin profile remains a student account type with a separate admin business role; public registration does not grant admin.

### Database-side protection verified read-only

- `public.better_auth_provision_user` and `public.better_auth_complete_email_verification` are `SECURITY DEFINER` with an empty pinned `search_path`.
- Only `service_role` can execute those provisioning/verification RPCs. `anon` and `authenticated` cannot.
- `anon` has no direct table privilege on `public.user_roles`; `authenticated` can SELECT but cannot INSERT/UPDATE/DELETE; `service_role` has the server-side mutation privileges.
- The local four-role RLS matrix contains 16 assertions. It verifies that each subject sees only its own business-role row and the PostgreSQL JWT claim remains `role=authenticated`.
- A transaction-only hosted staging RPC probe previously verified `student → student`, `teacher → teacher`, `organizer → organizer_member`, rejected public admin registration, preserved existing profile edits on retry, and did not reactivate a deliberately disabled role. The whole test transaction was rolled back.
- A real fresh student registration was previously matched by exact UUID between staging D1 and Supabase; it created the profile, settings and student role. The account remains untouched.

### Latest D1-to-Supabase identity correlation — read-only preflight #43438269067

The pull-request-triggered Cloudflare preflight completed successfully on 13 November 2026. It read only safe D1 fields (`id`, `accountType`, `emailVerified`, `createdAt`) and did not select email, password, session token, credential, or secret values. All four recent D1 UUIDs match exactly to the four current Supabase `private.app_users.id` rows previously read from the isolated staging project:

- Existing staging admin identity — D1 `student` row matches the Supabase identity carrying the separate active `admin` business role.
- Fresh student — D1 `student` row matches the active `student` business role.
- Fresh teacher — D1 `teacher` row matches the active `teacher` business role.
- Fresh organizer — D1 `organizer` row matches the active `organizer_member` business role.

This confirms fresh D1 Better Auth identity → Worker provisioning hook → Supabase identity/profile/role/settings projection for all three public self-registration types. Supabase currently has four Better Auth roots, four linked profiles, four linked settings rows, and four active role rows; `auth.users` remains zero. All four D1 rows still have `emailVerified=false` due to the isolated staging verification bypass. Do not transfer that bypass to Production.

The local 16-assertion role/RLS matrix and live RPC privilege checks remain the role-isolation evidence. Active browser JWT sessions for the new teacher and organizer accounts have not been independently observed in this audit; preserve this distinction from the confirmed provisioning mapping.

### Current Stage 6 status

| Check | Status |
|---|---|
| Fresh student D1 → Worker → Supabase UUID match | Confirmed on prior read-only preflight #370 |
| Supabase staging teacher identity/profile/role/settings | Confirmed and exact D1 UUID match via preflight #43438058351 |
| Supabase staging organizer identity/profile/role/settings | Confirmed and exact D1 UUID match via preflight #43438058351 |
| Admin self-registration denied | Hosted transaction probe passed; protected role grant remains service-only |
| Role/RLS isolation matrix | 16 local assertions passed |
| Role provisioning RPC access control | Read-only privilege audit passed |
| Real hosted teacher/organizer JWT sessions | Open |
| Legacy account reset/import/cleanup | Explicitly out of scope; none performed |

## CI evidence

- [Auth Worker CI #43438269022](https://github.com/taufx98/sykabelajar4.0/actions/runs/43438269022) — success, including the new CORS header-exposure regression (assertion 79), Worker/local D1 auth tests, frontend lint/typecheck/build and Worker dry-run.
- [Supabase Local Auth Claims CI #43438269168](https://github.com/taufx98/sykabelajar4.0/actions/runs/43438269168) — success, including shared Better Auth verifier/handler contracts and disposable local Supabase JWT/RLS tests.
- [Better Auth staging browser smoke #43438269059](https://github.com/taufx98/sykabelajar4.0/actions/runs/43438269059) — success: **12 passed, 1 optional Google OAuth test skipped**. D1 503 and Error 1027 recovery simulations both passed.
- [Auth Cloudflare Staging Preflight #43438269067](https://github.com/taufx98/sykabelajar4.0/actions/runs/43438269067) — success; read-only output matches all four latest D1 UUIDs (student, teacher, organizer and the existing admin identity) to Supabase staging. No email addresses or credential/secret values were read or printed.

## Production readiness and safety boundary

**Not Production-ready.** Stage 4 still lacks hosted real-session expiry/reauthentication and resource-token renewal acceptance. Stage 6 still lacks current D1 correlation and live teacher/organizer token-session acceptance. Separately, Stage 3 identity-root/FK/issuer changes have not been applied to Production, Stage 7 cutover/monitoring/rollback has not started, and explicit owner Production approval is absent.

Do not merge PR #177, mark it ready, deploy the Worker or business Edge handlers, change DNS/routes/login routing, alter Production Supabase Auth/schema/data/RLS/RPC/secrets, reset/import/delete any account, or run admin bootstrap. Keep all further work limited to staging, repository code, CI and disposable test environments.