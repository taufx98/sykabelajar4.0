# Better Auth — Frontend auth migration inventory

Status: Stage 4 provider-neutral adapter, social login controls, encrypted Admin provider settings and shared Supabase resource-token injection are present in branch; Supabase Auth remains the live provider and Better Auth frontend transport remains disabled by default. Snapshot date: 8 November 2026. Scope: `security/auth-poc-stage-1`.

## Summary

A recursive source scan of the current branch found **17 direct `supabase.auth` callsites across 5 frontend files** (plus the Cloudinary-signature Edge Function). AppContext and its credential service use a provider-neutral adapter. `src/pages/LoginPage.tsx` now renders configured Google/Facebook/X buttons on the explicit Better Auth preview, and Admin Core Settings mounts the write-only encrypted `LoginProvidersSettingsPanel`. `src/lib/supabase.ts` injects the short-lived Better Auth resource token into the same shared Supabase client only for the exact staging flag/project. Supabase Auth remains the default live provider; this inventory is not a claim that full cutover is complete.

Nine identity-only lookup paths now use the shared application identity accessor instead of invoking Supabase Auth directly. It uses the initialized event-bus UUID and does not fall back after a signed-out snapshot; fallback to the live provider occurs only before initial AppContext publication. The first migration must not be a mechanical global replacement. Several calls currently provide different responsibilities: credential sign-in/sign-up/reset, cross-tab session lifecycle, profile and business-role hydration, direct user-scoped data calls, email/phone verification, password update, signed Cloudinary upload authorization and admin Edge Function bearer tokens.

## Frontend file inventory

| File | Calls found | Responsibility / migration treatment |
|---|---:|---|
| `src/services/auth.service.ts` | 6 | Current central wrappers: sign-in, sign-up, sign-out, getSession, auth-state subscription and reset-password. Replace behind a stable app-owned auth service only after Better Auth client/token adapter exists. |
| `src/store/AppContext.tsx` | 0 | Initial session bootstrap and the sole provider-neutral auth-state subscription now use `auth.service.ts`; user hydration, guest fallback, sign-out cleanup, idle 25-minute logout, role/profile and notification refresh remain owned here. |
| `src/pages/RegisterPage.tsx` | 0 | Optional Cloudinary profile photo now reads the provider-neutral session adapter after account creation; unverified Better Auth registration continues to defer upload until first verified login. |
| `src/services/applicationIdentity.ts` | 0 | Resolves the current UUID from the shared auth-session snapshot and uses the provider-neutral `auth.service.ts` only before event-bus bootstrap. |
| `src/services/applicationAccessToken.ts` | 1 | Central provider-aware Supabase resource token accessor. Supabase Auth remains the default/fallback; Better Auth's short-lived OAuth PKCE token is returned only when the explicit staging flag is enabled. No browser storage. |
| `src/services/cloudinary.service.ts` | 0 | Signed profile upload now uses the shared resource-token accessor before calling `get-cloudinary-signature`. Cloudinary remains canonical media storage; delete/profile SDK paths still await the coordinated Supabase client and backend token cutover. |
| `src/services/chat.service.ts` | 3 | Legacy private-chat service. The approved product decision is to remove private chat, not migrate it to Better Auth. These callsites should disappear when the chat service, routes, subscriptions, polling and Admin Chat Console are removed; comments and other social features remain. |
| `src/components/admin/ZeptoMailSettingsPanel.tsx` | 0 | Calls the staging Worker email-settings admin bridge through the shared provider-neutral resource-token accessor. The default remains Supabase Auth; Better Auth is selected only by the explicit isolated-staging flag. No direct `supabase.auth` call remains in this component. |
| `src/pages/AdminChatConsolePage.tsx` | 2 | Reads current viewer UUID for the Admin Chat Console. This file remains in the current branch inventory; the agreed removal of private chat must remove this page/route and its auth calls rather than migrate a private-chat feature into Better Auth. Preserve comments and other non-chat social features. |
| `src/pages/AdminErrorIntelligencePage.tsx` | 0 | Cloudinary/Edge diagnostic requests use the central provider-aware resource-token accessor; retain existing admin checks and redaction. |
| `src/components/organizer/OrganizerWorkspaceOnboarding.tsx` | 4 | Reads verified email/phone state, starts phone change OTP, verifies `phone_change` OTP, re-reads verified user. This is a hard Stage 3 blocker: current `create_organizer` requires both email and phone verification from Supabase Auth. Do not remove/relax this gate until a trusted Better Auth phone-verification projection exists. |
| `src/pages/ProfileInterfaceSettingsPage.tsx` | 0 | Password changes now go through the provider-neutral `auth.service.updatePassword()` boundary. The legacy Supabase path keeps its current behavior; the Better Auth preview requires the current password and revokes other sessions. OAuth users without a credential password must use the existing email password-reset flow first. Do not silently remove this feature. |

