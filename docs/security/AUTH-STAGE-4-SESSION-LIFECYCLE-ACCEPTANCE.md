# Better Auth Stage 4 — live session lifecycle acceptance

Status: staging-only owner acceptance runbook
Scope: fresh Better Auth accounts and their active sessions only
Production: prohibited; this runbook does not authorize Production changes.

## Current implementation

The frontend's Better Auth session bridge validates the server session on mount, tab focus/resume, cross-tab notifications, and the server-provided expiry deadline. It does not poll continuously. An authoritative expired/invalid session is signed out; temporary Worker, network, or D1 availability failures do not falsely sign out the user.

The Supabase resource access token is short-lived (maximum five minutes), kept in memory, and refreshed before its 45-second safety margin. A fresh authorization uses the same-site hidden authorization-code + PKCE S256 flow. Tokens are not written to local storage, logged, or displayed.

Automated Worker/session-bridge/resource-token tests cover the expiry state machine, definitive 401, transient failure, reauthentication contracts, identity isolation, token cache refresh margin, concurrent single-flight exchange, and invalidation on logout or real identity change. These tests do not replace hosted owner acceptance.

## Owner-run hosted acceptance

1. Open `https://staging.sykabelajar.my.id` and sign in with a Better Auth staging administrator account.
2. Open **Admin → Pengaturan** (`/admin/core?tab=settings`).
3. Locate **Uji Penerimaan Better Auth — Staging** and select **Jalankan tes**.
4. Confirm the panel reaches **5/5**:
   - Active Better Auth session, Supabase profile/active role, and own-row visibility.
   - A real resource token is obtained, its in-memory cache is invalidated, and a second resource token is freshly issued through PKCE while the same Better Auth session and UUID remain active.
   - Private Storage upload/download/cleanup for the current UUID, with a foreign UUID folder denied.
   - Private Realtime Broadcast echo for the current UUID, with a foreign UUID topic denied.
   - Read-only Edge probe accepts the real ES256 resource JWT through the shared application identity verifier and reports the expected issuer, audience, subject, PostgreSQL role, and RLS result.
5. Report only the five pass/fail states and safe error codes. Do not copy, print, screenshot, or send cookies, credentials, authorization headers, or tokens.

The resource-token check deliberately forces a fresh exchange by invalidating only the browser's in-memory resource-token cache. It verifies a second real PKCE token issuance on the same live session; it does **not** wait for the normal 45-second refresh margin or assert the natural TTL boundary.

## Session expiry and reauthentication — still a separate gate

A live seven-day Better Auth session cannot be honestly described as expired merely because a UI test or a synthetic 401 response was observed. Do not edit a user's D1 session row, forge an expiry claim, or change the shared staging session lifetime to accelerate this check.

The hosted expiry → reauthentication acceptance remains open until a real Better Auth session reaches its server expiry and the browser is observed rejecting it, clearing the expired identity, and accepting a fresh sign-in. Keep automated expiry/reauthentication tests as supporting evidence, not as a substitute for that hosted result. A purpose-built disposable Worker + disposable D1 with a deliberately short session TTL may be used for a separate full server-side expiry rehearsal, but it must not share staging D1 or affect a real user session.

## Safety boundaries

- The Admin panel is rendered only on the exact staging hostname and only when the Better Auth staging frontend is enabled.
- Storage test objects are removed after the test; the Realtime channels are closed; the Edge probe is read-only.
- Do not run this panel on Production.
- Do not import, switch into, reset, delete, or clean up demo/legacy accounts.
- Do not change Production auth, Supabase DB2, DNS, Pages configuration, or Worker routing.
- Do not merge PR #177 or perform cutover based on this panel result alone.
