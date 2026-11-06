# Better Auth — Frontend auth migration inventory

Status: reviewed source inventory with CI baseline guard; no frontend auth source changes made. Snapshot date: 6 November 2026. Scope: `security/auth-poc-stage-1`.

## Summary

A recursive source scan of the current branch found **41 direct `supabase.auth` callsites across 22 frontend files** (plus the Cloudinary-signature Edge Function). The CI contract now includes the ZeptoMail Admin panel, Admin Chat Console and legacy private-chat service. The app is still wired to Supabase Auth. This is an exact branch baseline, not an assertion that the migration is complete.

The first migration must not be a mechanical global replacement. Several calls currently provide different responsibilities: credential sign-in/sign-up/reset, cross-tab session lifecycle, profile and business-role hydration, direct user-scoped data calls, email/phone verification, password update, signed Cloudinary upload authorization and admin Edge Function bearer tokens.

## Frontend file inventory

| File | Calls found | Responsibility / migration treatment |
|---|---:|---|
| `src/services/auth.service.ts` | 7 | Current central wrappers: sign-in, sign-up, sign-out, getSession, auth-state subscription and reset-password. Replace behind a stable app-owned auth service only after Better Auth client/token adapter exists. |
| `src/store/AppContext.tsx` | 2 | Initial session bootstrap, user hydration, guest fallback, auth-state subscription, sign-out cleanup, idle 25-minute logout and refresh of profile/roles/notifications. This is the main app session lifecycle and needs a single Better Auth session source. |
| `src/App.tsx` | 2 | `ChatSessionIsolation` tracks current user and forces a reload when account identity changes/signs out. Preserve cache/private-state isolation, but move subscription to the new auth event contract. |
| `src/lib/cacheAuthLifecycle.ts` | 1 | Clears user-specific client caches after auth identity changes. Rewire to the same central auth lifecycle; do not create a second subscription source. |
| `src/services/organizerAuth.service.ts` | 2 | Clears organizer in-flight cache on auth changes and obtains current user UUID for organizer lookup. Use canonical verified Better Auth UUID. |
| `src/services/daily-task.service.ts` | 1 | Uses current user ID to fetch daily tasks/claims. Keep RLS and owner checks; no request-body user ID trust. |
| `src/services/ad.service.ts` | 3 | User-bound banner request creation and “my requests” reads. Replace user lookup with canonical app session identity. |
| `src/pages/RegisterPage.tsx` | 1 | Reads the newly created Supabase session to upload an optional profile photo. New flow must wait for Better Auth account plus Stage 3 application identity provisioning; preserve Cloudinary upload after successful identity projection. |
| `src/services/social.service.ts` | 1 | Reads current UUID for comment/post likes and interaction mapping. Keep comments and social features; use the Better Auth UUID. |
| `src/pages/OrdersPage.tsx` | 1 | Reads session identity alongside catalog/payment configuration. Preserve order-owner checks and payment workflow. |
| `src/services/cloudinary.service.ts` | 1 | Reads Supabase access token to call `get-cloudinary-signature`. Must obtain the Better Auth access token through the centralized token broker; keep Cloudinary as canonical media storage and do not move uploads to Supabase Storage. |
| `src/services/chat.service.ts` | 3 | Legacy private-chat service. The approved product decision is to remove private chat, not migrate it to Better Auth. These callsites should disappear when the chat service, routes, subscriptions, polling and Admin Chat Console are removed; comments and other social features remain. |
| `src/services/commerce.service.ts` | 1 | Reads UUID for own organizer-plan orders. Preserve user-specific filtering and server-side authorization. |
| `src/services/shopEngagement.service.ts` | 1 | Requires current user for wishlist/rating/engagement actions. Preserve owner checks, duplicate prevention and RLS. |
| `src/pages/OrganizerPlanPage.tsx` | 1 | Reads own organizer plan orders, filtered by current UUID. |
| `src/pages/AdminPlanUsagePage.tsx` | 1 | Captures current admin UUID as reviewer when an organizer custom-plan request is reviewed. Keep the active-admin guard in the privileged server-side RPC/function; browser identity is audit attribution only. |
| `src/pages/OrganizerControlCenterPage.tsx` | 2 | Uses current UUID for owner-filtered organizer reads and authenticated actions. Keep explicit owner/business-role authorization. |
| `src/components/admin/ZeptoMailSettingsPanel.tsx` | 1 | Reads the current Supabase Auth session to call the staging Worker email-settings admin bridge. This is a Stage 1 compatibility bridge only; replace it with a Better Auth token after Custom OIDC and Stage 3 admin identity checks are accepted. |
| `src/pages/AdminChatConsolePage.tsx` | 2 | Reads current viewer UUID for the Admin Chat Console. This file remains in the current branch inventory; the agreed removal of private chat must remove this page/route and its auth calls rather than migrate a private-chat feature into Better Auth. Preserve comments and other non-chat social features. |
| `src/pages/AdminErrorIntelligencePage.tsx` | 2 | Retrieves Supabase access token for authorized Edge Function diagnostics. Replace with Better Auth resource token from the single token broker; preserve admin checks and redaction. |
| `src/components/organizer/OrganizerWorkspaceOnboarding.tsx` | 4 | Reads verified email/phone state, starts phone change OTP, verifies `phone_change` OTP, re-reads verified user. This is a hard Stage 3 blocker: current `create_organizer` requires both email and phone verification from Supabase Auth. Do not remove/relax this gate until a trusted Better Auth phone-verification projection exists. |
| `src/pages/ProfileInterfaceSettingsPage.tsx` | 1 | Uses `supabase.auth.updateUser({ password })` for password change. Requires a deliberate Better Auth change-password flow, current-password/security rules, session revocation and recovery UX. Do not silently remove this feature. |

## Auth behaviors not to lose

### App session and cache isolation

`AppContext` currently owns identity bootstrap, app user hydration, role resolution, guest state, idle timeout and logout cleanup. `App.tsx` plus `cacheAuthLifecycle` also subscribe to auth changes. Stage 4 should introduce one typed app-level identity/session event source, then wire all listeners to it. Avoid parallel Supabase and Better Auth session subscriptions after cutover; that creates duplicate hydrations, stale identity state and account-switch leakage.

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

1. Finish Stage 2 hosted Custom OIDC acceptance and Stage 3 identity root/provisioning first. Do not switch the app to an issuer Supabase has not accepted.
2. Add a typed auth adapter module with explicit methods for sign-in, sign-up, sign-out, current session/user, access-token retrieval, email verification, password reset/change, phone verification and session events. Keep Better Auth SDK details behind this boundary.
3. Make `AppContext` the single consumer of session events. Replace the direct App.tsx/cache/organizer listeners with the shared event emitter, retaining account-switch invalidation and guest-mode behavior.
4. Replace direct current-user reads in services with an app-owned `requireCurrentUserId()` / `getCurrentUser()` helper that returns only the verified session identity. Keep all data authorization in RLS/RPC/Edge Functions.
5. Replace access-token fetches for Cloudinary and admin diagnostics with one resource-token provider that requests a token only for the configured Supabase audience; never hand-roll or store long-lived JWTs in localStorage.
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