## Auth behaviors not to lose

### App session and cache isolation

`AppContext` owns identity bootstrap, app user hydration, role resolution, guest state, idle timeout and logout cleanup. It is now the only module that subscribes to the live auth provider's state-change stream. It publishes only the event type and current/previous UUID to `src/services/authSessionEvents.mjs`; no email, access token, refresh token or profile data is copied into the event bus.

`App.tsx` account isolation, `cacheAuthLifecycle`, and organizer in-flight cache invalidation consume that same in-app event source instead of opening their own provider listeners. A token refresh for the same UUID does not clear user caches; a UUID switch or sign-out does. The bus replays its current identity snapshot to late subscribers, so consumers do not need extra `getSession()` calls. Supabase Auth remains the default provider until the Better Auth session coordinator, cross-tab reconciliation and OIDC/token acceptance gates are ready. At cutover, the same publisher contract can be fed by Better Auth without changing these consumers.

### Application identity and roles

Better Auth JWT `sub` must be the canonical UUID shared with `private.app_users.id`. Postgres `role` claim remains only `authenticated`; application roles continue to load from `public.user_roles` and `public.app_role` (student, teacher, organizer_member, admin). Frontend must not elevate role based on user-editable profile metadata or token values outside a verified claim contract.

### Organizer email/phone verification

The organizer onboarding screen currently:
1. calls `auth.getUser()` and checks `email_confirmed_at` and `phone_confirmed_at`;
2. sets the phone via `auth.updateUser({ phone })`;
3. sends/verifies OTP using `auth.verifyOtp({ type: 'phone_change' })`;
4. refreshes user to confirm the backend has set `phone_confirmed_at`.

The live `public.create_organizer` RPC currently reads `auth.users.email_confirmed_at`, `phone_confirmed_at` and `phone`, then hashes the verified phone to enforce one FREE organizer claim. Stage 3 must add a trusted, server-verified email/phone status projection linked to the Better Auth UUID and migrate this RPC without weakening the verified-phone rule or the one-free-workspace claim. Frontend-only “verified” booleans are not trustworthy.

### Media, payments and privileged actions

Signed profile upload must call the Cloudinary signing endpoint with a Better Auth resource access token, and continue to upload to Cloudinary. Payment order ownership and admin authorization must remain server-enforced. The admin error-intelligence UI must not treat possession of a browser-stored token as authorization; the Edge Function must verify issuer/audience and business admin role again.

## Recommended Stage 4 sequence

1. Complete the revised fresh-account-only Stage 3 disposable acceptance and use the existing isolated staging Custom OIDC integration. Do not switch the app until a real Better Auth session and exact issuer are accepted.
2. Add a typed auth adapter module with explicit methods for sign-in, sign-up, sign-out, current session/user, access-token retrieval, email verification, password reset/change, phone verification and session events. Keep Better Auth SDK details behind this boundary.
3. **Prepared in this branch:** `AppContext` publishes one typed identity-only session event stream; `App.tsx`, `cacheAuthLifecycle` and organizer cache invalidation consume it without separate provider listeners. The Better Auth bridge is selected only under the exact non-production preview + isolated Supabase allowlist.
4. **Partially prepared:** `applicationIdentity.ts` resolves UUID-only reads from the shared identity snapshot with a bootstrap-only provider fallback. Nine service/page callsites use it; 17 direct auth calls remain for the central legacy-provider wrappers and organizer phone verification; the profile settings page no longer calls Supabase Auth directly. Keep all data authorization in RLS/RPC/Edge Functions.
5. **Partially prepared:** `src/services/applicationAccessToken.ts` now centralizes Supabase resource access-token retrieval. The current Supabase Auth token remains the default; the Better Auth OAuth PKCE token is selected only when the explicit staging flag is enabled. Signed Cloudinary profile uploads use this accessor. Admin diagnostics and ZeptoMail admin bridge remain operation-gated; shared Supabase SDK token injection is implemented but still requires positive Data API/Storage/Realtime/Edge acceptance using a real Better Auth session. Never hand-roll or store long-lived JWTs in localStorage.
6. Implement Better Auth email verification, recovery and password-change UX; design phone OTP through a suitable provider and persist verified status through the trusted Stage 3 provisioning path.
7. Run the full regression matrix: app bootstrap, guest mode, account switching, idle logout, sign-up, email verification, password reset/change, phone verification, profile/photo update, organizer create/join, daily tasks, social comments/likes, orders/checkout/reconcile, admin settings/diagnostics, Cloudinary signed uploads, cross-user IDOR and RLS.

