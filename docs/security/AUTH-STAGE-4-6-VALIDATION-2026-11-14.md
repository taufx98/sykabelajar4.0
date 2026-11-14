# Stage 4 & 6 — Fresh validation checkpoint (14 November 2026)

Scope: Better Auth authentication migration only. This checkpoint revalidates the current isolated branch and staging identity projection; it does not authorize or perform Production cutover.

## Repository and CI snapshot

- Repository: [taufx98/sykabelajar4.0](https://github.com/taufx98/sykabelajar4.0)
- Branch: `security/auth-poc-stage-1`
- PR: [#177](https://github.com/taufx98/sykabelajar4.0/pull/177) — **open, Draft, unmerged**; base `security/auth-migration-phase-0`.
- Current head at inspection: `d2a3e94af6ac060f0306be349d91b0ac014d54f4`.
- [Auth Worker CI #43497329983](https://github.com/taufx98/sykabelajar4.0/actions/runs/43497329983): success (frontend lint/typecheck/build; Worker security contracts, D1 migrations/local auth-OIDC flow and no-deploy bundle).
- [Supabase Local Auth Claims CI #43497330001](https://github.com/taufx98/sykabelajar4.0/actions/runs/43497330001): success (JWT verifier/claims, issuer/RLS fixtures and four-business-role SQL matrix on disposable local Supabase).
- [Cloudflare read-only preflight #43497329776](https://github.com/taufx98/sykabelajar4.0/actions/runs/43497329776): success; staging D1 identity projection and resource metadata only.
- [Browser workflow #43497329922](https://github.com/taufx98/sykabelajar4.0/actions/runs/43497329922): job success, but Playwright was **skipped by its path guard** because this head changed no browser/frontend inputs. This is not a new browser-test pass.

## Stage 4 — Frontend, session and availability recovery

**Accepted for the agreed staging scope; no acceptance blocker found.**

Evidence:

- Owner-run staging acceptance panel: 5/5 accepted (recorded in the roadmap/status checkpoint).
- [Actual staging browser smoke #43441985687](https://github.com/taufx98/sykabelajar4.0/actions/runs/43441985687): **15 passed, 1 optional Google OAuth test skipped**. This run executed the current recovery tests, including:
  - synthetic D1 quota HTTP 503 with `Retry-After` and exposed CORS headers; retry time is visible and the UI does not falsely sign out;
  - synthetic Cloudflare Worker Error 1027; recoverable availability UI is shown without signing out;
  - bounded login timeout, rejected-login no-hard-reload, registration/recovery rendering and accessibility.
- Auth Worker CI #43497329983 reran the session bridge contract: 13/13 passed, including automatic expiry revalidation, renewed-session rescheduling, definitive expiry invalidation, temporary Worker outage preservation, cross-tab reconciliation and timer cleanup.
- The local disposable-D1 integration test passed expired-session rejection and reauthentication. Owner-accepted refresh/session restore/logout and cross-tab behavior remain accepted.
- **Boundary:** 503/1027 are controlled browser simulations; they did not exhaust the real D1 Free quota or induce a real Cloudflare 1027. A wall-clock hosted expiry is not repeated: local expired-session/reauthentication proof and owner session acceptance exist, while natural shared-session expiry is post-deployment monitoring. Real transactional email/verification/reset delivery remains deferred and is a Production gate.

## Stage 6 — Fresh identity and role projection

**Fresh-account staging mapping revalidated read-only on 14 November.**

The sanitized Cloudflare snapshot from [preflight #43497329776](https://github.com/taufx98/sykabelajar4.0/actions/runs/43497329776) listed four D1 Better Auth identities (two student account types, one teacher and one organizer). A read-only Supabase query matched every D1 UUID exactly to `private.app_users.id`; all four have `identity_origin=better_auth`, one profile and one settings row. The fresh student, teacher and organizer have their canonical profile/account type and exactly one active business role:

| D1 account type | Supabase profile | Active business role | Settings | UUID match |
|---|---|---|---|---|
| student (fresh) | student | student | yes | exact |
| teacher (fresh) | teacher | teacher | yes | exact |
| organizer (fresh) | organizer | organizer_member | yes | exact |
| student (staging admin fixture) | student | admin | yes | exact |

The admin fixture's Better Auth `accountType` is student; its protected Supabase role is admin. It is not evidence that public signup can create an admin.

Additional accepted controls:

- Public registration accepts only student, teacher and organizer account types; `admin` is absent from the client allowlist and public role assignment is denied by the trusted provisioning contract.
- Provisioning tests cover teacher/organizer values, trusted Postgres projection, fail-closed target/secret handling and rejection of unexpected projection responses.
- Four-role disposable Supabase RLS matrix: 16 pgTAP assertions; each role sees only its own role row, cannot read another user's role row, and retains PostgreSQL JWT `role=authenticated` (business role is separate).
- JWT verifier/Edge contracts reject business-role values in the PostgreSQL role claim and require a verified UUID subject, expected issuer/audience and valid signature.
- Staging snapshot remains four Better Auth identities, four profiles, four settings and four active roles; `auth.users` remains zero. No account or row was created, updated, reset or deleted during this checkpoint.

## Decision and guardrails

- **Stage 4: accepted for staging scope.**
- **Stage 6: accepted for fresh-account/role scope.**
- **Production: NO-GO.** Stage 3 identity/FK/auth-lifecycle DDL has not been applied to Production DB2; Stage 7 backup/restore, Production issuer/config/email, monitoring/rollback and explicit cutover gates remain. Production verification email is mandatory.
- No Production DB2/Auth/schema/data/RLS/RPC/Edge Function, Worker/D1 deployment, DNS/Pages/login routing, secret, legacy account, or PR merge/ready action was performed. Staging D1 and all existing accounts were preserved.
- Do not repeat accepted Stage 4/6 tests unless a concrete regression is observed.