## Non-goals / safety boundaries

- Do not edit/replace the production frontend in this preparation step.
- Do not drop Supabase Auth yet; old production account/login path remains active until all seven stages and rollback gates pass.
- Do not copy Supabase password hashes or make shadow `auth.users` accounts for Better Auth identities.
- Do not delete app data, old accounts, order histories or competition records during frontend migration.
- Do not move media storage to Supabase Storage; Cloudinary remains the media system of record.
- Do not disable the app's server-side ownership/role checks when replacing client auth calls.



## Registration contract cross-check — 6 November 2026

The current registration UI uses `ROLE_OPTIONS` in `src/pages/RegisterPage.tsx` with UI values `pelajar`, `guru`, and `penyelenggara`. `src/store/AppContext.tsx` already maps these through `uiRoleToAccountType()` to the Better Auth-compatible values `student`, `teacher`, and `organizer`. Keep this mapping at the single auth-service boundary in Stage 4; never send `admin` as a self-service account type.

The current username input in `RegisterPage` removes whitespace and lowercases the value but does not provide a format/length validator. The new Worker pre-insert validation accepts only a lower-case safe segment (first character alphanumeric; remaining characters alphanumeric, dot, underscore or hyphen; 3–40 characters). Stage 4 must mirror the server validation in the form with inline feedback before submission, while treating the server response as authoritative. Do not loosen the server rule based on browser input, and do not copy a client-supplied role into a privileged role grant.

A metadata-only production check found 11 profiles with usernames; all 11 match the current Worker safe-segment rule, with no username shorter than three characters, longer than 40, mixed-case, or containing an out-of-pattern character. No usernames or profile rows were selected. The live `public.profiles` table has a unique index on `username`, a check constraint limiting `account_type` to `student`, `teacher`, `organizer`, and no database-level username format/length constraint. The Worker validator is therefore a deliberate new registration contract, not a mirror of an existing database regex. Keep uniqueness handling atomic in the trusted provisioning transaction.


## Better Auth Stage 3 profile-bootstrap contract — 6 November 2026

The existing signup form supplies `full_name`, `username`, `account_type`, `birth_date`, `institution`, `grade`, `subjects`, and an optional referral code. The Better Auth Worker now accepts the corresponding fields as registration-only data (`name`, `username`, `accountType`, `birthDate`, `institution`, `grade`, `subjects`, `referralCode`) and validates them before the D1 user insert. UI roles still map through `uiRoleToAccountType()`; admin remains impossible in self-registration.

Stage 3's trusted PostgREST RPC passes the profile values to `public.profiles`: `birthDate` → `birth_date`, `institution` → `institution` (uppercase, matching the old Supabase trigger), `grade` → `grade` (lowercase), and `subjects` → `subjects`. `username` remains unique in Postgres and `accountType` remains limited to `student`, `teacher`, or `organizer`; business-role assignment remains in `public.user_roles`. The synthetic local test exercises the wrapper as `service_role` and checks all four profile fields.

These profile-bootstrap fields plus `referralCode` are marked non-returned by Better Auth. After the Postgres provisioning transaction succeeds, the Worker clears `birthDate`, `institution`, `grade`, `subjects`, and `referralCode` from the D1 user record. It deliberately retains `accountType` and `username` as stable authentication-side mapping metadata so retries on later session creation cannot default an existing teacher/organizer to student. The Worker fails closed if cleanup cannot be confirmed. Stage 4 must carry these fields from the registration form exactly once and must not expose them as session claims; profile display/edits continue to use PostgreSQL as the application profile authority.
## Better Auth frontend transport boundary — 7 November 2026

A new `src/services/betterAuthApi.client.ts` transport boundary is committed and type-checked with the frontend. It targets the deployed custom Worker base path `/api/auth` and currently exposes:

- `getSession()` — validates the Better Auth session/user envelope, UUID subject, local verified-email flag and expiry.
- `getResourceToken()` — retrieves the short-lived Supabase resource JWT from the Better Auth `/token` endpoint for one caller request; it is returned in memory only and is never stored in browser storage.
- Email/social sign-in, registration, resend-verification, password-reset request, password-reset completion, password change and sign-out transport methods. Password change defaults to revoking other sessions. Registration accepts only `student`, `teacher`, and `organizer`; username validation mirrors the Worker 3–40 character rule.

This is a **disabled staging transport and session adapter**, not a production cutover. It uses the browser's `credentials: include`, `cache: no-store`, exact HTTPS custom auth origin, and an explicit `VITE_BETTER_AUTH_FRONTEND_ENABLED=true` switch restricted to localhost/Pages preview hosts and the exact auth Worker host. The switch is unset by default. `auth.service.ts` can use the Better Auth transport only when that safe staging flag is active; the normal app continues to use Supabase Auth. No second auth listener, duplicate profile hydration, account-switch race, or split token broker has been introduced.

The contract test `scripts/auth-migration/better-auth-frontend-client.test.mjs` pins the endpoint paths, email/session checks, role allowlist, no browser token persistence, explicit disabled-by-default flag and unchanged live Supabase session ownership. The additional `scripts/auth-migration/auth-session-events.test.mjs` exercises in-app snapshot replay and `scripts/auth-migration/better-auth-session-bridge.test.mjs` exercises cross-tab change notifications without broadcasting UUIDs or credentials. `AppContext` remains the single owner of provider listener/hydration, while `auth.service.ts` selects the configured provider. The organizer auth service now reads the canonical UUID from the shared identity-only session snapshot instead of making its own provider call. CI now guards the 17 remaining direct callsites across 6 frontend files.

Remaining Stage 4 work is still substantial: replace the temporary transport with the pinned Better Auth client SDK or formally approve this typed fetch transport; complete Better Auth cross-tab/expiry reconciliation and verify shared event publisher behavior; wire all remaining identity callsites to the canonical Better Auth UUID; implement email verification/recovery/password change/phone verification UX; and switch Cloudinary/admin Edge token retrieval through the short-lived resource token broker only after Stage 2/3/5 hosted identity and endpoint gates pass. No production frontend or login path has been changed.


## Staging deployment checkpoint — 8 November 2026

The branch provider-neutral UI and transport are now backed by the deployed isolated Worker and D1 schema:
- D1 migration 0007 added the managed OAuth provider store (two tables); the remote schema is 20 tables total.
- The Worker routes `/api/admin/login-providers` to the encrypted settings API. `AUTH_PROVIDER_ENCRYPTION_KEY` is a dedicated random 256-bit Cloudflare secret, created once when absent and preserved on later deployments; it is not the email encryption key.
- LoginPage renders Google/Facebook/X buttons only when the Worker reports an enabled provider. The Admin Core `Metode Login` panel remains write-only for Client Secret.
- The hosted deploy check reports no Google OAuth credentials and no seeded user/session. The panel also requires an authenticated Better Auth session and active admin role in the isolated staging Supabase project; the first staging admin bootstrap and provider credentials remain to be completed. No production login was changed.
- Positive Data API, Storage HTTP, Realtime WebSocket and Edge token calls with a real Better Auth session are still required before enabling the frontend transport.
- Transactional email verification/recovery is deliberately deferred until after login and migration acceptance.

## Registration validation alignment — 8 November 2026

The Stage 4 registration form now uses the same password minimum (8 characters) and username allowlist as the Better Auth Worker/client contract. The step controls prevent submission when a password is too short or the normalized username falls outside the 3–40 character lowercase safe-segment pattern. The server remains authoritative; this is early UI feedback, not a replacement for Worker/Postgres validation. A regression assertion in `scripts/auth-migration/frontend-auth-inventory.test.mjs` compares the UI and transport contracts.

## Stage 4 organizer verification integration — 8 November 2026

The organizer onboarding component now selects its verification method through the existing auth provider boundary. In the explicitly enabled Better Auth preview against the isolated Free Supabase project, it obtains the session from Better Auth, reads only a boolean phone-verification status from the Worker, and starts Telegram OIDC phone verification through the Worker. The callback returns to `/organizer`; the UI refreshes the status from the server before enabling workspace creation. The browser never submits an account UUID, phone hash, provider subject, or claimed verification timestamp.

The legacy Supabase Auth preview path retains its existing phone-change OTP flow until the provider cutover is approved. The SQL status wrapper is added to the Stage 3 identity draft and synthetic fixture, with execution limited to `service_role`. The status route fails closed while that reviewed RPC is not installed. No production SQL, Supabase function, Cloudflare secret, provider credential, Worker deployment, or login flag was changed.
